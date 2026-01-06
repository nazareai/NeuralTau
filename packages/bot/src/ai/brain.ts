import {
  AIMessage,
  GameState,
  GameAction,
  ChatMessage,
  Logger,
  DEFAULT_SYSTEM_PROMPT,
  MINECRAFT_ADVANCED_SYSTEM_PROMPT,
  MINECRAFT_FAST_SYSTEM_PROMPT,
  MINECRAFT_AUTONOMOUS_PROMPT,
} from '@tau/shared';
import { openRouterClient } from './openrouter.js';
import { config } from '../config.js';
import { decisionLogger, DecisionLogEntry } from './decision-logger.js';
import { emotionManager } from './emotion-manager.js';
import { experienceMemory } from './experience-memory.js';
import { buildCraftableItemsContext, getSuggestedCraft } from '../games/crafting-helper.js';
import { getLearningSystem, LearningSystem } from './learning-system.js';
import * as fs from 'fs';
import * as path from 'path';

// AI decision timeout - if AI takes longer than this, use fallback
const AI_DECISION_TIMEOUT_MS = 8000; // 8 seconds max - viewers will leave after this!

// Check if autonomous mode is enabled
const AUTONOMOUS_MODE = process.env.AUTONOMOUS_MODE === 'true';

const logger = new Logger('AI-Brain');

// Learning log configuration - logs what AI learned and decided
const LEARNING_LOG_ENABLED = process.env.LOG_PROMPTS === 'true' || process.env.LOG_LEARNING === 'true';
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LEARNING_LOG_FILE = path.join(LOGS_DIR, 'learning.log');

// Ensure logs directory exists
if (LEARNING_LOG_ENABLED) {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    logger.info('Learning log enabled', { logFile: LEARNING_LOG_FILE });
  } catch (err) {
    logger.warn('Failed to create learning log directory', { error: err });
  }
}

/**
 * Log learning data to file
 */
function logLearning(data: {
  timestamp: string;
  phase: 'learning' | 'context' | 'decision';
  content: Record<string, any>;
}) {
  if (!LEARNING_LOG_ENABLED) return;

  try {
    let logEntry = '';

    if (data.phase === 'learning') {
      logEntry = `\n${'='.repeat(80)}\n`;
      logEntry += `[${data.timestamp}] LEARNING FROM HISTORY\n`;
      logEntry += `${'='.repeat(80)}\n`;
      logEntry += `Recent Actions:\n`;
      data.content.recentActions?.forEach((a: any, i: number) => {
        logEntry += `  ${i + 1}. ${a.action} → ${a.success ? '✓' : '✗'} ${a.result}\n`;
      });
      logEntry += `\nStats: ${data.content.stats?.success || 0} success, ${data.content.stats?.failed || 0} failed\n`;
      logEntry += `Consecutive Failures: ${data.content.stats?.consecutiveFailures || 0}\n`;
      if (data.content.patterns?.length > 0) {
        logEntry += `\nPatterns Detected:\n`;
        data.content.patterns.forEach((p: string) => {
          logEntry += `  • ${p}\n`;
        });
      }
    } else if (data.phase === 'context') {
      logEntry = `\n[${data.timestamp}] CONTEXT SENT TO AI\n`;
      logEntry += `-`.repeat(40) + '\n';
      logEntry += `Position: ${JSON.stringify(data.content.position)}\n`;
      logEntry += `HP: ${data.content.hp}, Food: ${data.content.food}, Time: ${data.content.time}\n`;
      if (data.content.alerts?.length > 0) {
        logEntry += `Alerts: ${data.content.alerts.join(', ')}\n`;
      }
      logEntry += `Inventory: ${data.content.inventory?.join(', ') || 'empty'}\n`;
      logEntry += `Tools: pickaxe=${data.content.hasTools?.pickaxe || false}, axe=${data.content.hasTools?.axe || false}, sword=${data.content.hasTools?.sword || false}\n`;
      if (data.content.environment?.tree) {
        // tree can be number (2) or string with direction ("6m_north")
        const treeVal = data.content.environment.tree;
        const treeStr = typeof treeVal === 'string' ? treeVal : `${treeVal}m`;
        logEntry += `Nearest Tree: ${treeStr}\n`;
      }
      if (data.content.mood) {
        logEntry += `Mood: ${data.content.mood}, Feeling: ${data.content.feeling}\n`;
      }
    } else if (data.phase === 'decision') {
      logEntry = `\n[${data.timestamp}] DECISION MADE\n`;
      logEntry += `-`.repeat(40) + '\n';
      logEntry += `Action: ${data.content.action}\n`;
      logEntry += `Target: ${data.content.target || 'none'}\n`;
      logEntry += `Reasoning: ${data.content.reasoning}\n`;
      logEntry += `Tokens: ${data.content.tokens}, Duration: ${data.content.duration}\n`;
      logEntry += '\n';
    }

    fs.appendFileSync(LEARNING_LOG_FILE, logEntry);
  } catch (err) {
    logger.warn('Failed to write learning log', { error: err });
  }
}

// Track action history with results
interface ActionHistoryEntry {
  action: GameAction;
  result: string;
  success: boolean;
  timestamp: Date;
}

// Observation result from 360° look around
interface ObservationResult {
  blocksVisible: Map<string, number>;
  canSeeSky: boolean;
  pathsAvailable: { direction: string; yaw: number; clear: boolean; distance: number }[];
  recommendation: string;
  timestamp: number;
}

export class AIBrain {
  private conversationHistory: AIMessage[] = [];
  private actionHistory: ActionHistoryEntry[] = [];
  private readonly systemPrompt: string;
  private readonly MAX_ACTION_HISTORY = 10; // Keep last 10 actions
  // Store observation results for AI context
  private lastObservation: ObservationResult | null = null;
  private readonly OBSERVATION_EXPIRY_MS = 60000; // Observations expire after 60s
  // Decision logging - track pending decision to log with result
  private pendingDecision: {
    context: DecisionLogEntry['context'];
    decision: DecisionLogEntry['decision'];
  } | null = null;
  // Learning system integration - track state for learning
  private lastGameState: GameState | null = null;
  private lastDecisionTime: number = 0;

  constructor(customSystemPrompt?: string) {
    // Use ADVANCED Minecraft-specific prompt if in Minecraft mode
    const defaultPrompt = config.game.mode === 'minecraft'
      ? MINECRAFT_ADVANCED_SYSTEM_PROMPT  // NEW: Advanced ReAct pattern prompt
      : DEFAULT_SYSTEM_PROMPT;

    this.systemPrompt = customSystemPrompt || defaultPrompt;
    this.conversationHistory.push({
      role: 'system',
      content: this.systemPrompt,
    });

    logger.info('AI Brain initialized', {
      personality: config.personality.name,
      goal: config.personality.goal,
      gameMode: config.game.mode,
    });
  }

