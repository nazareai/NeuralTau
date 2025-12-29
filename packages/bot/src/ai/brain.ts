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
import * as fs from 'fs';
import * as path from 'path';

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
      "didn't work", 'unable', 'timeout', 'no recipe', 'missing', 'not found',
      'unknown item', 'unknown', 'invalid', 'no path', 'requires'
    ];

    // Determine success - mining without proper tool should count as failure
    let success: boolean;
    const resultLower = result.toLowerCase();

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
  public isRepeatingFailedAction(): { isRepeating: boolean; actionType?: string; count?: number } {
    if (this.actionHistory.length < 3) {
      return { isRepeating: false };
    }

    const lastThree = this.actionHistory.slice(-3);
    const allFailed = lastThree.every(h => !h.success);
    const sameType = lastThree.every(h => h.action.type === lastThree[0].action.type);

    if (allFailed && sameType) {
      return {
        isRepeating: true,
        actionType: lastThree[0].action.type,
        count: 3
      };
    }

    return { isRepeating: false };
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
    if (time === 'night' || time === 'evening') alerts.push('DARK');

    // Check for hostile mobs
    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager'];
    const nearbyHostile = meta.nearbyEntities?.find((e: string) =>
      hostileMobs.some(h => e.toLowerCase().includes(h))
    );
    if (nearbyHostile) alerts.push(`HOSTILE:${nearbyHostile}`);

    if (alerts.length > 0) context.alerts = alerts;

    // Inventory - compact array
    if (meta.inventory?.length > 0) {
      context.inv = meta.inventory.slice(0, 8).map((i: any) => `${i.name}:${i.count}`);

      // Check if has food
      const foodItems = ['beef', 'pork', 'chicken', 'bread', 'apple', 'carrot', 'potato', 'steak', 'cooked'];
      const hasFood = meta.inventory.some((i: any) => foodItems.some(f => i.name.includes(f)));
      if (hasFood) context.hasFood = true;

      // Check if has tools - separate pickaxe (for stone/ore) and axe (for wood)
      const hasPickaxe = meta.inventory.some((i: any) => i.name.includes('pickaxe'));
      const hasAxe = meta.inventory.some((i: any) => i.name.includes('_axe') && !i.name.includes('pickaxe'));
      const hasSword = meta.inventory.some((i: any) => i.name.includes('sword'));
      if (hasPickaxe) context.hasPickaxe = true;
      if (hasAxe) context.hasAxe = true;
      if (hasSword) context.hasSword = true;
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
   * AUTONOMOUS decision making - minimal prompt, trusts LLM reasoning
   */
  private async makeAutonomousDecision(
    gameState: GameState,
    recentChat: ChatMessage[] = []
  ): Promise<GameAction> {
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

      // Autonomous mode uses minimal settings for speed
      const response = await openRouterClient.chat(conversation, {
        maxTokens: 300,  // Reduced from 800 - we only need a short JSON response
        temperature: 0.1,  // Lower for more deterministic
        reasoning: {
          effort: 'none',
          exclude: true,
        }
      });

      const apiCallDuration = Date.now() - apiCallStart;

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