  /**
   * Record the result of an action - call this after each action completes
   */
  recordActionResult(action: GameAction, result: string) {
    // Determine if action was successful based on result text
    // COMPREHENSIVE failure keywords - must catch all failure cases!
    const failureKeywords = [
      'failed', 'cannot', 'blocked', 'stuck', 'error', 'could not', "couldn't", 
      "didn't work", 'unable', 'timeout', 'timed out', 'no recipe', 'missing', 'not found',
      'unknown item', 'unknown', 'invalid', 'no path', 'requires',
      "don't have", "do not have", "in inventory", "not in inventory", "no item"
    ];

    // Determine success - mining without proper tool should count as failure
    let success: boolean;
    const resultLower = result.toLowerCase();
    
    // CRITICAL: Check for inventory failures first (e.g., "Don't have oak_planks in inventory")
    if (resultLower.includes("don't have") || resultLower.includes("not in inventory") || 
        (resultLower.includes("in inventory") && !resultLower.includes("have"))) {
      success = false;
      logger.warn('[LEARNING] Detected inventory failure', { action: action.type, target: action.target, result });
    } else

    if (action.type === 'mine') {
      // Mining is only successful if block was broken AND item was collected
      // Mining stone/ore without pickaxe breaks the block but drops nothing - that's a FAILURE
      if (resultLower.includes('mined') && !resultLower.includes('not collected')) {
        success = true; // Block was broken AND item collected
      } else if (resultLower.includes('not collected') || resultLower.includes('drop nothing')) {
        success = false; // Block broken but no drops - wasted effort, count as failure
      } else {
        success = !failureKeywords.some(kw => resultLower.includes(kw));
      }
    } else if (action.type === 'craft') {
      // Crafting-specific success detection
      // ONLY successful if we actually crafted something
      if (resultLower.startsWith('crafted ')) {
        success = true;  // "Crafted wooden_pickaxe" etc.
      } else {
        // All other craft results are failures: no recipe, unknown item, missing materials, etc.
        success = false;
      }
    } else if (action.type === 'place') {
      // Place is ONLY successful if block was actually placed
      if (resultLower.includes('placed') && !resultLower.includes("don't have") && !resultLower.includes('cannot')) {
        success = true;
      } else {
        // All other place results are failures: don't have item, can't place here, etc.
        success = false;
      }
    } else if (action.type === 'move') {
      // Movement success = actually REACHED the destination or very close
      // "Pathfinder couldn't reach X" = FAILURE (even if moved some blocks)
      // "Reached near X (2.1 blocks away)" = SUCCESS
      
      if (resultLower.includes("couldn't reach") || resultLower.includes('could not reach')) {
        // Pathfinder gave up - this is a FAILURE even if bot moved some distance
        success = false;
      } else if (resultLower.includes('reached') || resultLower.includes('arrived') || 
                 resultLower.includes('close enough') || resultLower.includes('blocks away)')) {
        // Actually reached or got very close to destination
        success = true;
      } else if (resultLower.includes('remaining')) {
        // Has "remaining" distance - means didn't reach, FAILURE
        success = false;
      } else if (resultLower.includes('blocked') || resultLower.includes('stuck')) {
        success = false;
      } else {
        // Fallback: check for general failure keywords
        success = !failureKeywords.some(kw => resultLower.includes(kw));
      }
    } else {
      success = !failureKeywords.some(kw => resultLower.includes(kw));
    }

    this.actionHistory.push({
      action,
      result,
      success,
      timestamp: new Date(),
    });

    // Keep only recent history
    if (this.actionHistory.length > this.MAX_ACTION_HISTORY) {
      this.actionHistory = this.actionHistory.slice(-this.MAX_ACTION_HISTORY);
    }

    // Log at INFO level to verify success/failure detection in logs
    logger.info('[LEARNING] Action recorded', {
      action: `${action.type}${action.target ? ':' + action.target : ''}`,
      success: success ? '✓' : '✗',
      result: result.substring(0, 60),
      historySize: this.actionHistory.length,
    });

    // === NEW LEARNING SYSTEM INTEGRATION ===
    // Record to the three-tier learning architecture if available
    const learningSystem = getLearningSystem();
    if (learningSystem && this.lastGameState) {
      const meta = this.lastGameState.metadata as any;
      const compactContext = learningSystem.buildCompactContext(meta);

      learningSystem.recordAction(
        { type: action.type, target: action.target || '' },
        compactContext,
        success,
        Date.now() - (this.lastDecisionTime || Date.now()),
        {
          reason: this.pendingDecision?.decision.reasoning,
          errorMsg: success ? undefined : result.substring(0, 200),
        }
      );
    }

    // Log to decision logger for pattern learning (autonomous mode)
    if (AUTONOMOUS_MODE && this.pendingDecision) {
      decisionLogger.logDecision(
        this.pendingDecision.context,
        this.pendingDecision.decision,
        {
          success,
          message: result,
          inventoryChange: undefined, // Could be extracted from result if needed
        }
      );
      this.pendingDecision = null;
    }
  }

  /**
   * Get count of consecutive failures (from most recent backwards)
   */
  public getConsecutiveFailures(): number {
    let count = 0;
    // Count backwards from most recent
    for (let i = this.actionHistory.length - 1; i >= 0; i--) {
      if (!this.actionHistory[i].success) {
        count++;
      } else {
        break; // Stop at first success
      }
    }
    return count;
  }

  /**
   * Detect if bot is repeating same failed action
   */
  public isRepeatingFailedAction(): { isRepeating: boolean; actionType?: string; target?: string; count?: number } {
    if (this.actionHistory.length < 3) {
      return { isRepeating: false };
    }

    const lastThree = this.actionHistory.slice(-3);
    const allFailed = lastThree.every(h => !h.success);
    const sameType = lastThree.every(h => h.action.type === lastThree[0].action.type);
    const sameTarget = lastThree.every(h => h.action.target === lastThree[0].action.target);

    if (allFailed && sameType) {
      return {
        isRepeating: true,
        actionType: lastThree[0].action.type,
        target: sameTarget ? lastThree[0].action.target : undefined,
        count: 3
      };
    }

    return { isRepeating: false };
  }

  /**
   * Get action types that have failed multiple times recently
   * Used by fallback to avoid suggesting actions that keep failing
   */
  public getRecentlyFailedActionTypes(minFailures: number = 3): string[] {
    const failureCounts: Record<string, number> = {};

    // Count failures per action type in recent history
    for (const entry of this.actionHistory) {
      if (!entry.success) {
        const actionType = entry.action.type;
        failureCounts[actionType] = (failureCounts[actionType] || 0) + 1;
      }
    }

    // Return action types that failed >= minFailures times
    return Object.entries(failureCounts)
      .filter(([_, count]) => count >= minFailures)
      .map(([actionType, _]) => actionType);
  }

  /**
   * Get the most recent failing action type (for targeted recovery)
   */
  public getMostRecentFailingActionType(): string | null {
    for (let i = this.actionHistory.length - 1; i >= 0; i--) {
      if (!this.actionHistory[i].success) {
        return this.actionHistory[i].action.type;
      }
    }
    return null;
  }

  /**
   * Detect severe stuck loop - same action+target failing repeatedly
   * Returns a strong warning message for the AI if stuck
   */
  public getStuckLoopWarning(): string | null {
    if (this.actionHistory.length < 3) return null;

    const lastFive = this.actionHistory.slice(-5);
    const failedActions = lastFive.filter(h => !h.success);
    
    if (failedActions.length < 3) return null;

    // Check for same action+target pattern
    const actionSignatures = failedActions.map(h => `${h.action.type}:${h.action.target || 'none'}`);
    const signatureCounts: Record<string, number> = {};
    
    for (const sig of actionSignatures) {
      signatureCounts[sig] = (signatureCounts[sig] || 0) + 1;
    }

    // Find the most repeated failed action
    const entries = Object.entries(signatureCounts);
    const [mostRepeated, count] = entries.sort((a, b) => b[1] - a[1])[0];
    
    if (count >= 3) {
      const [actionType, target] = mostRepeated.split(':');
      logger.warn('[STUCK-LOOP] 🚨 CRITICAL: Same action failing repeatedly!', {
        action: actionType,
        target: target,
        failCount: count
      });
      
      return `🚨🚨🚨 CRITICAL STUCK LOOP: You tried "${actionType} ${target}" ${count} times and it FAILED every time! STOP doing this action! Do something COMPLETELY DIFFERENT like: mine trees for wood, move to a new location, craft different items, or eat food. The current approach is NOT WORKING.`;
    }

    return null;
  }

  /**
   * Detect if bot keeps trying to mine stone without pickaxe
   */
  public getPickaxeBlockedMiningCount(): number {
    const stoneBlocks = ['stone', 'granite', 'diorite', 'andesite', 'cobblestone'];
    return this.actionHistory.filter(h =>
      h.action.type === 'mine' &&
      !h.success &&
      stoneBlocks.some(s => h.action.target?.toLowerCase().includes(s)) &&
      h.result.toLowerCase().includes('pickaxe')
    ).length;
  }

  /**
   * Track directions that lead to water/traps (Y drops after successful moves)
   * This helps avoid repeating the same bad paths
   */
  private badDirections: Map<string, number> = new Map();
  private lastKnownY: number = 0;

  /**
   * Record position after move to detect water traps
   */
  public recordPositionAfterMove(direction: string, newY: number) {
    // Initialize lastKnownY if not set
    if (this.lastKnownY === 0) {
      this.lastKnownY = newY;
      return;
    }

    // If Y dropped significantly after a move, that direction leads to a trap
    const yDrop = this.lastKnownY - newY;
    if (yDrop >= 5) {
      const count = this.badDirections.get(direction) || 0;
      this.badDirections.set(direction, count + 1);
      logger.warn(`[TRAP-DETECTION] Direction "${direction}" led to Y drop: ${this.lastKnownY} → ${newY}`, {
        direction,
        dropAmount: yDrop,
        timesTrapped: count + 1
      });
    }
    this.lastKnownY = newY;
  }

  /**
   * Get warnings about bad directions
   */
  public getBadDirectionWarnings(): string[] {
    const warnings: string[] = [];
    this.badDirections.forEach((count, direction) => {
      if (count >= 1) {
        warnings.push(`🚫 AVOID "${direction.toUpperCase()}" - it has led to water/traps ${count} time(s)!`);
      }
    });
    return warnings;
  }

  /**
   * Store observation results from 360° look around
   * This will be included in the AI context for better awareness
   */
  public setObservation(observation: {
    blocksVisible: Map<string, number>;
    canSeeSky: boolean;
    pathsAvailable: { direction: string; yaw: number; clear: boolean; distance: number }[];
    recommendation: string;
  }) {
    this.lastObservation = {
      ...observation,
      timestamp: Date.now()
    };
    logger.info('[AWARENESS] Observation stored for AI context', {
      blocksCount: observation.blocksVisible.size,
      clearPaths: observation.pathsAvailable.filter(p => p.clear).length,
      canSeeSky: observation.canSeeSky
    });
  }

  /**
   * Get observation summary for AI context
   * Returns formatted string if observation is recent, null otherwise
   */
  private getObservationContext(): string | null {
    if (!this.lastObservation) return null;

    // Check if observation is still valid (not expired)
    const age = Date.now() - this.lastObservation.timestamp;
    if (age > this.OBSERVATION_EXPIRY_MS) {
      this.lastObservation = null;
      return null;
    }

    const obs = this.lastObservation;
    const lines: string[] = ['=== 🔭 RECENT OBSERVATION (from looking around) ==='];

    // Categorize paths - CRITICAL for navigation
    const safePaths = obs.pathsAvailable.filter(p => p.clear && !(p as any).hasWater && !(p as any).hasLava);
    const waterPaths = obs.pathsAvailable.filter(p => (p as any).hasWater);
    const lavaPaths = obs.pathsAvailable.filter(p => (p as any).hasLava);
    const blockedPaths = obs.pathsAvailable.filter(p => !p.clear && !(p as any).hasWater && !(p as any).hasLava);

    if (safePaths.length > 0) {
      lines.push(`✅ SAFE PATHS: ${safePaths.map(p => `${p.direction} (${p.distance}m)`).join(', ')}`);
    }
    if (waterPaths.length > 0) {
      lines.push(`🌊 WATER TRAP: ${waterPaths.map(p => p.direction).join(', ')} - AVOID these directions!`);
    }
    if (lavaPaths.length > 0) {
      lines.push(`🔥 LAVA DANGER: ${lavaPaths.map(p => p.direction).join(', ')} - DO NOT GO THERE!`);
    }
    if (blockedPaths.length > 0) {
      lines.push(`❌ BLOCKED: ${blockedPaths.map(p => p.direction).join(', ')}`);
    }

    // Sky visibility
    if (obs.canSeeSky) {
      lines.push('☀️ CAN SEE SKY - you are near the surface or an opening!');
    } else {
      lines.push('🌑 CANNOT SEE SKY - you are deep underground or enclosed');
    }

    // Top blocks seen
    const blockEntries = Array.from(obs.blocksVisible.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (blockEntries.length > 0) {
      lines.push(`👁️ BLOCKS SEEN: ${blockEntries.map(([name, count]) => `${name}(${count})`).join(', ')}`);
    }

    // Recommendation
    if (obs.recommendation) {
      lines.push(`💡 RECOMMENDATION: ${obs.recommendation}`);
    }

    lines.push(`(Observed ${Math.round(age / 1000)}s ago)`);

    return lines.join('\n');
  }

  /**
   * Build AUTONOMOUS context - JSON format for efficient parsing
   */
  private buildAutonomousContext(gameState: GameState): string {
    const meta = gameState.metadata as any;
    const pos = meta.position;
    const spatial = meta.spatialObservation;
    const sem = spatial?.semantic;

    const hp = meta.health || 20;
    const food = meta.food || 20;
    const time = meta.time || 'day';

    // Build compact JSON context
    const context: Record<string, any> = {
      pos: pos ? [Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)] : [0, 0, 0],
      hp,
      food,
      time,
    };

    // ALERTS - critical state warnings (priority system)
    const alerts: string[] = [];
    if (hp < 10) alerts.push('LOW_HP');
    if (food < 6) alerts.push('HUNGRY');
    
    // Night mode - check if has shelter materials
    if (time === 'night' || time === 'evening') {
      const hasSword = meta.inventory?.some((i: any) => i.name.includes('sword'));
      const hasBlocks = meta.inventory?.some((i: any) => 
        ['dirt', 'cobblestone', 'stone', 'planks'].some(b => i.name.includes(b))
      );
      if (hasSword) {
        alerts.push('NIGHT_SAFE'); // Has weapon, can fight
      } else if (hasBlocks) {
        alerts.push('NIGHT_BUILD_SHELTER'); // Build shelter with blocks
      } else {
        alerts.push('NIGHT_DIG_SHELTER'); // Dig into ground for safety
      }
    }

    // Check for hostile mobs (comprehensive list for all dimensions)
    const hostileMobs = [
      // Overworld common
      'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime',
      // Overworld variants
      'drowned', 'husk', 'stray', 'cave_spider', 'phantom', 'silverfish',
      // Pillagers & raids
      'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'illusioner',
      // Nether
      'blaze', 'ghast', 'magma_cube', 'wither_skeleton', 'hoglin', 'piglin_brute', 'zoglin',
      // End
      'shulker', 'endermite',
      // Bosses
      'wither', 'ender_dragon', 'elder_guardian', 'guardian', 'warden',
      // Hostile when provoked
      'zombified_piglin', 'polar_bear', 'iron_golem', 'bee' // These attack when provoked
    ];
    const nearbyHostile = meta.nearbyEntities?.find((e: string) =>
      hostileMobs.some(h => e.toLowerCase().includes(h))
    );
    if (nearbyHostile) alerts.push(`HOSTILE:${nearbyHostile}`);

    // === HEALTH DANGER ALERTS (from real-time health monitoring) ===
    const healthAlert = meta.healthAlert;
    if (healthAlert) {
      // Under attack - taking damage right now!
      if (healthAlert.isUnderAttack) {
        alerts.push(`UNDER_ATTACK:${healthAlert.attacker || 'unknown'}`);
      }
      
      // Recent damage in last 5 seconds
      if (healthAlert.recentDamage >= 3) {
        alerts.push(`TAKING_DAMAGE:${healthAlert.recentDamage.toFixed(0)}`);
      }
      
      // Nearby hostiles with distance (much more actionable than just "hostile nearby")
      if (healthAlert.nearbyHostiles && healthAlert.nearbyHostiles.length > 0) {
        const closest = healthAlert.nearbyHostiles[0];
        if (closest.distance <= 5) {
          alerts.push(`DANGER_CLOSE:${closest.name}@${closest.distance.toFixed(0)}m`);
        } else if (closest.distance <= 10) {
          alerts.push(`THREAT_NEARBY:${closest.name}@${closest.distance.toFixed(0)}m`);
        }
      }
      
      // Critical health - FLEE NOW
      if (hp <= 6) {
        alerts.push('CRITICAL_HP_FLEE_NOW');
      }
    }

    // === STUCK/WATER/LAVA ALERTS ===
    const stuckInfo = meta.stuckInfo;
    if (stuckInfo) {
      if (stuckInfo.inLava) {
        // LAVA IS CRITICAL - highest priority environmental danger!
        alerts.push('IN_LAVA_CRITICAL');
      } else if (stuckInfo.headInWater) {
        // HEAD IN WATER = DROWNING! This is critical!
        alerts.push('DROWNING_CRITICAL');
      } else if (stuckInfo.inWater) {
        alerts.push('IN_WATER');
      }
      if (stuckInfo.isStuck) {
        alerts.push(`STUCK:${stuckInfo.blockedMoves}x_blocked`);
      }
      if (stuckInfo.inRecovery) {
        alerts.push('RECOVERY_MODE');
      }
    }

    if (alerts.length > 0) context.alerts = alerts;

    // Inventory - compact array
    if (meta.inventory?.length > 0) {
      context.inv = meta.inventory.slice(0, 8).map((i: any) => `${i.name}:${i.count}`);

      // Check if has food (comprehensive list for accurate detection)
      const foodItems = [
        'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit',
        'cooked_salmon', 'cooked_cod', 'steak', 'bread', 'apple', 'golden_apple', 'enchanted_golden_apple',
        'carrot', 'golden_carrot', 'baked_potato', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries',
        'pumpkin_pie', 'cookie', 'cake', 'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'suspicious_stew',
        'dried_kelp', 'honey_bottle', 'chorus_fruit', 'rotten_flesh' // emergency food
      ];
      const hasFood = meta.inventory.some((i: any) => foodItems.some(f => i.name.includes(f)));
      if (hasFood) context.hasFood = true;

      // Check if has tools - separate pickaxe (for stone/ore) and axe (for wood)
      const hasPickaxe = meta.inventory.some((i: any) => i.name.includes('pickaxe'));
      const hasAxe = meta.inventory.some((i: any) => i.name.includes('_axe') && !i.name.includes('pickaxe'));
      const hasSword = meta.inventory.some((i: any) => i.name.includes('sword'));
      if (hasPickaxe) context.hasPickaxe = true;
      if (hasAxe) context.hasAxe = true;
      if (hasSword) context.hasSword = true;

      // CRAFTING KNOWLEDGE - Tell the LLM what it CAN craft from current inventory
      // Check if crafting table is nearby (from spatial observation)
      const hasCraftingTableNearby = meta.spatialObservation?.semantic?.nearestFunctionalBlock?.type === 'crafting_table' ||
        meta.inventory.some((i: any) => i.name === 'crafting_table');

      const craftingContext = buildCraftableItemsContext(meta.inventory, hasCraftingTableNearby, 8);
      if (craftingContext) {
        context.crafting = craftingContext;
      }

      // Suggested next craft for progression
      const suggestion = getSuggestedCraft(meta.inventory, hasCraftingTableNearby);
      if (suggestion) {
        context.suggestCraft = `${suggestion.suggestion} (${suggestion.reason})`;
      }
    }

    // Blocks around (only non-air)
    if (spatial?.grid) {
      const blocks: Record<string, string> = {};
      const above = spatial.grid.above?.center?.name;
      if (above && above !== 'air') blocks.above = above;
      const c = spatial.grid.current;
      if (c?.n?.name && c.n.name !== 'air') blocks.n = c.n.name;
      if (c?.s?.name && c.s.name !== 'air') blocks.s = c.s.name;
      if (c?.e?.name && c.e.name !== 'air') blocks.e = c.e.name;
      if (c?.w?.name && c.w.name !== 'air') blocks.w = c.w.name;
      if (Object.keys(blocks).length > 0) context.blocks = blocks;
    }

    // Environment flags
    if (sem) {
      if (sem.isUnderground) context.underground = true;
      if (sem.inWater) context.inWater = true;
      if (sem.nearestTree) {
        const treeDist = Math.round(sem.nearestTree.distance);
        // Include direction hint if tree is too far to mine (threshold: 4 blocks)
        if (treeDist > 4 && sem.nearestTree.position && pos) {
          // Calculate cardinal direction from player to tree
          const dx = sem.nearestTree.position.x - pos.x;
          const dz = sem.nearestTree.position.z - pos.z;
          let dir = '';
          // Primary direction (larger component)
          if (Math.abs(dz) > Math.abs(dx)) {
            dir = dz < 0 ? 'north' : 'south';
          } else {
            dir = dx > 0 ? 'east' : 'west';
          }
          context.tree = `${treeDist}m_${dir}`;  // e.g. "7m_east"
        } else {
          context.tree = treeDist;
        }
      }
    }

    // Nearby passive mobs (food sources)
    const passiveMobs = ['cow', 'pig', 'sheep', 'chicken'];
    const nearbyFood = meta.nearbyEntities?.filter((e: string) =>
      passiveMobs.some(p => e.toLowerCase().includes(p))
    );
    if (nearbyFood?.length > 0) context.animals = nearbyFood.slice(0, 3);

    // Recent actions - with error info for failures (5 for pattern detection)
    if (this.actionHistory.length > 0) {
      context.recent = this.actionHistory.slice(-5).map(e => {
        const entry: any = {
          a: e.action.type,
          ok: e.success,
        };
        if (e.action.target) entry.t = e.action.target;
        if (!e.success && e.result) {
          // Extract error type from result with distance info
          const result = e.result.toLowerCase();
          if (result.includes('unknown item')) {
            // AI used wrong item name - extract what was tried
            entry.err = `invalid_item_name:${e.action.target}`;
          }
          else if (result.includes('no recipe')) entry.err = 'no_recipe:need_materials_or_table';
          else if (result.includes('missing')) entry.err = 'missing_materials';
          else if (result.includes('blocked') || result.includes('path')) entry.err = 'path_blocked';
          else if (result.includes('reach') || result.includes('find')) {
            // Try to extract distance from error like "Cannot reach oak_log (11.8 blocks away..."
            const distMatch = e.result.match(/(\d+\.?\d*)\s*blocks?\s*away/i);
            if (distMatch) {
              entry.err = `cannot_reach:${Math.round(parseFloat(distMatch[1]))}m`;
            } else {
              entry.err = 'cannot_reach';
            }
          }
          else if (result.includes('pickaxe') || result.includes('requires pick')) entry.err = 'need_pickaxe';
          else if (result.includes('tool')) entry.err = 'need_tool';
          else entry.err = e.result.substring(0, 30);
        }
        return entry;
      });
    }

    // Emotional state - compact format for AI awareness
    const emotionalState = emotionManager.getState();
    if (emotionalState.dominantIntensity > 30) {
      context.mood = emotionalState.mood;
      context.feeling = `${emotionalState.dominant}:${Math.round(emotionalState.dominantIntensity)}%`;

      // Add specific emotional hints that should influence behavior
      if (emotionalState.emotions.frustration > 40) {
        context.frustrated = true;  // Should try different approach
      }
      if (emotionalState.emotions.fear > 40) {
        context.anxious = true;  // Should prioritize safety
      }
      if (emotionalState.emotions.boredom > 50) {
        context.bored = true;  // Should try something new
      }
    }

    // Experience Memory - cross-session learning (Option 1 & 2)
    // Build context for similarity matching
    const memoryQueryContext = {
      position: meta.position || { x: 0, y: 0, z: 0 },
      health: meta.health || 20,
      food: meta.food || 20,
      inventory: (meta.inventory || []).map((i: any) => i.name),
      nearbyBlocks: spatial?.semantic?.nearestTree
        ? [spatial.semantic.nearestTree.type]
        : [],
      nearbyEntities: meta.nearbyEntities || [],
      time: meta.time || 'day',
      recentActions: this.actionHistory.slice(-5).map(h => ({
        type: h.action.type,
        target: h.action.target || '',
        success: h.success,
      })),
    };

    const memoryContext = experienceMemory.buildMemoryContext(memoryQueryContext);
    if (memoryContext) {
      context.memory = memoryContext;
    }

    return JSON.stringify(context);
  }

  /**
   * Fast-path decisions that skip AI for obvious situations
   * Returns null if no fast decision is possible
   */
  private getFastPathDecision(gameState: GameState): GameAction | null {
    const meta = gameState.metadata as any;
    const hp = meta.health || 20;
    const food = meta.food || 20;
    const inventory = meta.inventory || [];
    const stuckInfo = meta.stuckInfo;
    const healthAlert = meta.healthAlert;

    // === FAST PATH 1: CRITICAL HEALTH + HAS FOOD = EAT ===
    // Comprehensive food list - prioritizes high-saturation foods first
    const allFoodItems = [
      // Best foods (high saturation) - eat these first!
      'golden_apple', 'enchanted_golden_apple', 'golden_carrot', 'steak', 'cooked_beef',
      'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'rabbit_stew', 'mushroom_stew',
      // Good foods
      'cooked_chicken', 'cooked_rabbit', 'cooked_cod', 'bread', 'baked_potato', 'beetroot_soup',
      'pumpkin_pie', 'suspicious_stew',
      // Okay foods
      'apple', 'carrot', 'melon_slice', 'sweet_berries', 'glow_berries', 'beetroot', 'cookie',
      'dried_kelp', 'honey_bottle', 'cake', 'chorus_fruit',
      // Emergency foods (low saturation or negative effects)
      'raw_beef', 'raw_porkchop', 'raw_chicken', 'raw_mutton', 'raw_rabbit', 'raw_cod', 'raw_salmon',
      'porkchop', 'beef', 'chicken', 'mutton', 'rabbit', // raw variants
      'rotten_flesh', 'spider_eye', 'poisonous_potato' // last resort!
    ];

    if (hp < 8) {
      const hasFood = inventory.find((i: any) => allFoodItems.some(f => i.name.includes(f)));
      if (hasFood) {
        logger.info('[FAST-PATH] Critical HP, eating immediately', { hp, food: hasFood.name });
        return { type: 'eat', target: hasFood.name, reasoning: `[INSTANT] Critical HP (${hp.toFixed(0)}), eating ${hasFood.name}` };
      }
    }

    // === FAST PATH 2: IN LAVA = IMMEDIATE RECOVER (CRITICAL!) ===
    // Lava is the most dangerous - triggers instant recovery regardless of other state
    if (stuckInfo?.inLava && !stuckInfo.inRecovery) {
      logger.warn('[FAST-PATH] 🔥 IN LAVA! Triggering emergency recovery');
      return { type: 'recover', target: '', reasoning: '[CRITICAL] In LAVA! Emergency escape!' };
    }

    // === FAST PATH 2b: HEAD IN WATER = DROWNING (CRITICAL!) ===
    // Drowning kills quickly - trigger recovery immediately
    // FIX: Skip if we just escaped water recently (prevents infinite loop when slipping back in)
    if (stuckInfo?.headInWater && !stuckInfo.inRecovery && !stuckInfo.recentlyEscapedWater) {
      logger.warn('[FAST-PATH] 🏊 DROWNING! Head underwater - triggering emergency recovery');
      return { type: 'recover', target: '', reasoning: '[CRITICAL] DROWNING! Head underwater!' };
    }
    if (stuckInfo?.headInWater && stuckInfo.recentlyEscapedWater) {
      logger.info('[FAST-PATH] Skipping drowning trigger - recently escaped water (cooldown active)');
    }

    // === FAST PATH 3: STUCK 3+ TIMES = RECOVER ===
    // But DON'T trigger if recovery is already in progress!
    if (stuckInfo?.isStuck && stuckInfo.blockedMoves >= 3 && !stuckInfo.inRecovery) {
      logger.info('[FAST-PATH] Severely stuck, triggering recovery', { blockedMoves: stuckInfo.blockedMoves });
      return { type: 'recover', target: '', reasoning: `[INSTANT] Stuck ${stuckInfo.blockedMoves}x, recovering` };
    }

    // === FAST PATH 4: IN WATER = RECOVER ===
    // But DON'T trigger if recovery is already in progress - let it finish!
    // FIX: Also skip if recently escaped water (prevents infinite loop)
    if (stuckInfo?.inWater && !stuckInfo.inRecovery && !stuckInfo.recentlyEscapedWater) {
      logger.info('[FAST-PATH] In water, triggering recovery');
      return { type: 'recover', target: '', reasoning: '[INSTANT] In water, need to escape' };
    }

    // If recovery IS in progress, skip all fast-paths and let it complete
    if (stuckInfo?.inRecovery) {
      logger.info('[FAST-PATH] Recovery in progress, skipping fast-path to let it complete');
      return null;
    }

    // === FAST PATH 5: HUNGRY + HAS FOOD = EAT ===
    if (food < 6) {
      // Reuse the comprehensive food list from above
      const hasFood = inventory.find((i: any) => allFoodItems.some(f => i.name.includes(f)));
      if (hasFood) {
        logger.info('[FAST-PATH] Hungry, eating', { food, item: hasFood.name });
        return { type: 'eat', target: hasFood.name, reasoning: `[INSTANT] Hungry (${food}), eating ${hasFood.name}` };
      }
    }

    // === FAST PATH 5: TREE WITHIN 4 BLOCKS + NO LOGS = MINE ===
    const hasLogs = inventory.some((i: any) => i.name.includes('log'));
    const nearestTree = meta.spatialObservation?.semantic?.nearestTree;
    if (!hasLogs && nearestTree && nearestTree.distance <= 4) {
      logger.info('[FAST-PATH] No logs, tree nearby, mining', { tree: nearestTree.type, distance: nearestTree.distance });
      return { type: 'mine', target: nearestTree.type, reasoning: `[INSTANT] No wood, mining ${nearestTree.type} (${nearestTree.distance.toFixed(1)}m away)` };
    }

    // No fast path available - need AI decision
    return null;
  }

  /**
   * AUTONOMOUS decision making - minimal prompt, trusts LLM reasoning
   */
  private async makeAutonomousDecision(
    gameState: GameState,
    recentChat: ChatMessage[] = []
  ): Promise<GameAction> {
    // Track game state for learning system
    this.lastGameState = gameState;
    this.lastDecisionTime = Date.now();

    // === TRY FAST PATH FIRST ===
    // Skip AI entirely for obvious decisions (saves 8-40 seconds!)
    const fastDecision = this.getFastPathDecision(gameState);
    if (fastDecision) {
      logger.info('[FAST-PATH] Skipping AI, using instant decision', {
        action: fastDecision.type,
        target: fastDecision.target,
      });
      return fastDecision;
    }

    logger.info('[AUTONOMOUS] Making decision with minimal context');

    // Build simple context
    let contextMessage = this.buildAutonomousContext(gameState);

    // Log what the AI "learned" from action history
    if (this.actionHistory.length > 0) {
      const recentActions = this.actionHistory.slice(-5);
      const successCount = recentActions.filter(a => a.success).length;
      const failCount = recentActions.length - successCount;
      const consecutiveFailures = this.getConsecutiveFailures();

      // Detect patterns with ACTIONABLE insights
      const patterns: string[] = [];
      if (consecutiveFailures >= 2) {
        patterns.push(`⚠️ ${consecutiveFailures} consecutive failures - TRY COMPLETELY DIFFERENT APPROACH`);
      }

      // DETECT REPETITIVE SUCCESS - doing the same thing forever is BORING!
      const recentSuccesses = recentActions.filter(a => a.success);
      if (recentSuccesses.length >= 2) {
        const successSignatures = recentSuccesses.map(a => `${a.action.type}:${a.action.target}`);
        const successCounts: Record<string, number> = {};
        for (const sig of successSignatures) {
          successCounts[sig] = (successCounts[sig] || 0) + 1;
        }
        
        // Find most repeated successful action - trigger at just 2 repeats!
        for (const [signature, count] of Object.entries(successCounts)) {
          if (count >= 2) {
            const [actionType, target] = signature.split(':');
            patterns.push(`🔄 BORING: You did "${actionType} ${target}" ${count}x already! DO SOMETHING DIFFERENT NOW - move around, explore, mine trees, craft tools. Viewers want variety!`);
            logger.warn('[LEARNING] 🔄 REPETITIVE ACTION - NEED VARIETY', { 
              action: actionType,
              target: target,
              count: count 
            });
          }
        }
      }

      // DETECT MOVEMENT LOOPS - bot going back and forth without reaching destination
      const moveActions = recentActions.filter(a => a.action.type === 'move');
      if (moveActions.length >= 3) {
        const failedMoves = moveActions.filter(a => !a.success);
        const directions = failedMoves.map(a => a.action.target);
        
        // Check if same directions keep failing
        if (failedMoves.length >= 2) {
          const uniqueDirs = [...new Set(directions)];
          patterns.push(`🔄 STUCK: Movement to ${uniqueDirs.join(', ')} keeps failing - STOP MOVING, try: eat food, place crafting_table, craft tools, or mine blocks to create new path`);
          logger.warn('[LEARNING] 🔄 MOVEMENT STUCK DETECTED', { 
            failedDirections: uniqueDirs,
            failCount: failedMoves.length 
          });
        }
        
        // Check for back-and-forth pattern (north-west-north-west...)
        if (directions.length >= 4) {
          const last4 = directions.slice(-4);
          const isLooping = (last4[0] === last4[2] && last4[1] === last4[3]) || 
                           (last4[0] === last4[1] && last4[2] === last4[3]);
          if (isLooping) {
            patterns.push(`🔄 LOOP DETECTED: Repeating ${last4.join('→')} - This direction doesn't work! Try: dig_up, mine stone to create passage, or completely different action`);
            logger.warn('[LEARNING] 🔄 MOVEMENT LOOP DETECTED', { 
              pattern: last4.join('→') 
            });
          }
        }
      }

      // Analyze failed actions with their error reasons
      const failedActions = recentActions.filter(a => !a.success);
      const failureInsights: string[] = [];
      
      for (const failed of failedActions) {
        const resultLower = failed.result.toLowerCase();
        const action = failed.action;
        
        // Extract actionable insights from failure messages
        if (resultLower.includes('unknown item')) {
          failureInsights.push(`"${action.target}" is not a valid Minecraft item name - check spelling/format`);
        } else if (resultLower.includes('no recipe')) {
          failureInsights.push(`Cannot craft ${action.target} - missing materials or need crafting_table`);
        } else if (resultLower.includes('requires pickaxe') || resultLower.includes('requires pick')) {
          failureInsights.push(`${action.target} requires a pickaxe to mine - craft wooden_pickaxe first`);
        } else if (resultLower.includes('requires axe')) {
          failureInsights.push(`${action.target} is faster with axe - craft wooden_axe`);
        } else if (resultLower.includes('missing')) {
          failureInsights.push(`Need more materials for ${action.target}`);
        } else if (resultLower.includes('blocked') || resultLower.includes('no path')) {
          failureInsights.push(`Path to ${action.target || 'target'} is blocked - try different direction`);
        } else if (resultLower.includes('not collected')) {
          failureInsights.push(`Mined ${action.target} but didn't collect - wrong tool or item fell`);
        } else if (resultLower.includes("couldn't reach") || resultLower.includes('remaining')) {
          // Movement failed to reach destination
          failureInsights.push(`Cannot reach ${action.target} - path is blocked/obstructed. Try: mine through obstacles, dig_up, or find different route`);
        } else if (resultLower.includes('suitable spot') || resultLower.includes('clear ground')) {
          // Can't place block
          failureInsights.push(`Cannot place ${action.target} here - need to find/create clear ground nearby`);
        }
      }
      
      // Add unique failure insights
      const uniqueInsights = [...new Set(failureInsights)];
      if (uniqueInsights.length > 0) {
        patterns.push(`🔴 FAILURES: ${uniqueInsights.join('; ')}`);
      }

      // Check for repeated failed targets (still useful)
      const failedTargets = failedActions
        .map(a => a.action.target)
        .filter(Boolean);
      const uniqueFailedTargets = [...new Set(failedTargets)];
      if (uniqueFailedTargets.length > 0) {
        patterns.push(`❌ AVOID these targets: ${uniqueFailedTargets.join(', ')}`);
      }

      // Check for successful patterns
      const successfulActions = recentActions
        .filter(a => a.success)
        .map(a => `${a.action.type}${a.action.target ? `:${a.action.target}` : ''}`);
      if (successfulActions.length > 0) {
        patterns.push(`✓ Working: ${successfulActions.join(', ')}`);
      }

      const learningData = {
        recentActions: recentActions.map(a => ({
          action: `${a.action.type}${a.action.target ? `:${a.action.target}` : ''}`,
          success: a.success,
          result: a.result.substring(0, 40),
        })),
        stats: { success: successCount, failed: failCount, consecutiveFailures },
        patterns,
      };

      logger.info('[AUTONOMOUS] Learning from history', learningData);

      // Log to file
      logLearning({
        timestamp: new Date().toISOString(),
        phase: 'learning',
        content: learningData,
      });

      // CRITICAL: Add patterns to context so AI can learn from them!
      if (patterns.length > 0) {
        contextMessage += `\n\n⚡ LEARNING FROM FAILURES:\n${patterns.join('\n')}`;
      }
    }

    // Check for severe stuck loop - HIGHEST PRIORITY warning
    const stuckWarning = this.getStuckLoopWarning();
    if (stuckWarning) {
      contextMessage = stuckWarning + '\n\n' + contextMessage;
    }

    // === LEARNING SYSTEM INTEGRATION ===
    // Add learned patterns and context from the three-tier learning system
    const learningSystem = getLearningSystem();
    if (learningSystem) {
      const meta = gameState.metadata as any;
      const compactContext = learningSystem.buildCompactContext(meta);
      const learningContext = learningSystem.buildContextForAI(compactContext);
      if (learningContext) {
        contextMessage += '\n\n' + learningContext;
      }

      // Use learning system's stuck detection (more comprehensive)
      const learnedStuckWarning = learningSystem.getStuckLoopWarning();
      if (learnedStuckWarning && !stuckWarning) {
        contextMessage = learnedStuckWarning + '\n\n' + contextMessage;
      }
    }

    // Add chat if any
    let fullContext = contextMessage;
    if (recentChat.length > 0) {
      fullContext += '\n\nRecent chat:\n';
      recentChat.slice(-3).forEach((msg) => {
        fullContext += `${msg.username}: ${msg.message}\n`;
      });
    }

    const conversation: AIMessage[] = [
      {
        role: 'system',
        content: MINECRAFT_AUTONOMOUS_PROMPT,
      },
      {
        role: 'user',
        content: fullContext,
      }
    ];

    try {
      const apiCallStart = Date.now();

      // === TIMEOUT-PROTECTED AI CALL ===
      // If AI takes too long, use smart fallback to keep stream alive!
      let response: { content: string; tokens: { total: number } };
      let usedFallback = false;

      const aiPromise = openRouterClient.chat(conversation, {
        maxTokens: 300,  // Reduced from 800 - we only need a short JSON response
        temperature: 0.1,  // Lower for more deterministic
        reasoning: {
          effort: 'none',
          exclude: true,
        }
      });

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), AI_DECISION_TIMEOUT_MS);
      });

      const result = await Promise.race([aiPromise, timeoutPromise]);

      if (result === null) {
        // TIMEOUT! AI took too long - use smart fallback
        usedFallback = true;
        const fallbackAction = this.getSmartFallbackAction(gameState);
        logger.warn('[AI-TIMEOUT] AI decision took too long, using fallback', {
          timeoutMs: AI_DECISION_TIMEOUT_MS,
          fallback: `${fallbackAction.type}:${fallbackAction.target || 'none'}`,
        });
        return fallbackAction;
      }

      response = result;
      const apiCallDuration = Date.now() - apiCallStart;
      
      // Log if AI was slow but didn't timeout
      if (apiCallDuration > 5000) {
        logger.warn('[AI-SLOW] AI decision was slow but completed', {
          duration: `${apiCallDuration}ms`,
          threshold: `${AI_DECISION_TIMEOUT_MS}ms`,
        });
      }

      // Parse action from response
      const action = this.parseGameAction(response.content);

      // Store decision context for logging when result comes back
      const meta = gameState.metadata as any;
      this.pendingDecision = {
        context: {
          position: meta.position || { x: 0, y: 0, z: 0 },
          health: meta.health || 20,
          food: meta.food || 20,
          inventory: (meta.inventory || []).map((i: any) => i.name),
          nearbyBlocks: meta.spatialObservation?.semantic?.nearestTree
            ? [meta.spatialObservation.semantic.nearestTree.type]
            : [],
          nearbyEntities: meta.nearbyEntities || [],
          time: meta.time || 'day',
          recentActions: this.actionHistory.slice(-5).map(h => ({
            type: h.action.type,
            target: h.action.target || '',
            success: h.success,
          })),
        },
        decision: {
          type: action.type,
          target: action.target || '',
          reasoning: action.reasoning || '',
        },
      };

      // Log what we're sending to the AI (parsed for readability)
      try {
        const parsedContext = JSON.parse(contextMessage);
        const contextData = {
          position: parsedContext.pos,
          hp: parsedContext.hp,
          food: parsedContext.food,
          time: parsedContext.time,
          alerts: parsedContext.alerts || [],
          inventory: parsedContext.inv?.slice(0, 5) || [],
          hasTools: { pickaxe: parsedContext.hasPickaxe, sword: parsedContext.hasSword, food: parsedContext.hasFood },
          environment: { underground: parsedContext.underground, tree: parsedContext.tree, animals: parsedContext.animals },
          recentActions: parsedContext.recent || [],
        };

        logger.info('[AUTONOMOUS] Context sent to AI', contextData);

        // Log to file
        logLearning({
          timestamp: new Date().toISOString(),
          phase: 'context',
          content: contextData,
        });
      } catch {
        // If parse fails, log raw
        logger.debug('[AUTONOMOUS] Raw context', { context: contextMessage.substring(0, 200) });
      }

      const decisionData = {
        action: action.type,
        target: action.target,
        reasoning: action.reasoning,
        tokens: response.tokens.total,
        duration: `${apiCallDuration}ms`,
      };

      logger.info('[AUTONOMOUS] Decision made', decisionData);

      // Log to file
      logLearning({
        timestamp: new Date().toISOString(),
        phase: 'decision',
        content: decisionData,
      });

      return action;
    } catch (error) {
      logger.error('[AUTONOMOUS] Decision failed', { error });
      return {
        type: 'wait',
        reasoning: 'Error occurred, waiting',
      };
    }
  }

  /**
   * Get a COMPACT summary of recent actions (optimized for token usage)
   */
  private getActionHistorySummary(): string {
    if (this.actionHistory.length === 0) {
      return '';
    }

    const lines: string[] = [];
    const consecutiveFailures = this.getConsecutiveFailures();

    // Only add warning if stuck
    if (consecutiveFailures >= 3) {
      lines.push(`⚠️ ${consecutiveFailures} failures - try different approach`);
    }

    // Show last 5 actions for better pattern detection
    const recentActions = this.actionHistory.slice(-5);
    lines.push('Recent:');
    recentActions.forEach((entry) => {
      const status = entry.success ? '✓' : '✗';
      const target = entry.action.target ? ` ${entry.action.target}` : '';
      lines.push(`[${status}] ${entry.action.type}${target}: ${entry.result.substring(0, 50)}`);
    });

    return lines.join('\n');
  }

  /**
   * Make a decision about what action to take in the game
   */
  async makeGameDecision(
    gameState: GameState,
    recentChat: ChatMessage[] = []
  ): Promise<GameAction> {
    // 3-tier stuck detection based on research (Voyager, GITM)
    const consecutiveFailures = this.getConsecutiveFailures();

    // Determine thinking mode based on failure count
    let thinkingMode: 'fast' | 'smart' | 'deep';
    if (consecutiveFailures >= 6) {
      thinkingMode = 'deep';  // Truly stuck, need deep ReAct reasoning
    } else if (consecutiveFailures >= 3) {
      thinkingMode = 'smart';  // Moderately stuck, need more thinking
    } else {
      thinkingMode = 'fast';  // Normal gameplay, quick decisions
    }

    logger.debug('Making game decision', {
      game: gameState.name,
      status: gameState.status,
      chatMessages: recentChat.length,
      consecutiveFailures,
      thinkingMode,
      autonomousMode: AUTONOMOUS_MODE,
      description: thinkingMode === 'deep' ? 'DEEP (ReAct reasoning)' :
                   thinkingMode === 'smart' ? 'SMART (moderate thinking)' :
                   'FAST (quick action)',
    });

    // AUTONOMOUS MODE: Use simplified context and minimal prompt
    if (AUTONOMOUS_MODE && config.game.mode === 'minecraft') {
      return this.makeAutonomousDecision(gameState, recentChat);
    }

    // OPTIMIZED LEGACY MODE: Lean context builder for fast token usage
    const meta = gameState.metadata as any;
    const contextParts: string[] = [];

    // Basic status - compact
    if (meta.position) {
      contextParts.push(`Pos: ${meta.position.x?.toFixed(0)}, ${meta.position.y?.toFixed(0)}, ${meta.position.z?.toFixed(0)}`);
    }
    contextParts.push(`HP: ${meta.health || 20}/20, Food: ${meta.food || 20}/20, Time: ${meta.time || 'day'}`);

    // Inventory - compact
    if (meta.inventory && meta.inventory.length > 0) {
      const inv = meta.inventory.slice(0, 8).map((i: any) => `${i.name}x${i.count}`).join(', ');
      contextParts.push(`Inv: ${inv}`);
    } else {
      contextParts.push('Inv: empty');
    }

    // Spatial info - only essential
    const spatialObs = meta.spatialObservation;
    if (spatialObs?.semantic) {
      const sem = spatialObs.semantic;
      const info: string[] = [];
      if (sem.isUnderground) info.push('underground');
      if (sem.canSeeSky) info.push('can see sky');
      if (sem.inWater) info.push('IN WATER');
      if (info.length > 0) contextParts.push(`Env: ${info.join(', ')}`);

      // Key resources
      if (sem.nearestTree) {
        contextParts.push(`Tree: ${sem.nearestTree.type} ${sem.nearestTree.distance.toFixed(0)}m away`);
      }
      if (sem.brightestDirection && !sem.brightestDirection.hasWaterInPath) {
        contextParts.push(`Exit: ${sem.brightestDirection.direction} (${sem.brightestDirection.distance}m)`);
      }
    }

    // Grid blocks - very compact
    if (spatialObs?.grid) {
      const above = spatialObs.grid.above?.center?.name || 'air';
      const current = spatialObs.grid.current;
      if (above !== 'air') contextParts.push(`Above: ${above}`);
      if (current) {
        const dirs: string[] = [];
        if (current.n?.name && current.n.name !== 'air') dirs.push(`N:${current.n.name}`);
        if (current.s?.name && current.s.name !== 'air') dirs.push(`S:${current.s.name}`);
        if (current.e?.name && current.e.name !== 'air') dirs.push(`E:${current.e.name}`);
        if (current.w?.name && current.w.name !== 'air') dirs.push(`W:${current.w.name}`);
        if (dirs.length > 0) contextParts.push(`Around: ${dirs.join(', ')}`);
      }
    }

    // Action history - compact
    const actionSummary = this.getActionHistorySummary();
    if (actionSummary) contextParts.push(actionSummary);

    // Nearby entities
    if (meta.nearbyEntities && meta.nearbyEntities.length > 0) {
      contextParts.push(`Nearby: ${meta.nearbyEntities.slice(0, 3).join(', ')}`);
    }

    // Emotional context
    const emotionalContext = emotionManager.getContextForAI();
    if (emotionalContext) {
      contextParts.push(emotionalContext);
    }

    // Underground warning - brief
    const yPos = meta.position?.y;
    if (yPos !== undefined && yPos < 50) {
      contextParts.push(`⚠️ Underground (Y=${yPos.toFixed(0)}) - use dig_up to escape!`);
    }

    // Recent chat - minimal
    if (recentChat.length > 0) {
      const lastChat = recentChat.slice(-2).map(m => `${m.username}: ${m.message}`).join('; ');
      contextParts.push(`Chat: ${lastChat}`);
    }

    contextParts.push('\nAction?');

    const contextMessage = contextParts.join('\n');

    // Create a temporary conversation with appropriate prompt
    // 3-tier system: FAST → SMART (FAST again) → DEEP (ADVANCED)
    let promptToUse: string;
    if (config.game.mode === 'minecraft') {
      if (thinkingMode === 'deep') {
        promptToUse = MINECRAFT_ADVANCED_SYSTEM_PROMPT;  // Full ReAct reasoning
      } else {
        promptToUse = MINECRAFT_FAST_SYSTEM_PROMPT;  // Fast/smart both use fast prompt
      }
    } else {
      promptToUse = this.systemPrompt;
    }

    const tempConversation: AIMessage[] = [
      {
        role: 'system',
        content: promptToUse,
      },
      {
        role: 'user',
        content: contextMessage,
      }
    ];

    try {
      const apiCallStart = Date.now();

      // Configure API call based on thinking mode (research-backed values)
      // FAST:  500 tokens, temp 0.1, ~0.5-1s latency
      // SMART: 2000 tokens, temp 0.2, ~2-4s latency
      // DEEP:  8000 tokens, temp 0.3, ~5-15s latency
      const tokenLimits = { fast: 500, smart: 2000, deep: 8000 };
      const temperatures = { fast: 0.1, smart: 0.2, deep: 0.3 };

      const response = await openRouterClient.chat(tempConversation, {
        maxTokens: tokenLimits[thinkingMode],
        temperature: temperatures[thinkingMode],
        reasoning: {
          effort: 'none',  // Disable extended thinking for speed (all modes)
          exclude: true,   // Don't include reasoning tokens
        }
      });

      const apiCallDuration = Date.now() - apiCallStart;

      // Add response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Keep history minimal (last 6 messages) to reduce token usage
      if (this.conversationHistory.length > 6) {
        this.conversationHistory = [
          this.conversationHistory[0], // Keep system prompt
          ...this.conversationHistory.slice(-5),
        ];
      }

      // Parse action from response
      const action = this.parseGameAction(response.content);

      logger.info('Game decision made', {
        action: action.type,
        target: action.target,
        tokensUsed: response.tokens.total,
        promptTokens: response.tokens.prompt,
        completionTokens: response.tokens.completion,
        apiCallDuration: `${apiCallDuration}ms`,
        responseLength: `${response.content.length} chars`,
        thinkingMode: thinkingMode.toUpperCase(),
        maxTokensAllowed: tokenLimits[thinkingMode],
        temperature: temperatures[thinkingMode],
      });

      return action;
    } catch (error) {
      logger.error('Failed to make game decision', { error });

      // Fallback action
      return {
        type: 'wait',
        reasoning: 'Error occurred, waiting for next opportunity',
      };
    }
  }

  /**
   * Generate a response to chat messages
   */
  async respondToChat(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return '';

    logger.debug('Responding to chat', { messageCount: messages.length });

    const chatContext = messages.map((msg) => `${msg.username}: ${msg.message}`).join('\n');

    const prompt = `Recent chat messages:\n${chatContext}\n\nRespond to the chat naturally. Keep it concise (1-2 sentences). Be engaging and stay in character.`;

    try {
      const response = await openRouterClient.chat([
        {
          role: 'system',
          content: this.systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ], {
        temperature: 0.9,
        maxTokens: 150,
      });

      logger.info('Chat response generated', {
        tokensUsed: response.tokens.total,
      });

      return response.content.trim();
    } catch (error) {
      logger.error('Failed to respond to chat', { error });
      return '';
    }
  }

  /**
   * Analyze game screen using vision
   */
  async analyzeScreen(screenshotUrl: string): Promise<string> {
    logger.debug('Analyzing screen with vision');

    try {
      const analysis = await openRouterClient.analyzeImage(
        screenshotUrl,
        'You are playing a game. Analyze this screenshot and describe what you see. What should you do next?'
      );

      logger.info('Screen analysis complete');

      return analysis.description;
    } catch (error) {
      logger.error('Failed to analyze screen', { error });
      return 'Could not analyze screen';
    }
  }

  /**
   * Generate a thank you message for a donation
   */
  async generateDonationThanks(
    donorAddress: string,
    amountETH: string,
    amountUSD: number,
    message?: string
  ): Promise<string> {
    const prompt = `Someone just donated ${amountETH} ETH ($${amountUSD.toFixed(2)}) to help you reach your goal!${message ? `\nTheir message: "${message}"` : ''}\n\nGenerate a genuine, excited thank you response (1-2 sentences). Show personality and gratitude.`;

    try {
      const response = await openRouterClient.chat([
        {
          role: 'system',
          content: this.systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ], {
        temperature: 0.9,
        maxTokens: 100,
      });

      return response.content.trim();
    } catch (error) {
      logger.error('Failed to generate donation thanks', { error });
      return `Thank you so much for the ${amountETH} ETH donation! This helps me get closer to my goal!`;
    }
  }

  /**
   * Reset conversation history (useful for testing or fresh starts)
   */
  resetHistory() {
    this.conversationHistory = [
      {
        role: 'system',
        content: this.systemPrompt,
      },
    ];
    this.actionHistory = [];
    logger.info('Conversation and action history reset');
  }

  /**
   * Get a smart fallback action when AI times out
   * This keeps the bot active and making progress while waiting for AI
   *
   * CRITICAL: This function must be LEARNING-AWARE to avoid suggesting
   * actions that have been failing repeatedly. Without this check, the bot
   * gets stuck in infinite loops (e.g., dig_up failing 10+ times).
   */
  private getSmartFallbackAction(gameState: GameState): GameAction {
    const meta = gameState.metadata as any;
    const hp = meta.health || 20;
    const food = meta.food || 20;
    const inventory = meta.inventory || [];
    const spatial = meta.spatialObservation?.semantic;

    // CRITICAL: Get recently failed actions to avoid suggesting them
    // This prevents infinite loops like dig_up failing 10+ times
    // Use learning system if available (more comprehensive), fallback to local history
    const learningSystem = getLearningSystem();
    const failedActionTypes = learningSystem
      ? learningSystem.getRecentlyFailedActionTypes(3)
      : this.getRecentlyFailedActionTypes(3);
    const consecutiveFailures = learningSystem
      ? learningSystem.getConsecutiveFailureCount()
      : this.getConsecutiveFailures();
    const mostRecentFailure = learningSystem
      ? learningSystem.getMostRecentFailingActionType()
      : this.getMostRecentFailingActionType();

    // Log what we're avoiding
    if (failedActionTypes.length > 0) {
      logger.info('[FALLBACK] Avoiding recently failed actions', {
        failedActions: failedActionTypes,
        consecutiveFailures,
        mostRecentFailure
      });
    }

    // PRIORITY 0: If severely stuck (3+ consecutive failures), try targeted recovery
    if (consecutiveFailures >= 3) {
      // If dig_up is failing, move horizontally to find new area (dig_up itself mines walls now)
      if (mostRecentFailure === 'dig_up') {
        logger.info('[FALLBACK] dig_up failing, exploring horizontally to find better escape route');
        const dirs = ['north', 'south', 'east', 'west'];
        const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
        return { type: 'move', target: randomDir, reasoning: '[FALLBACK] dig_up stuck - exploring horizontally' };
      }
      // If movement is failing, try recover
      if (mostRecentFailure === 'move') {
        return { type: 'recover', target: '', reasoning: '[FALLBACK] Movement stuck, attempting recovery' };
      }
      // Generic stuck - try recover
      return { type: 'recover', target: '', reasoning: `[FALLBACK] ${consecutiveFailures}x failures, attempting recovery` };
    }

    // Priority 1: SURVIVAL - Low health, need to eat
    if (hp < 10 && !failedActionTypes.includes('eat')) {
      // Comprehensive food list - prioritizes high-saturation foods
      const fallbackFoodItems = [
        'golden_apple', 'enchanted_golden_apple', 'golden_carrot', 'steak', 'cooked_beef',
        'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'rabbit_stew', 'mushroom_stew',
        'cooked_chicken', 'cooked_rabbit', 'cooked_cod', 'bread', 'baked_potato', 'beetroot_soup',
        'pumpkin_pie', 'apple', 'carrot', 'melon_slice', 'sweet_berries', 'glow_berries',
        'beetroot', 'cookie', 'dried_kelp', 'rotten_flesh' // emergency
      ];
      const hasFood = inventory.find((i: any) => fallbackFoodItems.some(f => i.name.includes(f)));
      if (hasFood) {
        return { type: 'eat', target: hasFood.name, reasoning: '[FALLBACK] Low HP, eating to survive' };
      }
    }

    // Priority 2: If no wood, look for trees (if mine isn't failing)
    const hasLogs = inventory.some((i: any) => i.name.includes('log'));
    const hasPlanks = inventory.some((i: any) => i.name.includes('planks'));

    if (!hasLogs && !hasPlanks && !failedActionTypes.includes('mine')) {
      // No wood - need to find/mine trees
      if (spatial?.nearestTree && spatial.nearestTree.distance <= 5) {
        return { type: 'mine', target: spatial.nearestTree.type, reasoning: '[FALLBACK] No wood, mining nearby tree' };
      }
      // Move toward tree if far (if move isn't failing)
      if (spatial?.nearestTree && !failedActionTypes.includes('move')) {
        const dirs = ['north', 'south', 'east', 'west'];
        const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
        return { type: 'move', target: randomDir, reasoning: '[FALLBACK] Looking for trees' };
      }
    }

    // Priority 3: If have logs but no planks, craft planks (if craft isn't failing)
    if (hasLogs && !hasPlanks && !failedActionTypes.includes('craft')) {
      const log = inventory.find((i: any) => i.name.includes('log'));
      if (log) {
        const plankType = log.name.replace('_log', '_planks');
        return { type: 'craft', target: plankType, reasoning: '[FALLBACK] Have logs, crafting planks' };
      }
    }

    // Priority 4: If have planks but no tools, try to craft (if craft isn't failing)
    const hasPickaxe = inventory.some((i: any) => i.name.includes('pickaxe'));
    const hasCraftingTable = inventory.some((i: any) => i.name === 'crafting_table');
    const hasSticks = inventory.some((i: any) => i.name === 'stick');

    if (hasPlanks && !hasSticks && !failedActionTypes.includes('craft')) {
      return { type: 'craft', target: 'stick', reasoning: '[FALLBACK] Need sticks for tools' };
    }

    if (hasPlanks && !hasCraftingTable && !failedActionTypes.includes('craft') &&
        inventory.filter((i: any) => i.name.includes('planks')).reduce((s: number, i: any) => s + i.count, 0) >= 4) {
      return { type: 'craft', target: 'crafting_table', reasoning: '[FALLBACK] Need crafting table' };
    }

    // Priority 5: If underground, try to dig up - BUT ONLY IF DIG_UP ISN'T FAILING
    const yPos = meta.position?.y;
    if (yPos !== undefined && yPos < 50) {
      if (!failedActionTypes.includes('dig_up')) {
        return { type: 'dig_up', target: '', reasoning: '[FALLBACK] Underground, digging up to surface' };
      } else {
        // dig_up is failing - explore horizontally to find new area (dig_up mines walls internally now)
        logger.info('[FALLBACK] dig_up blacklisted, exploring horizontally');
        if (!failedActionTypes.includes('move')) {
          const dirs = ['north', 'south', 'east', 'west'];
          const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
          return { type: 'move', target: randomDir, reasoning: '[FALLBACK] dig_up stuck - exploring horizontally' };
        }
        // If movement also failing, try recover
        if (!failedActionTypes.includes('recover')) {
          return { type: 'recover', target: '', reasoning: '[FALLBACK] Stuck underground, attempting recovery' };
        }
      }
    }

    // Priority 6: Default to random movement to explore (if move isn't failing)
    if (!failedActionTypes.includes('move')) {
      const directions = ['north', 'south', 'east', 'west'];
      const badDirs = Array.from(this.badDirections.keys());
      const safeDirs = directions.filter(d => !badDirs.includes(d));
      const moveDir = safeDirs.length > 0
        ? safeDirs[Math.floor(Math.random() * safeDirs.length)]
        : directions[Math.floor(Math.random() * directions.length)];

      return { type: 'move', target: moveDir, reasoning: '[FALLBACK] AI timeout, exploring' };
    }

    // Last resort: Everything seems to be failing, try recover
    logger.warn('[FALLBACK] All common actions failing, forcing recovery', { failedActionTypes });
    return { type: 'recover', target: '', reasoning: '[FALLBACK] All actions failing, attempting recovery' };
  }

  /**
   * Parse game action from AI response
   * Handles various JSON formats the AI might output
   */
  private parseGameAction(response: string): GameAction {
    try {
      // Method 1: Try to find JSON object with expected structure
      // Use non-greedy match to find the FIRST complete JSON object
      const jsonMatches = response.match(/\{[^{}]*"type"\s*:\s*"[^"]+"/);
      if (jsonMatches) {
        // Find the full JSON starting from this match
        const startIdx = response.indexOf(jsonMatches[0]);
        let braceCount = 0;
        let endIdx = startIdx;

        for (let i = startIdx; i < response.length; i++) {
          if (response[i] === '{') braceCount++;
          if (response[i] === '}') braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }

        const jsonStr = response.substring(startIdx, endIdx);
        const parsed = JSON.parse(jsonStr);

        return {
          type: parsed.type || 'wait',
          target: parsed.target,
          parameters: parsed.parameters,
          reasoning: parsed.reasoning || response.substring(0, 200),
        };
      }

      // Method 2: Fallback - try to find any JSON object (less reliable)
      const fallbackMatch = response.match(/\{[^{}]+\}/);
      if (fallbackMatch) {
        const parsed = JSON.parse(fallbackMatch[0]);
        if (parsed.type) {
          return {
            type: parsed.type,
            target: parsed.target,
            parameters: parsed.parameters,
            reasoning: parsed.reasoning || response.substring(0, 200),
          };
        }
      }

      // If no JSON found, extract reasoning from text
      logger.warn('No valid JSON found in response', {
        responsePreview: response.substring(0, 100)
      });
      return {
        type: 'wait',
        reasoning: response.substring(0, 200),
      };
    } catch (error) {
      logger.warn('Failed to parse game action, using default', {
        error,
        responsePreview: response.substring(0, 100)
      });
      return {
        type: 'wait',
        reasoning: response.substring(0, 200),
      };
    }
  }
}

// Singleton instance
export const aiBrain = new AIBrain();
