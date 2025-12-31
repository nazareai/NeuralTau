/**
 * =============================================================================
 * MINECRAFT AUTONOMOUS AI PLAYER - Human-Like Movement System
 * =============================================================================
 * 
 * This file implements an autonomous Minecraft bot with HUMAN-LIKE behaviors.
 * 
 * ## HUMAN-LIKE MOVEMENT ARCHITECTURE
 * 
 * ### Key Design Principles:
 * 
 * 1. **LOOK BEFORE YOU ACT**
 *    - A human looks at a target BEFORE walking toward it
 *    - Mine sequence: Look → Approach → Pause → Mine → Collect
 *    - NOT: Walk → Spin around → Look → Mine
 * 
 * 2. **DIRECT WALKING FOR SHORT DISTANCES**
 *    - Humans don't invoke mental A* pathfinding to pick up an item 2 feet away
 *    - `walkDirectlyToward()` - for item pickup, final approach (< 8 blocks)
 *    - `navigateWithPathfinder()` - for long distances, complex terrain
 * 
 * 3. **SMOOTH CAMERA TRANSITIONS**
 *    - All look changes use smooth interpolation with easing
 *    - `smoothLookAt()` - for looking at blocks/entities
 *    - Duration scales with angle change for consistent angular velocity
 * 
 * 4. **NATURAL PAUSES**
 *    - Brief pauses between actions (100-200ms) for "settling"
 *    - Post-equip pause, pre-mine pause, post-action pause
 * 
 * 5. **STUCK RECOVERY**
 *    - When stuck, tries to mine through blocking vegetation
 *    - Instant-break blocks (leaves, bushes) are mined automatically
 *    - Jump attempts for small obstacles
 * 
 * ### Key Functions:
 * 
 * - `walkDirectlyToward()` - Short-distance direct walking with obstacle handling
 * - `smoothLookAt()` - Smooth camera transitions with easing
 * - `mine()` - Human-like mining sequence
 * - `navigateWithPathfinder()` - Pathfinding with vegetation-aware settings
 * 
 * ### Movement Settings:
 * 
 * - `movements.digCost = 5` (above ground) - Low cost for vegetation
 * - `movements.digCost = 15` (underground) - Allow digging through soft blocks
 * - `movements.canDig = true` - Always enabled for vegetation
 * - `movements.allowSprinting = false` - Smoother movement
 * - `movements.allowParkour = false` - No robotic jumps
 * 
 * =============================================================================
 */

import mineflayer, { Bot } from 'mineflayer';
import puppeteer, { Browser, Page } from 'puppeteer';
import pathfinder from 'mineflayer-pathfinder';
import { plugin as pvp } from 'mineflayer-pvp';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import armorManager from 'mineflayer-armor-manager';
import { loader as autoEat } from 'mineflayer-auto-eat';
import { plugin as toolPlugin } from 'mineflayer-tool';
import { plugin as movementPlugin } from 'mineflayer-movement';
import { GameState, GameAction, Logger, MinecraftState, MinecraftItem, SpatialObservation, Block, Vec3 as Vec3Type } from '@tau/shared';
import { config } from '../config.js';
import { openRouterClient } from '../ai/openrouter.js';
import mcData from 'minecraft-data';
import { mineflayer as mineflayerViewer } from 'prismarine-viewer';
import { Vec3 } from 'vec3';
import {
  makeDecision,
  shouldDigBlock,
  analyzeStuckSituation,
  getCurrentGameState,
  calculateEscapeDigDirection
} from './minecraft-brain.js';
import { HumanBehaviorManager } from './human-behavior-patterns.js';
import { decisionLogger } from '../ai/decision-logger.js';
import { experienceMemory } from '../ai/experience-memory.js';
import { movementLogger } from '../utils/movement-logger.js';
import * as fs from 'fs';
import * as path from 'path';

const { pathfinder: pathfinderPlugin, Movements, goals } = pathfinder;

// Movement constants
const MOVE_DISTANCE = 10; // Default distance for directional moves
const JUMP_COOLDOWN_MS = 800; // Cooldown between jumps
const JUMP_TAP_MS = 120; // How long to hold jump key

const logger = new Logger('Minecraft');

// Memory for placed blocks
interface PlacedBlockMemory {
  type: string;
  position: { x: number; y: number; z: number };
  placedAt: Date;
}

export class MinecraftGame {
  private bot: Bot | null = null;
  private mcData: any;
  private isConnected: boolean = false;
  private lastError: string | null = null;
  private lastPosition: { x: number; y: number; z: number } | null = null;
  private lastJumpAt: number = 0;
  private movementSessionId: number = 0; // Track movement sessions for logging
  private positionHistory: Vec3[] = []; // Track last 10 positions for stuck detection
  private humanBehavior: HumanBehaviorManager | null = null;

  // Navigation-aware yaw smoothing - fast during navigation, slow during idle
  private yawSmootherInterval: NodeJS.Timeout | null = null;
  private targetYaw: number = 0;
  private targetPitch: number = 0;
  private isNavigating: boolean = false;

  // Session stats for review
  private sessionStats = {
    startTime: Date.now(),
    deaths: 0,
    blocksMined: 0,
    blocksPlaced: 0,
    itemsCollected: 0,
    distanceTraveled: 0,
    actionsCompleted: 0,
    actionsFailed: 0,
    lastPosition: null as { x: number; y: number; z: number } | null,
  };
  private statsInterval: NodeJS.Timeout | null = null;

  // Callback for item pickups (for UI notifications)
  private onItemPickupCallback: ((itemName: string, displayName: string, count: number) => void) | null = null;
  
  // Callback for item crafts (for UI notifications)
  private onItemCraftCallback: ((itemName: string, displayName: string, count: number) => void) | null = null;
  
  // Callbacks for death/respawn (to reset AI state)
  private onDeathCallback: (() => void) | null = null;
  private onRespawnCallback: (() => void) | null = null;

  // Callback for immediate UI state updates (health, inventory changes)
  private onStateChangeCallback: (() => void) | null = null;

  // HEALTH MONITORING SYSTEM - Detect attacks and trigger emergency responses
  private lastKnownHealth: number = 20;
  private healthHistory: { health: number; time: number }[] = [];
  private onUnderAttackCallback: ((damage: number, health: number, attacker?: string) => void) | null = null;
  private lastDamageTime: number = 0;
  private isUnderAttack: boolean = false;
  private attackerName: string | null = null;
  private damageSource: 'unknown' | 'drowning' | 'lava' | 'fire' | 'suffocation' | 'mob' = 'unknown';
  private isEnvironmentalDamage: boolean = false;
  private emergencyFleeRequested: boolean = false;
  private spawnTime: number = Date.now(); // Initialize NOW to prevent false damage on connect
  private hasSpawned: boolean = false; // Track if we've actually spawned
  private readonly SPAWN_GRACE_PERIOD = 5000; // 5 seconds grace period after spawn

  // Action lock to prevent concurrent mining/movement operations
  private actionInProgress: string | null = null;

  // Memory systems
  private placedBlocks: PlacedBlockMemory[] = []; // Remember where we placed important blocks
  private memoryDir: string;
  private serverKey: string = ''; // Set on connect, used for per-server memory
  
  // Vision capture for stuck recovery
  private visionBrowser: Browser | null = null;
  private visionPage: Page | null = null;
  private lastVisionAnalysis: number = 0; // Timestamp of last vision analysis (rate limiting)

  // STUCK RECOVERY SYSTEM - Detect and escape from holes, water, blocked paths
  private stuckState = {
    consecutiveBlockedMoves: 0,      // How many moves failed due to "all directions blocked"
    lastYBeforeStuck: 0,             // Y level before we fell into a hole
    currentRecoveryAttempts: 0,      // How many recovery attempts we've made
    isInRecoveryMode: false,         // Are we currently trying to recover?
    recoveryStartTime: 0,            // When did we start recovery?
    lastSuccessfulMoveTime: Date.now(), // When did we last move successfully?
    positionHistoryForStuck: [] as { x: number; y: number; z: number; time: number }[], // Track position history
  };
  private readonly MAX_RECOVERY_ATTEMPTS = 5;
  private readonly STUCK_THRESHOLD_MS = 30000; // If no successful move in 30s, consider stuck

  constructor() {
    logger.info('Minecraft game controller initialized');
    // Store in project folder: packages/bot/data/minecraft-memory/
    this.memoryDir = path.join(process.cwd(), 'data', 'minecraft-memory');
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
      logger.info(`Created memory directory: ${this.memoryDir}`);
    }
  }

  /**
   * Get the memory file path for current server
   */
  private getMemoryFilePath(): string {
    const safeKey = this.serverKey.replace(/[^a-zA-Z0-9]/g, '_');
    return path.join(this.memoryDir, `${safeKey}.json`);
  }

  /**
   * Load memory from file for current server
   */
  private loadMemory(): void {
    try {
      const filePath = this.getMemoryFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.placedBlocks = (data.placedBlocks || []).map((b: any) => ({
          ...b,
          placedAt: new Date(b.placedAt),
        }));
        logger.info(`[MEMORY] Loaded ${this.placedBlocks.length} placed blocks from ${filePath}`);
      } else {
        this.placedBlocks = [];
        logger.info('[MEMORY] No existing memory file, starting fresh');
      }
    } catch (err) {
      logger.error('[MEMORY] Failed to load memory', { error: err });
      this.placedBlocks = [];
    }
  }

  /**
   * Save memory to file for current server
   */
  private saveMemory(): void {
    try {
      const filePath = this.getMemoryFilePath();
      const data = {
        serverKey: this.serverKey,
        lastUpdated: new Date().toISOString(),
        placedBlocks: this.placedBlocks,
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      logger.debug(`[MEMORY] Saved ${this.placedBlocks.length} placed blocks to ${filePath}`);
    } catch (err) {
      logger.error('[MEMORY] Failed to save memory', { error: err });
    }
  }

  /**
   * Remember a placed block location
   * Comprehensive list based on Minecraft Wiki functional blocks
   */
  private rememberPlacedBlock(type: string, position: { x: number; y: number; z: number }): void {
    // Only remember important functional blocks (comprehensive list from Minecraft Wiki)
    const importantBlocks = [
      // Crafting & Production
      'crafting_table', 'crafter', 'stonecutter', 'smithing_table', 'anvil',
      'enchanting_table', 'grindstone',
      // Specialized Crafting
      'loom', 'cartography_table', 'brewing_stand',
      // Storage
      'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
      // Furnaces & Smelting
      'furnace', 'blast_furnace', 'smoker',
      // Utility & Respawn
      'bed', 'respawn_anchor', 'beacon', 'conduit', 'lodestone',
      // Other Functional
      'composter', 'cauldron', 'lectern', 'campfire', 'soul_campfire',
    ];
    if (!importantBlocks.some(b => type.includes(b))) return;

    // Don't duplicate if already remembered nearby
    const isDuplicate = this.placedBlocks.some(b =>
      b.type === type &&
      Math.abs(b.position.x - position.x) < 2 &&
      Math.abs(b.position.y - position.y) < 2 &&
      Math.abs(b.position.z - position.z) < 2
    );

    if (!isDuplicate) {
      this.placedBlocks.push({
        type,
        position: { ...position },
        placedAt: new Date(),
      });
      logger.info(`[MEMORY] Remembered ${type} at (${position.x}, ${position.y}, ${position.z})`);
      this.markMemoryDirty(); // Queue save, don't write immediately
    }
  }

  private memoryDirty: boolean = false;
  private memorySaveTimeout: NodeJS.Timeout | null = null;

  /**
   * Mark memory as needing save (debounced - saves after 30s of no changes)
   */
  private markMemoryDirty(): void {
    this.memoryDirty = true;
    if (this.memorySaveTimeout) clearTimeout(this.memorySaveTimeout);
    this.memorySaveTimeout = setTimeout(() => this.flushMemory(), 30000);
  }

  /**
   * Flush memory to disk if dirty
   */
  flushMemory(): void {
    if (this.memoryDirty) {
      this.saveMemory();
      this.memoryDirty = false;
      logger.info('[MEMORY] Flushed to disk');
    }
    if (this.memorySaveTimeout) {
      clearTimeout(this.memorySaveTimeout);
      this.memorySaveTimeout = null;
    }
  }

  /**
   * Get nearby functional blocks (crafting tables, furnaces, etc.) from world and memory
   * Searches for all important workstations and utility blocks
   */
  getNearbyFunctionalBlocks(): { type: string; position: { x: number; y: number; z: number }; distance: number }[] {
    if (!this.bot) return [];

    const pos = this.bot.entity.position;
    const results: { type: string; position: { x: number; y: number; z: number }; distance: number }[] = [];

    // Comprehensive list of functional blocks to search for in the world
    const functionalBlockTypes = [
      // Most commonly needed (search first)
      'crafting_table', 'furnace', 'chest',
      // Other crafting stations
      'smithing_table', 'anvil', 'enchanting_table', 'grindstone', 'stonecutter',
      'loom', 'cartography_table', 'brewing_stand',
      // Furnace variants
      'blast_furnace', 'smoker',
      // Storage
      'barrel', 'trapped_chest', 'ender_chest',
      // Utility
      'bed', 'campfire', 'soul_campfire', 'beacon', 'conduit',
    ];

    for (const blockType of functionalBlockTypes) {
      const blockId = this.mcData?.blocksByName?.[blockType]?.id;
      if (blockId) {
        const found = this.bot.findBlock({
          matching: blockId,
          maxDistance: 32,
        });
        if (found) {
          const distance = pos.distanceTo(found.position);
          results.push({
            type: blockType,
            position: { x: found.position.x, y: found.position.y, z: found.position.z },
            distance: Math.round(distance),
          });
        }
      }
    }

    // Also include remembered blocks that might be out of render distance
    for (const mem of this.placedBlocks) {
      const distance = Math.sqrt(
        Math.pow(mem.position.x - pos.x, 2) +
        Math.pow(mem.position.y - pos.y, 2) +
        Math.pow(mem.position.z - pos.z, 2)
      );
      // Only add if not already found in world search
      const alreadyFound = results.some(r =>
        r.type === mem.type &&
        Math.abs(r.position.x - mem.position.x) < 2
      );
      if (!alreadyFound) {
        results.push({
          type: mem.type,
          position: mem.position,
          distance: Math.round(distance),
        });
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Connect to Minecraft server
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.bot) {
      logger.warn('Already connected to Minecraft server');
      return;
    }

    const minecraftConfig = config.game.minecraft!;

    // Set server key for per-server memory storage
    this.serverKey = `${minecraftConfig.host}_${minecraftConfig.port}`;
    this.loadMemory();

    logger.info('Connecting to Minecraft server', {
      host: minecraftConfig.host,
      port: minecraftConfig.port,
      username: minecraftConfig.username,
      version: minecraftConfig.version,
    });

    try {
      this.bot = mineflayer.createBot({
        host: minecraftConfig.host,
        port: minecraftConfig.port,
        username: minecraftConfig.username,
        version: minecraftConfig.version,
        auth: minecraftConfig.auth,
      });

      // Load pathfinder plugin
      this.bot.loadPlugin(pathfinderPlugin);

      // Load additional plugins
      this.bot.loadPlugin(pvp);
      this.bot.loadPlugin(collectBlock);
      this.bot.loadPlugin(toolPlugin);
      this.bot.loadPlugin(movementPlugin);

      // Load auto-eat only if enabled (disabled by default to let AI learn)
      if (process.env.AUTO_EAT_ENABLED === 'true') {
        this.bot.loadPlugin(autoEat);
        logger.info('✅ Auto-eat plugin enabled');
      }

      // Load armor manager if enabled
      if (process.env.AUTO_ARMOR_ENABLED !== 'false') {
        this.bot.loadPlugin(armorManager);
        logger.info('✅ Armor manager plugin enabled');
      }

      logger.info('✅ Plugins loaded: pvp, collectblock, tool, movement');

      // Set up event listeners
      this.setupEventListeners();

      // Start viewer on port 3007 (after spawn)
      // THIRD_PERSON_VIEW=true → third person, false → first person
      this.bot.once('spawn', () => {
        try {
          const thirdPerson = process.env.THIRD_PERSON_VIEW === 'true';
          logger.info(`Starting prismarine viewer on port 3007 (${thirdPerson ? 'third' : 'first'} person)...`);
          if (this.bot) {
            mineflayerViewer(this.bot, { port: 3007, firstPerson: !thirdPerson });
          }
          logger.info('✅ Prismarine viewer started at http://localhost:3007');
        } catch (error) {
          logger.error('Failed to start viewer', { error });
        }
      });

      // Wait for spawn
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 30000);

        this.bot!.once('spawn', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.hasSpawned = true; // Mark that we've actually spawned
          this.spawnTime = Date.now(); // Track spawn time for grace period
          this.lastKnownHealth = this.bot?.health ?? 20; // Initialize to current health
          logger.info('Successfully spawned in Minecraft world');
          resolve();
        });

        this.bot!.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Load minecraft data
      this.mcData = mcData(this.bot.version);

      // Initialize human behavior manager with config from environment
      const humanBehaviorConfig = {
        enabled: process.env.HUMAN_BEHAVIOR_ENABLED !== 'false',
        curiosity: parseFloat(process.env.HUMAN_BEHAVIOR_CURIOSITY || '0.7'),
        caution: parseFloat(process.env.HUMAN_BEHAVIOR_CAUTION || '0.8'),
        focus: parseFloat(process.env.HUMAN_BEHAVIOR_FOCUS || '0.5'),
        lookFrequency: parseInt(process.env.HUMAN_BEHAVIOR_LOOK_FREQUENCY || '6000'),
        debugLogging: process.env.HUMAN_BEHAVIOR_DEBUG === 'true'
      };

      this.humanBehavior = new HumanBehaviorManager(this.bot, humanBehaviorConfig);

      // Start passive behavior loop for natural looking around
      this.humanBehavior.startPassiveBehavior();

      // Start navigation-aware yaw smoother - fast during navigation, slow during idle
      this.startNavigationAwareYawSmoother();

      logger.info('✅ Human behavior manager initialized and started');
      logger.info('✅ Navigation-aware yaw smoother started');

      // Initialize experience memory for cross-session learning
      await experienceMemory.initialize();
      const memStats = experienceMemory.getStats();
      logger.info('✅ Experience memory initialized', {
        totalExperiences: memStats.totalExperiences,
        patterns: memStats.patterns,
        indexedExperiences: memStats.indexedExperiences,
      });

    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error('Failed to connect to Minecraft server', { error: this.lastError });
      throw error;
    }
  }

  /**
   * Set up event listeners for the bot
   */
  private setupEventListeners() {
    if (!this.bot) return;

    // Enhanced chat listener - respond to users
    this.bot.on('chat', (username, message) => {
      // Ignore own messages
      if (username === this.bot?.username) return;

      logger.info('Chat received', { username, message });

      // Respond to greetings
      if (message.toLowerCase().match(/\b(hi|hello|hey)\b.*bot/i)) {
        this.bot?.chat(`Hello ${username}! I'm an AI bot. Ask me to mine, explore, or build!`);
      }

      // Respond to questions about status
      if (message.toLowerCase().match(/\b(how are you|status|what.*doing)\b/i)) {
        const pos = this.bot?.entity.position;
        const health = this.bot?.health || 0;
        const food = this.bot?.food || 0;
        this.bot?.chat(`I'm at ${pos?.x.toFixed(0)}, ${pos?.y.toFixed(0)}, ${pos?.z.toFixed(0)}. Health: ${health}/20, Food: ${food}/20`);
      }

      // Respond to help requests
      if (message.toLowerCase().match(/\b(help|commands)\b/i)) {
        this.bot?.chat('I can: mine blocks, navigate, craft tools, and survive! Use the web interface to give me complex tasks.');
      }
    });

    this.bot.on('death', () => {
      // IMMEDIATELY clear all controls to prevent flying kick after respawn
      this.clearAllControls();
      this.isEscaping = false; // Stop any emergency escape in progress
      
      this.sessionStats.deaths++;
      const sessionDuration = Math.floor((Date.now() - this.sessionStats.startTime) / 1000);
      logger.warn(`[SESSION-STATS] BOT DIED! Deaths this session: ${this.sessionStats.deaths}`);
      logger.warn(`[SESSION-STATS] Session duration: ${Math.floor(sessionDuration / 60)}m ${sessionDuration % 60}s`);
      logger.warn(`[SESSION-STATS] Stats at death:`, {
        deaths: this.sessionStats.deaths,
        blocksMined: this.sessionStats.blocksMined,
        blocksPlaced: this.sessionStats.blocksPlaced,
        actionsCompleted: this.sessionStats.actionsCompleted,
        actionsFailed: this.sessionStats.actionsFailed,
        distanceTraveled: Math.floor(this.sessionStats.distanceTraveled),
      });
      this.bot?.chat('I died! Respawning...');
      
      // Trigger death callback if registered
      if (this.onDeathCallback) {
        this.onDeathCallback();
      }
    });

    this.bot.on('respawn', () => {
      logger.info('[SESSION-STATS] Bot respawned - fresh start!');
      
      // IMMEDIATELY clear all controls to prevent flying kick
      this.clearAllControls();
      this.isEscaping = false;
      
      this.bot?.chat("I'm back! Starting fresh.");
      
      // Reset health tracking on respawn
      this.spawnTime = Date.now(); // Reset spawn time for grace period
      this.lastKnownHealth = this.bot?.health ?? 20;
      this.healthHistory = [];
      this.isUnderAttack = false;
      this.attackerName = null;
      this.emergencyFleeRequested = false;
      
      // Broadcast fresh state to UI immediately (20/20 health)
      setTimeout(() => this.notifyStateChange(), 100);
      
      // Trigger respawn callback if registered
      if (this.onRespawnCallback) {
        this.onRespawnCallback();
      }
    });

    // HEALTH MONITORING - Detect when taking damage
    this.bot.on('health', () => {
      if (!this.bot) return;
      
      const currentHealth = this.bot.health;
      const now = Date.now();
      
      // SPAWN GRACE PERIOD - Ignore health differences right after spawn
      // (e.g., spawning with less than full health, fall damage on spawn)
      if (now - this.spawnTime < this.SPAWN_GRACE_PERIOD) {
        this.lastKnownHealth = currentHealth; // Just update baseline
        return;
      }
      
      // Track health history (keep last 10 entries for pattern detection)
      this.healthHistory.push({ health: currentHealth, time: now });
      if (this.healthHistory.length > 10) {
        this.healthHistory.shift();
      }
      
      // IMPORTANT: Ignore health events before we've actually spawned
      // The health event fires BEFORE spawn with garbage values
      if (!this.hasSpawned) {
        logger.info('[HEALTH] Ignoring health event before spawn');
        return;
      }
      
      // Detect damage (health decreased)
      if (currentHealth < this.lastKnownHealth) {
        const damage = this.lastKnownHealth - currentHealth;
        this.lastDamageTime = now;
        
        // FIRST: Check for environmental damage sources (drowning, lava, fire, suffocation)
        const pos = this.bot.entity.position;
        const headBlock = this.bot.blockAt(pos.offset(0, 1.6, 0)); // Block at eye level
        const feetBlock = this.bot.blockAt(pos);
        const blockInside = this.bot.blockAt(pos.offset(0, 0.5, 0)); // Block torso is in
        
        const isHeadInWater = headBlock?.name === 'water' || headBlock?.name === 'flowing_water';
        const isBodyInWater = feetBlock?.name === 'water' || feetBlock?.name === 'flowing_water';
        const isInLava = feetBlock?.name === 'lava' || feetBlock?.name === 'flowing_lava' ||
                         blockInside?.name === 'lava' || blockInside?.name === 'flowing_lava';
        // Check fire status via entity metadata (index 0, bit 0 = on fire)
        const entityMeta = (this.bot.entity as any).metadata;
        const isOnFire = entityMeta && entityMeta[0] ? !!(entityMeta[0] & 0x01) : false;
        const isSuffocating = headBlock?.boundingBox === 'block'; // Head in solid block
        
        // Determine damage source - set instance properties
        this.damageSource = 'unknown';
        this.isEnvironmentalDamage = false;
        
        if (isHeadInWater && !isBodyInWater) {
          // Head in water but feet not = definitely drowning (head submerged)
          this.damageSource = 'drowning';
          this.isEnvironmentalDamage = true;
        } else if (isHeadInWater && damage >= 1 && damage <= 2) {
          // Classic drowning damage pattern (1-2 damage per tick)
          this.damageSource = 'drowning';
          this.isEnvironmentalDamage = true;
        } else if (isInLava) {
          this.damageSource = 'lava';
          this.isEnvironmentalDamage = true;
        } else if (isOnFire && !isInLava) {
          this.damageSource = 'fire';
          this.isEnvironmentalDamage = true;
        } else if (isSuffocating) {
          this.damageSource = 'suffocation';
          this.isEnvironmentalDamage = true;
        }
        
        // If not environmental, check for hostile mobs
        let hasRealThreat = false;
        if (!this.isEnvironmentalDamage) {
          const nearbyHostiles = this.getNearbyHostileMobs(8);
          const closestHostile = nearbyHostiles.length > 0 ? nearbyHostiles[0] : null;
          if (closestHostile) {
            this.damageSource = 'mob';
            this.attackerName = closestHostile.name;
            hasRealThreat = true;
          }
        }
        
        // Set attackerName for display purposes
        if (!hasRealThreat) {
          this.attackerName = this.damageSource;
        }
        
        const recentDamage = this.calculateRecentDamage(5000); // Last 5 seconds for drowning
        const isRapidDamage = recentDamage >= 3; // LOWERED from 4 - drowning is ~2/5sec
        const isCriticalHealth = currentHealth <= 12; // RAISED from 10 - more conservative
        
        // Log with proper damage source identification
        const damageIcon = this.damageSource === 'drowning' ? '🏊' : this.damageSource === 'lava' ? '🔥' : this.damageSource === 'fire' ? '🔥' : this.damageSource === 'suffocation' ? '🧱' : hasRealThreat ? '⚔️' : '❓';
        logger.warn(`[HEALTH-ALERT] ${damageIcon} TOOK DAMAGE! damage=${damage.toFixed(1)} health=${currentHealth.toFixed(1)}/20 source=${this.damageSource} rapidDmg=${isRapidDamage} recentDmg=${recentDamage.toFixed(1)}`);
        
        // EMERGENCY AUTO-ESCAPE: Different triggers for different damage types
        // Environmental damage (drowning, lava, fire) = ALWAYS escape immediately
        // Combat damage = only on rapid damage or critical health
        const shouldEscape = this.isEnvironmentalDamage || isCriticalHealth || isRapidDamage;
        
        if (shouldEscape) {
          // Only set "under attack" for combat damage, not environmental
          if (hasRealThreat) {
            this.isUnderAttack = true;
          }
          this.emergencyFleeRequested = true;
          
          const escapeReason = this.isEnvironmentalDamage ? this.damageSource.toUpperCase() : 
                               isCriticalHealth ? 'CRITICAL HP' : 'RAPID DAMAGE';
          logger.error(`[HEALTH-ALERT] 🚨 EMERGENCY ESCAPE! reason=${escapeReason} HP=${currentHealth.toFixed(1)} - IMMEDIATE ACTION`);
          
          // Trigger callback for AI awareness (only for real threats)
          if (this.onUnderAttackCallback && hasRealThreat) {
            this.onUnderAttackCallback(damage, currentHealth, this.attackerName ?? undefined);
          }
          
          // IMMEDIATE AUTO-ESCAPE - no waiting for AI!
          this.emergencyEscape().catch(e => {
            logger.error('[HEALTH-ALERT] Emergency escape failed', { error: e.message });
          });
        }
      }
      
      // If health recovered, clear attack status after a delay
      if (currentHealth > this.lastKnownHealth && now - this.lastDamageTime > 5000) {
        this.isUnderAttack = false;
        this.attackerName = null;
      }
      
      this.lastKnownHealth = currentHealth;
      
      // Notify UI of health change immediately
      this.notifyStateChange();
    });

    // Detect when hurt by entity (more specific attacker info)
    this.bot.on('entityHurt', (entity) => {
      if (!this.bot || entity !== this.bot.entity) return;
      
      // Try to find what hurt us
      const nearbyHostiles = this.getNearbyHostileMobs(10);
      if (nearbyHostiles.length > 0) {
        this.attackerName = nearbyHostiles[0].name;
        this.isUnderAttack = true;
        logger.warn(`[HEALTH-ALERT] Hurt by entity, nearest hostile: ${this.attackerName} at ${nearbyHostiles[0].distance.toFixed(1)}m`);
      }
    });

    this.bot.on('kicked', (reason) => {
      logger.error('Bot was kicked', { reason });
      this.isConnected = false;
    });

    this.bot.on('error', (err) => {
      logger.error('Bot error', { error: err.message });
      this.lastError = err.message;
    });

    // Listen for nearby mobs - ONLY log if within field of view AND visible (not behind walls)
    this.bot.on('entitySpawn', (entity) => {
      if (entity.type === 'mob' && entity.position && this.bot) {
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (distance && distance < 10) {
          // Check if within field of view (human can only see in front)
          if (this.isInFieldOfView(entity.position)) {
            // Also check line of sight - can't see through walls!
            const entityCenter = { 
              x: entity.position.x, 
              y: entity.position.y + (entity.height || 1) * 0.5,
              z: entity.position.z 
            };
            if (this.hasLineOfSight(entityCenter)) {
              const mobName = entity.displayName || entity.name || 'unknown mob';
              logger.warn('[MOB-DETECTION] Hostile mob spotted in view!', {
                name: mobName,
                distance: distance.toFixed(1)
              });
            }
            // Mobs behind walls won't be logged (human-like awareness)
          }
          // Mobs behind the player won't be logged (human-like awareness)
        }
      }
    });

    // Listen for item pickups - broadcast to UI for visual notification
    this.bot.on('playerCollect', (collector, collected) => {
      // Only care about our own pickups
      if (collector.username !== this.bot?.username) return;
      
      // Get item info from the collected entity
      const itemEntity = collected as any;
      if (itemEntity && itemEntity.metadata) {
        // The item info is in metadata[8] for dropped items
        const itemInfo = itemEntity.metadata?.[8];
        if (itemInfo && itemInfo.itemId !== undefined) {
          const itemId = itemInfo.itemId;
          const itemCount = itemInfo.itemCount || 1;
          
          // Look up item name from mcData
          const item = this.mcData?.items?.[itemId];
          const itemName = item?.name || 'item';
          const displayName = item?.displayName || itemName.replace(/_/g, ' ');
          
          this.sessionStats.itemsCollected += itemCount;
          
          logger.info('[ITEM-PICKUP] Collected item', {
            item: itemName,
            count: itemCount
          });
          
          // Call the callback if registered (for UI notification)
          if (this.onItemPickupCallback) {
            this.onItemPickupCallback(itemName, displayName, itemCount);
          }
          
          // Notify UI of inventory change immediately
          this.notifyStateChange();
        }
      }
    });

    this.bot.on('end', () => {
      logger.info('Bot connection ended');
      this.isConnected = false;
      this.flushMemory(); // Save memory before disconnect
      // Clear stats interval
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }
      // Log final session stats
      this.logSessionStats('FINAL');
    });

    // Start periodic stats logging (every 60 seconds)
    this.sessionStats.startTime = Date.now();
    this.statsInterval = setInterval(() => {
      this.logSessionStats('PERIODIC');
    }, 60000);
    logger.info('[SESSION-STATS] Session started, will log stats every 60 seconds');
  }

  /**
   * Log current session statistics
   */
  private logSessionStats(label: string): void {
    const sessionDuration = Math.floor((Date.now() - this.sessionStats.startTime) / 1000);
    const minutes = Math.floor(sessionDuration / 60);
    const seconds = sessionDuration % 60;

    // Update distance traveled if bot is connected
    if (this.bot && this.isConnected) {
      const currentPos = this.bot.entity.position;
      if (this.sessionStats.lastPosition) {
        const dx = currentPos.x - this.sessionStats.lastPosition.x;
        const dz = currentPos.z - this.sessionStats.lastPosition.z;
        this.sessionStats.distanceTraveled += Math.sqrt(dx * dx + dz * dz);
      }
      this.sessionStats.lastPosition = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
    }

    logger.info(`[SESSION-STATS] ========== ${label} STATS ==========`);
    logger.info(`[SESSION-STATS] Duration: ${minutes}m ${seconds}s`);
    logger.info(`[SESSION-STATS] Deaths: ${this.sessionStats.deaths}`);
    logger.info(`[SESSION-STATS] Blocks Mined: ${this.sessionStats.blocksMined}`);
    logger.info(`[SESSION-STATS] Blocks Placed: ${this.sessionStats.blocksPlaced}`);
    logger.info(`[SESSION-STATS] Actions: ${this.sessionStats.actionsCompleted} completed, ${this.sessionStats.actionsFailed} failed`);
    logger.info(`[SESSION-STATS] Distance Traveled: ${Math.floor(this.sessionStats.distanceTraveled)} blocks`);
    logger.info(`[SESSION-STATS] ================================`);
  }

  /**
   * Get current game state
   */
  getState(): GameState {
    if (!this.bot || !this.isConnected) {
      return {
        name: 'Minecraft',
        mode: 'minecraft',
        status: this.lastError ? 'error' : 'idle',
        currentAction: null,
        lastUpdate: new Date(),
        metadata: {
          error: this.lastError,
          connected: false,
        },
      };
    }

    const currentPos = {
      x: Math.floor(this.bot.entity.position.x),
      y: Math.floor(this.bot.entity.position.y),
      z: Math.floor(this.bot.entity.position.z),
    };

    // Update last position
    this.lastPosition = currentPos;

    // Get spatial observation (3x3x3 grid + semantic understanding)
    const spatialObs = this.getSpatialObservation();

    const minecraftState: MinecraftState = {
      position: currentPos,
      health: this.bot.health,
      food: this.bot.food,
      inventory: this.getInventory(),
      nearbyBlocks: this.getNearbyBlocks(),
      nearbyEntities: this.getNearbyEntities(),
      functionalBlocks: this.getNearbyFunctionalBlocks(),
      time: this.getTimeOfDay(),
      weather: this.bot.isRaining ? 'raining' : 'clear',
      dimension: this.bot.game.dimension,
    };

    return {
      name: 'Minecraft',
      mode: 'minecraft',
      status: 'playing',
      currentAction: null,
      lastUpdate: new Date(),
      metadata: {
        ...minecraftState,
        connected: true,
        spatialObservation: spatialObs,
        // Health monitoring data for survival decisions
        healthAlert: this.getHealthAlertInfo(),
        // Stuck detection data for recovery
        stuckInfo: this.getStuckInfo(),
      },
    };
  }

  /**
   * Check spatial awareness and trigger contextual looking
   * DISABLED: Human Behavior V2 handles all idle looking automatically
   */
  private async contextualSpatialLooking(): Promise<void> {
    // V2 handles this automatically during idle periods
    return;
  }

  /**
   * Execute a game action
   */
  async executeAction(action: GameAction): Promise<string> {
    if (!this.bot || !this.isConnected) {
      return 'Not connected to Minecraft server';
    }

    // Prevent concurrent actions that could conflict (mining while moving, etc)
    // Only block for physical actions (move, mine, dig_up, attack, place)
    const physicalActions = ['move', 'mine', 'dig_up', 'attack', 'place'];
    if (physicalActions.includes(action.type) && this.actionInProgress) {
      logger.warn(`[EXECUTE] Action blocked - ${this.actionInProgress} already in progress`, {
        requested: action.type,
        target: action.target
      });
      return `Cannot ${action.type} - ${this.actionInProgress} already in progress`;
    }

    logger.debug('Executing action', {
      type: action.type,
      target: action.target,
    });

    // HUMAN BEHAVIOR: Contextual spatial looking before actions (non-blocking)
    if (this.humanBehavior && Math.random() < 0.3) { // 30% chance
      this.contextualSpatialLooking().catch(() => {}); // Fire and forget
    }

    try {
      switch (action.type) {
        case 'move':
          return await this.move(action.target || 'forward', action.parameters);

        case 'mine':
          return await this.mine(action.target || '');

        case 'place':
          return await this.place(action.target || '');

        case 'interact':
          return await this.interact(action.target || '');

        case 'attack':
          return await this.attack(action.target || '');

        case 'craft':
          return await this.craft(action.target || '');

        case 'speak':
          // For speak actions: use parameters.message if set, otherwise use reasoning as the message
          // (target is who to speak to, not the message itself)
          const speakMessage = (action.parameters?.message as string) || action.reasoning || action.target || 'Hello!';
          return this.speak(speakMessage);

        case 'analyze':
          return this.analyze();

        case 'wait':
          // Just wait - human behavior V2 handles idle looking automatically
          await new Promise(resolve => setTimeout(resolve, 1000));
          return 'Waited and scanned surroundings';

        case 'dig_up':
          return await this.digUp();

        case 'eat':
          return await this.eat(action.target || '');

        case 'equip':
          return await this.equip(action.target || '');

        case 'recover':
          // Recovery action - escape from holes, water, blocked paths
          return await this.recoverFromStuck();

        default:
          return `Unknown action type: ${action.type}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Action failed', { action: action.type, error: errorMsg });
      return `Action failed: ${errorMsg}`;
    }
  }

  /**
   * Parse coordinate string - supports multiple formats:
   * "x y z", "x, y, z", "x z", "x, z"
   */
  private parseCoordinates(input: string): { x: number; y: number | null; z: number } | null {
    if (!this.bot) return null;
    
    const raw = input.trim();
    // Split by comma or whitespace, filter empty strings
    const parts = raw.split(/[,\s]+/).filter(Boolean);
    
    if (parts.length < 2 || parts.length > 3) return null;
    
    const nums = parts.map(p => Number(p));
    if (!nums.every(n => Number.isFinite(n))) return null;
    
    if (parts.length === 3) {
      return { x: nums[0], y: nums[1], z: nums[2] };
    } else {
      // 2 numbers: x, z (y stays current)
      return { x: nums[0], y: null, z: nums[1] };
    }
  }

  /**
   * Move in a direction or to coordinates - moves like a real player with 3D pathfinding
   */
  private async move(direction: string, parameters?: Record<string, unknown>): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();

    // Try parsing coordinates from the direction string (supports "x y z" or "x, y, z")
    const coords = this.parseCoordinates(direction);
    if (coords) {
      const targetY = coords.y ?? this.bot.entity.position.y;
      return await this.navigateToPosition3D(coords.x, targetY, coords.z, `(${coords.x}, ${targetY.toFixed(0)}, ${coords.z})`);
    }

    // If coordinates provided as parameters
    if (parameters?.x !== undefined && parameters?.z !== undefined) {
      const x = parameters.x as number;
      const y = (parameters.y as number) ?? this.bot.entity.position.y;
      const z = parameters.z as number;
      return await this.navigateToPosition3D(x, y, z, 'coordinates');
    }

    // Check if direction is actually a block name - if so, find and navigate to it
    const blockType = this.mcData.blocksByName[direction.toLowerCase().replace(/ /g, '_')];
    if (blockType) {
      const block = this.bot.findBlock({
        matching: blockType.id,
        maxDistance: 64,
      });

      if (!block) {
        return `No ${direction} found within 64 blocks`;
      }

      return await this.navigateToPosition3D(
        block.position.x,
        block.position.y,
        block.position.z,
        direction,
        3
      );
    }

    // For directional movement, use direct control like a real player
    let targetYaw: number;
    const currentYaw = this.bot.entity.yaw;

    switch (direction.toLowerCase()) {
      // Cardinal directions - absolute yaw values
      // In Minecraft: yaw 0 = South (+Z), yaw PI/2 = West (-X), yaw PI = North (-Z), yaw -PI/2 = East (+X)
      case 'north':
        targetYaw = Math.PI; // Face -Z
        break;
      case 'south':
        targetYaw = 0; // Face +Z
        break;
      case 'east':
        targetYaw = -Math.PI / 2; // Face +X
        break;
      case 'west':
        targetYaw = Math.PI / 2; // Face -X
        break;

      // Diagonal directions (intercardinal) - 45° between cardinals
      case 'northeast':
        targetYaw = -Math.PI * 3 / 4; // Face +X and -Z (between east and north)
        break;
      case 'northwest':
        targetYaw = Math.PI * 3 / 4; // Face -X and -Z (between west and north)
        break;
      case 'southeast':
        targetYaw = -Math.PI / 4; // Face +X and +Z (between east and south)
        break;
      case 'southwest':
        targetYaw = Math.PI / 4; // Face -X and +Z (between west and south)
        break;

      // Relative directions - based on current facing
      // In Minecraft/mineflayer: increasing yaw = clockwise rotation (when viewed from above)
      // So: left (counterclockwise) = subtract, right (clockwise) = add
      case 'forward':
        targetYaw = currentYaw; // Keep current direction
        break;
      case 'backward':
        targetYaw = currentYaw + Math.PI; // Turn around
        break;
      case 'left':
        targetYaw = currentYaw - Math.PI / 2; // Turn left 90° (counterclockwise)
        break;
      case 'right':
        targetYaw = currentYaw + Math.PI / 2; // Turn right 90° (clockwise)
        break;

      // Random exploration
      case 'explore':
      case 'random':
        targetYaw = Math.random() * Math.PI * 2 - Math.PI; // Random direction
        break;

      // Vertical movement - can't really walk up/down, but handle gracefully
      case 'up':
      case 'jump':
        // Just jump in place
        if (this.canTapJump()) {
          await this.tapJump();
          return `Jumped (now at ${this.bot.entity.position.x.toFixed(0)}, ${this.bot.entity.position.y.toFixed(0)}, ${this.bot.entity.position.z.toFixed(0)})`;
        }
        return `Cannot jump right now (not on ground or cooldown)`;
        
      case 'down':
        // Actually try to descend - check below and around for lower ground
        return await this.descendToLowerGround();

      case 'crouch':
        // Crouch briefly
        this.bot.setControlState('sneak', true);
        await new Promise(resolve => setTimeout(resolve, 500));
        this.bot.setControlState('sneak', false);
        return `Crouched (now at ${this.bot.entity.position.x.toFixed(0)}, ${this.bot.entity.position.y.toFixed(0)}, ${this.bot.entity.position.z.toFixed(0)})`;

      case 'away_from_danger':
      case 'flee':
      case 'escape':
        // EMERGENCY FLEE: Run away from the closest hostile mob
        return await this.emergencyFlee();

      default:
        return `Unknown direction: ${direction}. Use north/south/east/west/northeast/northwest/southeast/southwest, forward/backward/left/right, up/down, explore, or coordinates like "10 64 -20".`;
    }

    // Normalize yaw to [-PI, PI]
    targetYaw = this.normalizeAngle(targetYaw);

    return await this.walkInDirection(targetYaw, direction, startPos);
  }

  /**
   * Calculate 3D vector from current position to target
   * Returns { dx, dy, dz, yaw, pitch, horizontalDist, totalDist }
   */
  private calculate3DVector(targetX: number, targetY: number, targetZ: number): {
    dx: number;
    dy: number;
    dz: number;
    yaw: number;
    pitch: number;
    horizontalDist: number;
    totalDist: number;
  } {
    if (!this.bot) {
      return { dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, horizontalDist: 0, totalDist: 0 };
    }
    
    const pos = this.bot.entity.position;
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const dz = targetZ - pos.z;
    
    // Horizontal distance (XZ plane)
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    
    // Total 3D distance
    const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Yaw: horizontal rotation - atan2(-dx, -dz) gives correct Minecraft yaw
    // where 0 = North (-Z), -PI/2 = East (+X), PI = South (+Z), PI/2 = West (-X)
    // This matches the mineflayer-pathfinder formula in monitorMovement()
    const yaw = Math.atan2(-dx, -dz);
    
    // Pitch: vertical rotation - negative dy because looking up is negative pitch
    // atan2(-dy, horizontalDist) gives pitch where negative = looking up, positive = looking down
    const pitch = horizontalDist > 0.01 ? Math.atan2(-dy, horizontalDist) : 0;
    
    return { dx, dy, dz, yaw, pitch, horizontalDist, totalDist };
  }

  /**
   * Navigate to a 3D target - walks like a real player
   * Uses direct movement with real-time trajectory updates
   * Enhanced with comprehensive logging and smart obstacle avoidance
   */
  private async walkTowardTarget3D(
    targetX: number,
    targetY: number,
    targetZ: number,
    label: string,
    stopDistance: number = 1.5,
    ignoreY: boolean = false
  ): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const sessionId = ++this.movementSessionId;
    const startPos = this.bot.entity.position.clone();
    const initialVec = this.calculate3DVector(targetX, targetY, targetZ);

    // Only skip if VERY close
    if (initialVec.horizontalDist < stopDistance) {
      logger.info(`[MOVEMENT-${sessionId}] Already at target`, {
        label,
        distance: initialVec.totalDist.toFixed(2)
      });
      return `Already at ${label} (${initialVec.totalDist.toFixed(1)} blocks away)`;
    }

    logger.info(`[MOVEMENT-${sessionId}] Starting navigation`, {
      label,
      method: 'PATHFINDER',
      from: `(${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`,
      to: `(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)})`,
      distance: initialVec.totalDist.toFixed(2),
      horizontalDist: initialVec.horizontalDist.toFixed(2),
      verticalDist: initialVec.dy.toFixed(2)
    });

    try {
      // ALWAYS use pathfinder - smooth walk is unreliable (doesn't work in water, gets stuck)
      // Pathfinder handles terrain, water, and obstacles properly
      logger.info(`[MOVEMENT-${sessionId}] Using PATHFINDER (${initialVec.horizontalDist.toFixed(1)} blocks)`);
      return await this.navigateWithPathfinder(targetX, targetY, targetZ, label, stopDistance, sessionId, ignoreY);
    } catch (error) {
      this.bot?.clearControlStates();
      logger.error(`[MOVEMENT-${sessionId}] ✗ FAILED`, { error, label });
      return `Failed to navigate to ${label}: ${error}`;
    }
  }

  /**
   * Smooth manual walking - visible in prismarine viewer
   * Uses control states with continuous yaw updates for natural movement
   */
  private async smoothWalkTo(
    targetX: number,
    targetY: number,
    targetZ: number,
    label: string,
    stopDistance: number = 1.5,
    timeoutMs: number = 10000
  ): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startTime = Date.now();
    const startPos = this.bot.entity.position.clone();

    // First, smoothly look towards target
    await this.smoothLookAt(targetX, targetY, targetZ, 300);

    // Start walking
    this.bot.setControlState('forward', true);

    return new Promise((resolve) => {
      const walkLoop = setInterval(() => {
        if (!this.bot) {
          clearInterval(walkLoop);
          resolve('Bot disconnected');
          return;
        }

        const currentPos = this.bot.entity.position;
        const dx = targetX - currentPos.x;
        const dz = targetZ - currentPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);

        // Check if we've arrived
        if (horizontalDist <= stopDistance) {
          this.bot.clearControlStates();
          clearInterval(walkLoop);
          const totalMoved = startPos.distanceTo(currentPos);
          resolve(`Walked to ${label} (moved ${totalMoved.toFixed(1)} blocks)`);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          this.bot.clearControlStates();
          clearInterval(walkLoop);
          const totalMoved = startPos.distanceTo(currentPos);
          resolve(`Timeout walking to ${label} (moved ${totalMoved.toFixed(1)} blocks, ${horizontalDist.toFixed(1)} remaining)`);
          return;
        }

        // Continuously update yaw to face target while walking
        // CRITICAL: Formula must be Math.atan2(-dx, -dz) to match Minecraft convention
        const targetYaw = Math.atan2(-dx, -dz);
        this.bot.look(targetYaw, 0, false);

      }, 33); // 33ms = ~30fps for smooth movement
    });
  }

  /**
   * ==========================================================================
   * HUMAN-LIKE DIRECT WALKING - For short distances (item pickup, final approach)
   * ==========================================================================
   * 
   * This function provides natural, human-like walking for short distances.
   * Unlike pathfinder (which calculates optimal A* routes), this simply:
   * 1. Maintains look direction toward target
   * 2. Walks forward using control states
   * 3. Auto-jumps over 1-block obstacles
   * 4. Breaks through instant-break blocks (leaves, vegetation)
   * 
   * USE CASES:
   * - Collecting dropped items after mining (1-3 blocks)
   * - Final approach to a block before mining
   * - Walking to a nearby crafting table
   * 
   * DO NOT USE FOR:
   * - Long distances (>8 blocks) - use pathfinder instead
   * - Complex terrain with gaps/drops - use pathfinder
   */
  private async walkDirectlyToward(
    targetX: number,
    targetZ: number,
    options: {
      stopDistance?: number;      // How close to get (default: 0.8)
      timeoutMs?: number;         // Max time to walk (default: 3000)
      maintainPitch?: number;     // Optional: maintain specific pitch while walking (default: 0 = horizontal)
      breakVegetation?: boolean;  // Break leaves/bushes blocking path (default: true)
      autoJump?: boolean;         // Jump over 1-block obstacles (default: true)
      label?: string;             // For logging
    } = {}
  ): Promise<{ success: boolean; moved: number; message: string }> {
    if (!this.bot) return { success: false, moved: 0, message: 'Bot not initialized' };

    const {
      stopDistance = 0.8,
      timeoutMs = 3000,
      maintainPitch = 0,  // DEFAULT TO HORIZONTAL - fixes bug where bot tries to walk while looking at ground
      breakVegetation = true,
      autoJump = true,
      label = 'target'
    } = options;

    const startTime = Date.now();
    const startPos = this.bot.entity.position.clone();
    let lastStuckCheck = startTime;
    let lastPosition = startPos.clone();
    let stuckCounter = 0;

    // Vegetation blocks that break instantly and should be walked through
    const instantBreakBlocks = [
      'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 
      'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'mangrove_leaves', 'cherry_leaves',
      'tall_grass', 'grass', 'fern', 'large_fern', 'dead_bush',
      'sweet_berry_bush', 'cave_vines', 'glow_lichen', 'vine', 'hanging_roots',
      'kelp', 'seagrass', 'tall_seagrass', 'flowering_azalea_leaves'
    ];

    logger.debug(`[DIRECT-WALK] Starting toward ${label}`, {
      from: `(${startPos.x.toFixed(1)}, ${startPos.z.toFixed(1)})`,
      to: `(${targetX.toFixed(1)}, ${targetZ.toFixed(1)})`,
      stopDistance,
      timeoutMs
    });

    // Calculate initial look direction
    const dx = targetX - startPos.x;
    const dz = targetZ - startPos.z;
    const initialDist = Math.sqrt(dx * dx + dz * dz);

    // Already there?
    if (initialDist <= stopDistance) {
      return { success: true, moved: 0, message: `Already at ${label}` };
    }

    // Start walking
    this.bot.setControlState('forward', true);

    return new Promise((resolve) => {
      const walkLoop = setInterval(async () => {
        if (!this.bot) {
          clearInterval(walkLoop);
          resolve({ success: false, moved: 0, message: 'Bot disconnected' });
          return;
        }

        const currentPos = this.bot.entity.position;
        const dx = targetX - currentPos.x;
        const dz = targetZ - currentPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);

        // Update look direction toward target (maintain pitch if specified)
        const targetYaw = Math.atan2(-dx, -dz);
        const pitch = maintainPitch ?? this.bot.entity.pitch;
        await this.bot.look(targetYaw, pitch, false);

        // Check if arrived
        if (horizontalDist <= stopDistance) {
          this.bot.clearControlStates();
          clearInterval(walkLoop);
          const moved = startPos.distanceTo(currentPos);
          logger.debug(`[DIRECT-WALK] ✓ Reached ${label}`, { moved: moved.toFixed(2) });
          resolve({ success: true, moved, message: `Reached ${label}` });
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          this.bot.clearControlStates();
          clearInterval(walkLoop);
          const moved = startPos.distanceTo(currentPos);
          logger.debug(`[DIRECT-WALK] Timeout walking to ${label}`, { moved: moved.toFixed(2), remaining: horizontalDist.toFixed(2) });
          resolve({ success: moved > 0.5, moved, message: `Timeout (moved ${moved.toFixed(1)} blocks)` });
          return;
        }

        // Stuck detection every 500ms
        const now = Date.now();
        if (now - lastStuckCheck > 500) {
          const movedSinceCheck = currentPos.distanceTo(lastPosition);
          
          if (movedSinceCheck < 0.1) {
            stuckCounter++;
            
            // Check blocks in movement direction at multiple heights
            // Leaves often block at head level (Y+1, Y+2), not just cursor level
            const moveDir = { x: Math.sin(-targetYaw), z: Math.cos(-targetYaw) };
            const checkPositions = [
              currentPos.offset(moveDir.x * 0.8, 0, moveDir.z * 0.8),   // Feet level
              currentPos.offset(moveDir.x * 0.8, 1, moveDir.z * 0.8),   // Chest level
              currentPos.offset(moveDir.x * 0.8, 2, moveDir.z * 0.8),   // Head level (for leaves above)
            ];
            
            let brokeBlock = false;
            if (breakVegetation) {
              for (const checkPos of checkPositions) {
                const blockAtPos = this.bot.blockAt(checkPos);
                if (blockAtPos && blockAtPos.name !== 'air' && 
                    instantBreakBlocks.some(b => blockAtPos.name.includes(b))) {
                  logger.debug(`[DIRECT-WALK] Breaking ${blockAtPos.name} at Y+${(checkPos.y - currentPos.y).toFixed(0)} blocking path`);
                  try {
                    this.bot.setControlState('forward', false);
                    await this.digWithAnimation(blockAtPos);
                    this.bot.setControlState('forward', true);
                    stuckCounter = 0;
                    brokeBlock = true;
                    break; // One block at a time
                  } catch (e) {
                    // Continue
                  }
                }
              }
            }
            
            // Also check cursor-based block (original logic)
            if (!brokeBlock) {
              const blockAhead = this.bot.blockAtCursor(2);
              if (blockAhead && blockAhead.name !== 'air') {
                if (breakVegetation && instantBreakBlocks.some(b => blockAhead.name.includes(b))) {
                  logger.debug(`[DIRECT-WALK] Breaking ${blockAhead.name} (cursor) blocking path`);
                  try {
                    this.bot.setControlState('forward', false);
                    await this.digWithAnimation(blockAhead);
                    this.bot.setControlState('forward', true);
                    stuckCounter = 0;
                    brokeBlock = true;
                  } catch (e) {
                    // Continue
                  }
                }
              }
            }
            
            // Try jumping if still stuck after breaking attempts
            if (!brokeBlock && autoJump && stuckCounter >= 2) {
              logger.debug(`[DIRECT-WALK] Jumping over obstacle`);
              this.bot.setControlState('jump', true);
              setTimeout(() => {
                if (this.bot) this.bot.setControlState('jump', false);
              }, 150);
              stuckCounter = 0;
            }

            // Give up after too many stuck attempts
            if (stuckCounter >= 5) {
              this.bot.clearControlStates();
              clearInterval(walkLoop);
              const moved = startPos.distanceTo(currentPos);
              logger.debug(`[DIRECT-WALK] Stuck at obstacle`, { moved: moved.toFixed(2) });
              resolve({ success: false, moved, message: 'Blocked by obstacle' });
              return;
            }
          } else {
            stuckCounter = 0;
          }

          lastPosition = currentPos.clone();
          lastStuckCheck = now;
        }

      }, 50); // 50ms = 20fps, enough for smooth walking
    });
  }

  /**
   * Legacy 2D wrapper for backward compatibility
   */
  private async walkTowardTarget(
    targetX: number,
    targetZ: number,
    label: string,
    stopDistance: number = 2
  ): Promise<string> {
    if (!this.bot) return 'Bot not initialized';
    const targetY = this.bot.entity.position.y;
    return this.walkTowardTarget3D(targetX, targetY, targetZ, label, stopDistance);
  }

  /**
   * Normalize angle to [-PI, PI]
   */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  private canTapJump(): boolean {
    if (!this.bot) return false;
    const now = Date.now();
    const onGround = Boolean((this.bot.entity as any).onGround);
    return onGround && (now - this.lastJumpAt) > JUMP_COOLDOWN_MS;
  }

  /**
   * Navigate using mineflayer pathfinder plugin
   * @param ignoreY If true, use GoalNearXZ which ignores Y coordinate (for directional walking)
   */
  private async navigateWithPathfinder(
    targetX: number,
    targetY: number,
    targetZ: number,
    label: string,
    stopDistance: number,
    sessionId: number,
    ignoreY: boolean = false
  ): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startYaw = this.bot.entity.yaw;
    const startPitch = this.bot.entity.pitch;

    logger.info(`[PATHFINDER-${sessionId}] Starting pathfinding navigation`, {
      label,
      target: `(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)})`,
      stopDistance,
      startLook: `yaw=${(startYaw * 180 / Math.PI).toFixed(1)}° pitch=${(startPitch * 180 / Math.PI).toFixed(1)}°`
    });

    // CRITICAL FIX: Only take over task notification if no other task is active
    // When called from mine(), actionInProgress is already 'mining' - don't override!
    // This prevents the bug where navigation ending clears the task, making idle looks
    // kick in before mining actually starts.
    const ownsTaskNotification = !this.actionInProgress || this.actionInProgress === 'navigating';
    if (ownsTaskNotification) {
      this.humanBehavior?.notifyTaskStart('navigating');
    }
    this.isNavigating = true; // Enable fast yaw smoothing mode

    try {
      // SMOOTH PITCH RESET: If looking up/down significantly, smoothly transition to horizontal
      // before pathfinder takes over (pathfinder snaps pitch to 0, causing jerky look changes)
      // Threshold: ~15 degrees (0.26 radians)
      if (Math.abs(startPitch) > 0.26) {
        movementLogger.logLookChange('pitch-reset-start', startYaw, startPitch);
        // 60fps smooth transition: ~300ms for natural feel
        const pitchResetSteps = 18; // 18 steps at 16ms = ~288ms
        for (let i = 1; i <= pitchResetSteps; i++) {
          const t = i / pitchResetSteps;
          // Ease-out for smooth deceleration
          const eased = 1 - Math.pow(1 - t, 2);
          const newPitch = startPitch * (1 - eased);
          await this.bot.look(startYaw, newPitch, false);
          await new Promise(resolve => setTimeout(resolve, 16));
        }
        movementLogger.logLookChange('pitch-reset-end', startYaw, 0, startYaw, startPitch);
        logger.debug(`[PATHFINDER-${sessionId}] Smoothly reset pitch from ${(startPitch * 180 / Math.PI).toFixed(1)}° to horizontal`);
      }

      // Calculate distance to target
      const botPos = this.bot.entity.position;
      const dx = targetX - botPos.x;
      const dz = targetZ - botPos.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      // NOTE: Do NOT smooth look toward final target before pathfinding!
      // The pathfinder may need to go a different direction (around obstacles).
      // Looking toward the final target first causes the bot to turn around mid-path.

      const movements = new Movements(this.bot);

      // ========================================================================
      // PATHFINDER MOVEMENT CONFIGURATION - Human-Like & Vegetation-Aware
      // ========================================================================
      // 
      // PROBLEM: Default settings cause the bot to:
      // 1. Take long detours around vegetation/bushes
      // 2. Get stuck against leaves/bushes instead of breaking through
      // 3. Give up when stuck instead of mining the blocking block
      //
      // SOLUTION: Lower dig cost for instant-break blocks, enable smarter digging
      // ========================================================================

      // HUMAN-LIKE: Disable sprinting and parkour for smoother, more natural movement
      // Sprinting causes jerky acceleration/deceleration
      // Parkour causes sudden jumps that look robotic
      movements.allowSprinting = false;
      movements.allowParkour = false;

      // Enable digging - CRITICAL for pushing through vegetation
      // Leaves, tall grass, sweet berry bushes all break instantly
      movements.canDig = true;

      const isUnderground = this.bot.entity.position.y < 60;
      if (isUnderground) {
        // Underground: low dig cost to path through dirt/gravel/stone
        movements.digCost = 15;
        logger.debug('[PATHFINDER] Underground mode - digging enabled for soft blocks');
      } else {
        // Above ground: MUCH lower dig cost (was 40, now 5)
        // Vegetation breaks instantly so cost should be very low
        // This prevents the bot from taking huge detours around bushes
        movements.digCost = 5;
        logger.debug('[PATHFINDER] Above ground - low dig cost for instant-break vegetation');
      }

      movements.allow1by1towers = false; // Don't build towers
      this.bot.pathfinder.setMovements(movements);
      
      // Track for stuck recovery
      let stuckRecoveryAttempts = 0;
      const MAX_STUCK_RECOVERY_ATTEMPTS = 3;

      // Let pathfinder handle movement directly - no initial walk phase
      // This provides smoother, more reliable navigation
      // Use GoalNearXZ for directional walking (ignores Y - lets pathfinder find ground level)
      // Use GoalNear for specific block navigation (respects Y coordinate)
      const goal = ignoreY
        ? new goals.GoalNearXZ(targetX, targetZ, stopDistance)
        : new goals.GoalNear(targetX, targetY, targetZ, stopDistance);
      this.bot.pathfinder.setGoal(goal, true);

      const startPos = this.bot.entity.position.clone();
      const startTime = Date.now();
      let lastLogTime = startTime;

      // BAD PATH DETECTION: Track if we're getting further from target
      const initialDistance = horizontalDist;
      let minDistanceAchieved = initialDistance;
      let lastProgressTime = startTime;
      const BAD_PATH_THRESHOLD = 5; // Abort if we're 5+ blocks further than we started
      const STUCK_TIMEOUT = 4000; // Abort if no progress toward target for 4 seconds

      // Log movement session start
      movementLogger.logSessionStart(sessionId, targetX, targetY, targetZ, label);

      // IMPORTANT: Do NOT override pathfinder's look direction during navigation!
      // The pathfinder sets look direction toward the NEXT WAYPOINT (not final target)
      // and uses that to control movement. If we override it, the bot walks in wrong directions.
      // Smooth look should ONLY be used when looking at specific blocks/entities (mining, attacking, etc.)

      // Position logging interval (for debugging only, no look override)
      // Running at 30fps (33ms) for smooth monitoring
      let logFrameCount = 0;
      const logInterval = setInterval(() => {
        if (!this.bot) return;
        logFrameCount++;
        // Log every 15 frames (~500ms at 30fps)
        if (logFrameCount % 15 === 0) {
          const currentPos = this.bot.entity.position;
          const currentYaw = this.bot.entity.yaw;
          const currentPitch = this.bot.entity.pitch;
          movementLogger.logLook(sessionId, 'pathfinder', currentYaw, currentPitch);
          movementLogger.logPosition(sessionId, currentPos.x, currentPos.y, currentPos.z, targetX, targetZ);
        }
      }, 33); // 33ms = ~30fps

      // Wait for pathfinding to complete or timeout
      return await new Promise<string>((resolve) => {
        const checkInterval = setInterval(async () => {
          if (!this.bot) {
            clearInterval(checkInterval);
            clearInterval(logInterval);
            movementLogger.logSessionEnd(sessionId, 'DISCONNECTED', Date.now() - startTime);
            resolve('Bot disconnected during pathfinding');
            return;
          }

          const now = Date.now();
          const elapsed = now - startTime;

          // Log progress every 2 seconds
          if (now - lastLogTime > 2000) {
            const currentPos = this.bot.entity.position;
            const distMoved = startPos.distanceTo(currentPos);
            const vec = this.calculate3DVector(targetX, targetY, targetZ);
            const currentYaw = this.bot.entity.yaw;
            const currentPitch = this.bot.entity.pitch;
            logger.info(`[PATHFINDER-${sessionId}] Progress`, {
              moved: distMoved.toFixed(2),
              remaining: vec.horizontalDist.toFixed(2),
              time: `${(elapsed / 1000).toFixed(1)}s`,
              look: `yaw=${(currentYaw * 180 / Math.PI).toFixed(0)}° pitch=${(currentPitch * 180 / Math.PI).toFixed(0)}°`
            });
            lastLogTime = now;
          }

          // Check if reached destination
          const currentVec = this.calculate3DVector(targetX, targetY, targetZ);
          if (currentVec.horizontalDist < stopDistance) {
            clearInterval(checkInterval);
            clearInterval(logInterval);
            this.bot.pathfinder.setGoal(null);
            logger.info(`[PATHFINDER-${sessionId}] ✓ SUCCESS`, {
              finalDistance: currentVec.horizontalDist.toFixed(2),
              duration: `${(elapsed / 1000).toFixed(1)}s`
            });
            const result = `Reached ${label} using pathfinder (${currentVec.horizontalDist.toFixed(1)} blocks away)`;
            movementLogger.logSessionEnd(sessionId, 'SUCCESS', elapsed);
            resolve(result);
            return;
          }

          // BAD PATH DETECTION: Track progress toward target
          if (currentVec.horizontalDist < minDistanceAchieved - 0.5) {
            // Made progress - update tracking
            minDistanceAchieved = currentVec.horizontalDist;
            lastProgressTime = now;
          }

          // Abort if we're going significantly further from target (bad route)
          if (currentVec.horizontalDist > initialDistance + BAD_PATH_THRESHOLD) {
            clearInterval(checkInterval);
            clearInterval(logInterval);
            this.bot.pathfinder.setGoal(null);
            logger.warn(`[PATHFINDER-${sessionId}] BAD PATH - aborting`, {
              initial: initialDistance.toFixed(1),
              current: currentVec.horizontalDist.toFixed(1),
              wentFurther: (currentVec.horizontalDist - initialDistance).toFixed(1)
            });
            const result = `Bad path detected - went ${(currentVec.horizontalDist - initialDistance).toFixed(1)} blocks further from ${label}`;
            movementLogger.logSessionEnd(sessionId, 'BAD_PATH', elapsed);
            resolve(result);
            return;
          }

          // ================================================================
          // STUCK RECOVERY: Try to mine through blocking vegetation/blocks
          // ================================================================
          // Instead of immediately giving up when stuck, check what's blocking
          // and attempt to mine through it if it's an instant-break block
          // ================================================================
          if (now - lastProgressTime > STUCK_TIMEOUT && elapsed > STUCK_TIMEOUT) {
            const moved = startPos.distanceTo(this.bot.entity.position);
            
            // STUCK RECOVERY: Try to break through before giving up
            if (stuckRecoveryAttempts < MAX_STUCK_RECOVERY_ATTEMPTS) {
              stuckRecoveryAttempts++;
              logger.info(`[PATHFINDER-${sessionId}] STUCK - attempting recovery ${stuckRecoveryAttempts}/${MAX_STUCK_RECOVERY_ATTEMPTS}`);
              
              // Check what's blocking us
              const blockAhead = this.bot.blockAtCursor(2);
              const blockAtFeet = this.bot.blockAt(this.bot.entity.position.offset(
                -Math.sin(this.bot.entity.yaw) * 0.7,
                0,
                -Math.cos(this.bot.entity.yaw) * 0.7
              ));
              const blockAtHead = this.bot.blockAt(this.bot.entity.position.offset(
                -Math.sin(this.bot.entity.yaw) * 0.7,
                1,
                -Math.cos(this.bot.entity.yaw) * 0.7
              ));
              
              // Instant-break blocks we should mine through
              const instantBreakBlocks = [
                'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 
                'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'mangrove_leaves', 'cherry_leaves',
                'tall_grass', 'grass', 'short_grass', 'fern', 'large_fern', 'dead_bush',
                'sweet_berry_bush', 'cave_vines', 'glow_lichen', 'vine', 'hanging_roots',
                'kelp', 'seagrass', 'tall_seagrass', 'flowering_azalea_leaves',
                'cobweb', 'moss_carpet', 'pink_petals', 'spore_blossom'
              ];
              
              // Check each potentially blocking position
              const blocksToCheck = [blockAhead, blockAtFeet, blockAtHead].filter(b => b && b.name !== 'air');
              let brokeBlock = false;
              
              for (const block of blocksToCheck) {
                if (!block) continue;
                
                const isInstantBreak = instantBreakBlocks.some(ib => block.name.includes(ib));
                if (isInstantBreak) {
                  logger.info(`[PATHFINDER-${sessionId}] Breaking ${block.name} blocking path`);
                  
                  // Stop pathfinder temporarily
                  this.bot.pathfinder.setGoal(null);
                  
                  // Look at and break the block
                  try {
                    await this.smoothLookAt(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5, 150);
                    await this.digWithAnimation(block);
                    brokeBlock = true;
                    logger.info(`[PATHFINDER-${sessionId}] ✓ Broke ${block.name}`);
                  } catch (e) {
                    logger.debug(`[PATHFINDER-${sessionId}] Could not break ${block.name}: ${e}`);
                  }
                  break;
                }
              }
              
              if (brokeBlock) {
                // Resume pathfinding after breaking block
                const newGoal = ignoreY
                  ? new goals.GoalNearXZ(targetX, targetZ, stopDistance)
                  : new goals.GoalNear(targetX, targetY, targetZ, stopDistance);
                this.bot.pathfinder.setGoal(newGoal, true);
                lastProgressTime = now; // Reset stuck timer
                return; // Continue checking, don't resolve yet
              }
              
              // Try jumping if no block to break
              logger.debug(`[PATHFINDER-${sessionId}] No instant-break block found, trying jump`);
              this.bot.setControlState('jump', true);
              setTimeout(() => {
                if (this.bot) this.bot.setControlState('jump', false);
              }, 150);
              lastProgressTime = now; // Reset stuck timer
              return; // Continue checking
            }
            
            // Max recovery attempts reached - give up
            clearInterval(checkInterval);
            clearInterval(logInterval);
            this.bot.pathfinder.setGoal(null);
            logger.warn(`[PATHFINDER-${sessionId}] STUCK - recovery failed after ${MAX_STUCK_RECOVERY_ATTEMPTS} attempts`, {
              moved: moved.toFixed(1),
              remaining: currentVec.horizontalDist.toFixed(1)
            });
            const result = `Stuck - could not break through obstacle to reach ${label}`;
            movementLogger.logSessionEnd(sessionId, 'STUCK', elapsed);
            resolve(result);
            return;
          }

          // Timeout after 15 seconds
          if (elapsed > 15000) {
            clearInterval(checkInterval);
            clearInterval(logInterval);
            this.bot.pathfinder.setGoal(null);
            const moved = startPos.distanceTo(this.bot.entity.position);
            logger.warn(`[PATHFINDER-${sessionId}] Timeout after ${(elapsed / 1000).toFixed(1)}s`, {
              moved: moved.toFixed(2),
              remaining: currentVec.horizontalDist.toFixed(2)
            });
            const result = `Pathfinder timeout - moved ${moved.toFixed(1)} blocks, ${currentVec.horizontalDist.toFixed(1)} remaining`;
            movementLogger.logSessionEnd(sessionId, 'TIMEOUT', elapsed);
            resolve(result);
            return;
          }

          // Check if pathfinder stopped moving
          if (!this.bot.pathfinder.isMoving()) {
            clearInterval(checkInterval);
            clearInterval(logInterval);
            const moved = startPos.distanceTo(this.bot.entity.position);
            const finalVec = this.calculate3DVector(targetX, targetY, targetZ);

            // Only accept if we actually moved AND are within stopDistance
            // Don't be lenient (+1) if we didn't move at all
            const acceptableDistance = moved > 0.5 ? (stopDistance + 0.5) : stopDistance;

            if (finalVec.horizontalDist < acceptableDistance) {
              logger.info(`[PATHFINDER-${sessionId}] ✓ Close enough`, {
                distance: finalVec.horizontalDist.toFixed(2),
                moved: moved.toFixed(2)
              });
              const result = `Reached near ${label} (${finalVec.horizontalDist.toFixed(1)} blocks away)`;
              movementLogger.logSessionEnd(sessionId, 'CLOSE_ENOUGH', elapsed);
              resolve(result);
            } else {
              logger.warn(`[PATHFINDER-${sessionId}] Pathfinder stopped`, {
                moved: moved.toFixed(2),
                remaining: finalVec.horizontalDist.toFixed(2)
              });
              const result = `Pathfinder couldn't reach ${label} - moved ${moved.toFixed(1)} blocks, ${finalVec.horizontalDist.toFixed(1)} remaining`;
              movementLogger.logSessionEnd(sessionId, 'STOPPED', elapsed);
              resolve(result);
            }
          }
        }, 33); // 33ms = ~30fps
      });
    } catch (error) {
      logger.error(`[PATHFINDER-${sessionId}] ✗ FAILED`, { error });
      this.bot.pathfinder.setGoal(null);
      return `Pathfinder failed: ${error}`;
    } finally {
      // Only notify task end if we were the ones who started the task
      // When called from mine(), actionInProgress is 'mining' - don't clear it!
      if (ownsTaskNotification) {
        this.humanBehavior?.notifyTaskEnd();
      }
      this.isNavigating = false; // Switch to slow yaw smoothing mode
    }
  }

  private async tapJump(): Promise<void> {
    if (!this.bot) return;
    this.lastJumpAt = Date.now();
    this.bot.setControlState('jump', true);
    await new Promise(resolve => setTimeout(resolve, JUMP_TAP_MS));
    this.bot.setControlState('jump', false);
  }

  /**
   * EMERGENCY FLEE - Run away from the closest hostile mob
   * Uses smart pathfinding to find safe direction
   */
  private async emergencyFlee(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();
    logger.warn('[EMERGENCY-FLEE] Starting emergency flee!');

    // Find all nearby hostile mobs
    const hostiles = this.getNearbyHostileMobs(15);
    
    if (hostiles.length === 0) {
      logger.info('[EMERGENCY-FLEE] No hostiles found, moving to random safe direction');
      // No hostiles visible, just run in a random direction
      const randomYaw = Math.random() * Math.PI * 2 - Math.PI;
      return await this.walkInDirectionByYaw(randomYaw, 12, 'flee_random');
    }

    // Calculate escape direction (opposite of the average hostile position)
    let avgHostileX = 0;
    let avgHostileZ = 0;
    hostiles.forEach(h => {
      avgHostileX += h.position.x;
      avgHostileZ += h.position.z;
    });
    avgHostileX /= hostiles.length;
    avgHostileZ /= hostiles.length;

    // Direction from hostiles to us
    const escapeX = startPos.x - avgHostileX;
    const escapeZ = startPos.z - avgHostileZ;
    
    // Calculate escape yaw (direction to run)
    const escapeYaw = Math.atan2(-escapeX, -escapeZ);
    
    logger.warn('[EMERGENCY-FLEE] Fleeing from hostiles', {
      hostileCount: hostiles.length,
      closestHostile: hostiles[0]?.name,
      closestDistance: hostiles[0]?.distance.toFixed(1),
      escapeDirection: (escapeYaw * 180 / Math.PI).toFixed(0) + '°',
    });

    // Sprint away!
    this.bot.setControlState('sprint', true);
    
    // Run for 15 blocks
    const result = await this.walkInDirectionByYaw(escapeYaw, 15, 'flee_from_hostiles');
    
    this.bot.setControlState('sprint', false);
    
    const endPos = this.bot.entity.position;
    const distanceFled = startPos.distanceTo(endPos);
    
    logger.info('[EMERGENCY-FLEE] Flee complete', {
      distanceFled: distanceFled.toFixed(1),
      newPosition: `${endPos.x.toFixed(0)}, ${endPos.y.toFixed(0)}, ${endPos.z.toFixed(0)}`,
    });

    return `Fled ${distanceFled.toFixed(0)} blocks from ${hostiles[0]?.name || 'danger'}!`;
  }

  /**
   * Walk in a specific yaw direction for a given distance
   */
  private async walkInDirectionByYaw(targetYaw: number, distance: number, label: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();
    
    // Look in the escape direction (set yaw directly for speed in emergency)
    await this.bot.look(targetYaw, 0, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Walk forward
    this.bot.setControlState('forward', true);
    this.bot.setControlState('sprint', true);
    
    // Walk for up to 5 seconds or until we've moved enough
    const startTime = Date.now();
    const timeout = 5000;
    
    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const currentPos = this.bot.entity.position;
      const distanceMoved = startPos.distanceTo(currentPos);
      
      if (distanceMoved >= distance) {
        break;
      }
      
      // Jump if we hit an obstacle
      const blockAhead = this.bot.blockAt(
        currentPos.offset(
          -Math.sin(targetYaw) * 1.5,
          0,
          -Math.cos(targetYaw) * 1.5
        )
      );
      
      if (blockAhead && blockAhead.boundingBox === 'block') {
        if (this.canTapJump()) {
          await this.tapJump();
        }
      }
    }
    
    this.bot.clearControlStates();
    
    const endPos = this.bot.entity.position;
    const distanceMoved = startPos.distanceTo(endPos);
    
    return `Moved ${distanceMoved.toFixed(0)} blocks (${label})`;
  }

  /**
   * Try to descend to lower ground - find a path down
   */
  private async descendToLowerGround(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const pos = this.bot.entity.position;
    const startY = Math.floor(pos.y);

    // Check if we're already on the ground (check if block 2 below is solid)
    const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
    const blockTwoBelow = this.bot.blockAt(pos.offset(0, -2, 0));

    if (blockBelow && blockBelow.name !== 'air' && blockTwoBelow && blockTwoBelow.name === 'air') {
      // We're on ground level, can't go lower without mining
      return `Already on ground at Y=${startY}. Use 'mine' to dig down if needed.`;
    }

    // Check cardinal directions for lower ground we can walk to
    const directions = [
      { name: 'north', dx: 0, dz: -1 },
      { name: 'south', dx: 0, dz: 1 },
      { name: 'east', dx: 1, dz: 0 },
      { name: 'west', dx: -1, dz: 0 },
    ];

    for (const dir of directions) {
      // Check if there's lower ground in this direction (drop of 1-3 blocks)
      for (let drop = 1; drop <= 3; drop++) {
        const checkPos = pos.offset(dir.dx, -drop, dir.dz);
        const groundBlock = this.bot.blockAt(checkPos);
        const headBlock = this.bot.blockAt(checkPos.offset(0, 1, 0));
        const feetBlock = this.bot.blockAt(checkPos.offset(0, 2, 0));

        if (groundBlock && groundBlock.name !== 'air' &&
            headBlock && headBlock.name === 'air' &&
            feetBlock && feetBlock.name === 'air') {
          // Found lower ground! Walk towards it
          logger.info(`[DESCEND] Found lower ground ${dir.name} (drop ${drop} blocks)`);

          // Calculate yaw towards this direction
          const yaw = Math.atan2(-dir.dx, -dir.dz);

          // Walk forward to step off
          await this.bot.look(yaw, 0, false);
          this.bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 800));
          this.bot.setControlState('forward', false);

          // Wait for gravity
          await new Promise(resolve => setTimeout(resolve, 500));

          const finalY = Math.floor(this.bot.entity.position.y);
          if (finalY < startY) {
            return `Descended ${dir.name} to Y=${finalY} (dropped ${startY - finalY} blocks)`;
          }
        }
      }
    }

    // If we're stuck floating (on a tree branch, etc.), try to walk off any edge
    const standingOn = this.bot.blockAt(pos.offset(0, -0.5, 0));
    if (standingOn && (standingOn.name.includes('leaves') || standingOn.name.includes('log'))) {
      // On a tree - walk in a random direction to fall off
      const randomDir = directions[Math.floor(Math.random() * directions.length)];
      const yaw = Math.atan2(-randomDir.dx, -randomDir.dz);
      await this.bot.look(yaw, 0, false);
      this.bot.setControlState('forward', true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.bot.setControlState('forward', false);
      await new Promise(resolve => setTimeout(resolve, 500));

      const finalY = Math.floor(this.bot.entity.position.y);
      if (finalY < startY) {
        return `Walked off tree, now at Y=${finalY}`;
      }
    }

    return `Cannot find lower ground from Y=${startY}. Position: ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`;
  }

  // ============================================================================
  // STUCK RECOVERY SYSTEM - Escape from holes, water, and blocked paths
  // ============================================================================

  /**
   * EMERGENCY ESCAPE - Immediate survival reflex, no AI thinking
   * Called automatically when taking rapid damage or at critical health
   */
  private isEscaping = false;
  private lastEscapeTime = 0;
  
  private async emergencyEscape(): Promise<void> {
    // Prevent spam - only escape once every 2 seconds
    const now = Date.now();
    if (this.isEscaping || now - this.lastEscapeTime < 2000) return;
    
    this.isEscaping = true;
    this.lastEscapeTime = now;
    
    try {
      if (!this.bot) return;
      
      const pos = this.bot.entity.position;
      
      // Check if underwater (drowning)
      const headBlock = this.bot.blockAt(pos.offset(0, 1.6, 0));
      const isUnderwater = headBlock?.name === 'water';
      
      if (isUnderwater) {
        // DROWNING: Swim up desperately
        logger.warn('[EMERGENCY] 🏊 DROWNING - Swimming up!');
        this.bot.setControlState('jump', true);
        this.bot.setControlState('forward', true);
        
        // Keep swimming up for 1.5 seconds (shorter to avoid issues)
        for (let i = 0; i < 15; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          // Abort if we died or disconnected
          if (!this.bot || !this.isConnected || this.bot.health <= 0) {
            this.clearAllControls();
            return;
          }
        }
        
        this.bot.setControlState('jump', false);
        this.bot.setControlState('forward', false);
      } else {
        // NOT DROWNING: Run away from current position
        logger.warn('[EMERGENCY] 🏃 Taking damage - Running away!');
        
        // Pick a random direction and sprint
        const directions = ['forward', 'back', 'left', 'right'] as const;
        const randomDir = directions[Math.floor(Math.random() * directions.length)];
        
        this.bot.setControlState('sprint', true);
        this.bot.setControlState(randomDir, true);
        // Don't hold jump - causes flying kick
        
        // Run for 1 second (shorter bursts)
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          // Abort if we died or disconnected
          if (!this.bot || !this.isConnected || this.bot.health <= 0) {
            this.clearAllControls();
            return;
          }
        }
        
        this.bot.setControlState('sprint', false);
        this.bot.setControlState(randomDir, false);
      }
      
      logger.info('[EMERGENCY] Escape action completed');
    } catch (e: any) {
      logger.error('[EMERGENCY] Escape failed', { error: e.message });
    } finally {
      this.isEscaping = false;
      this.clearAllControls(); // Always clear controls when done
    }
  }

  /**
   * Clear all movement control states - prevents flying kicks
   */
  private clearAllControls(): void {
    if (!this.bot) return;
    try {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('back', false);
      this.bot.setControlState('left', false);
      this.bot.setControlState('right', false);
      this.bot.setControlState('jump', false);
      this.bot.setControlState('sprint', false);
      this.bot.setControlState('sneak', false);
    } catch (e) {
      // Ignore errors if bot is disconnected
    }
  }

  /**
   * Main recovery action - called when bot is stuck
   * Tries multiple strategies: horizontal mining, pillar up, dig stairs, swim out
   */
  public async recoverFromStuck(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const pos = this.bot.entity.position;
    const startPos = pos.clone(); // Track for actual movement verification
    const currentY = Math.floor(pos.y);
    
    logger.warn('[STUCK-RECOVERY] Starting stuck recovery!', {
      position: `${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`,
      attempt: this.stuckState.currentRecoveryAttempts + 1,
      maxAttempts: this.MAX_RECOVERY_ATTEMPTS
    });

    // CRITICAL: Disable idle looking during recovery!
    this.isNavigating = true;
    this.humanBehavior?.notifyTaskStart('recovery');

    this.stuckState.isInRecoveryMode = true;
    this.stuckState.currentRecoveryAttempts++;

    // Check if we're in water first
    const currentBlock = this.bot.blockAt(pos);
    const isInWater = currentBlock?.name === 'water' || currentBlock?.name === 'flowing_water';

    if (isInWater) {
      const swimResult = await this.swimToSurface();
      if (swimResult.includes('Success')) {
        this.resetStuckState();
        return swimResult;
      }
    }

    // NEW: Check if we're at surface level but horizontally blocked
    // This is the case when Y >= 60 and skyLight is high (can see sky) but can't move
    const blockAboveHead = this.bot.blockAt(pos.offset(0, 2, 0));
    const isAtSurface = currentY >= 60 && blockAboveHead && blockAboveHead.skyLight >= 10;
    
    if (isAtSurface) {
      logger.info('[STUCK-RECOVERY] Detected surface-level horizontal blocking, trying horizontal escape');
      
      // Strategy 0: Mine horizontally to clear path (for surface-level stuck)
      const horizontalResult = await this.mineHorizontalEscape();
      const endPos = this.bot.entity.position;
      const distMoved = startPos.distanceTo(endPos);
      
      if (horizontalResult.includes('Success') || distMoved > 2) {
        this.resetStuckState();
        return horizontalResult;
      }
    }

    // Check inventory for blocks we can use to pillar up
    const pillarBlocks = ['dirt', 'cobblestone', 'stone', 'deepslate', 'netherrack', 'gravel', 'sand', 'oak_planks', 'spruce_planks', 'birch_planks'];
    let hasBlocks = false;
    let blockToUse = '';
    
    for (const blockName of pillarBlocks) {
      const item = this.bot.inventory.items().find(i => i.name === blockName);
      if (item && item.count >= 3) {
        hasBlocks = true;
        blockToUse = blockName;
        break;
      }
    }

    // Strategy 1: Pillar up if we have blocks (only if NOT at surface)
    if (hasBlocks && !isAtSurface) {
      const pillarResult = await this.pillarUp(blockToUse, 5);
      if (pillarResult.includes('Success') || pillarResult.includes('pillared')) {
        this.resetStuckState();
        return pillarResult;
      }
    }

    // Strategy 2: Dig stairs upward (skip if already at surface)
    if (!isAtSurface) {
      const stairsResult = await this.digStairsUp();
      if (stairsResult.includes('Success') || stairsResult.includes('dug')) {
        this.resetStuckState();
        return stairsResult;
      }
    }

    // Strategy 3: Just jump repeatedly while moving forward
    const jumpResult = await this.jumpSpamEscape();
    const finalPos = this.bot.entity.position;
    const totalDistMoved = startPos.distanceTo(finalPos);
    
    if (jumpResult.includes('escaped') || totalDistMoved > 2) {
      this.resetStuckState();
      return jumpResult;
    }

    // If we've tried too many times, give up on this stuck state
    if (this.stuckState.currentRecoveryAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      logger.error('[STUCK-RECOVERY] Max attempts reached, giving up');
      this.resetStuckState();
      return `Failed to recover after ${this.MAX_RECOVERY_ATTEMPTS} attempts - need different approach`;
    }

    // Still in recovery mode but this attempt didn't fully succeed
    // Keep navigation mode on but allow next cycle to try again
    this.isNavigating = false;
    this.humanBehavior?.notifyTaskEnd();
    
    return `Recovery attempt ${this.stuckState.currentRecoveryAttempts} failed - still stuck, trying again`;
  }

  /**
   * Mine horizontally to escape surface-level blocking
   * Used when bot is at surface (can see sky) but can't move in any direction
   */
  private async mineHorizontalEscape(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();
    logger.info('[HORIZONTAL-ESCAPE] Starting horizontal mining escape');

    // Try each direction - mine any blocking blocks at feet and head level
    const directions = [
      { dx: 1, dz: 0, name: 'east' },
      { dx: -1, dz: 0, name: 'west' },
      { dx: 0, dz: 1, name: 'south' },
      { dx: 0, dz: -1, name: 'north' },
    ];

    // Non-mineable blocks we should skip
    const skipBlocks = new Set(['water', 'flowing_water', 'lava', 'flowing_lava', 'air', 'bedrock', 'barrier']);
    
    let blocksMinedTotal = 0;
    let successDir = '';

    for (const dir of directions) {
      const pos = this.bot.entity.position;
      let blocksMined = 0;

      // Mine up to 3 blocks in this direction
      for (let dist = 1; dist <= 3; dist++) {
        const checkX = Math.floor(pos.x) + dir.dx * dist;
        const checkZ = Math.floor(pos.z) + dir.dz * dist;
        
        // Check blocks at feet and head level
        const feetPos = new Vec3(checkX, Math.floor(pos.y), checkZ);
        const headPos = new Vec3(checkX, Math.floor(pos.y) + 1, checkZ);
        
        for (const blockPos of [feetPos, headPos]) {
          const block = this.bot.blockAt(blockPos);
          
          if (block && !skipBlocks.has(block.name)) {
            try {
              // Look at the block
              await this.bot.lookAt(blockPos.offset(0.5, 0.5, 0.5), false);
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Mine it
              await this.bot.dig(block);
              blocksMined++;
              blocksMinedTotal++;
              logger.info('[HORIZONTAL-ESCAPE] Mined block', { block: block.name, dir: dir.name, dist });
            } catch (e) {
              logger.warn('[HORIZONTAL-ESCAPE] Failed to mine', { block: block.name, error: e });
            }
          }
        }

        // Check if there's now a clear path (air at feet and head level)
        const feetBlock = this.bot.blockAt(feetPos);
        const headBlock = this.bot.blockAt(headPos);
        const groundBlock = this.bot.blockAt(feetPos.offset(0, -1, 0));
        
        if (feetBlock?.name === 'air' && headBlock?.name === 'air' && 
            groundBlock && !skipBlocks.has(groundBlock.name)) {
          // Try to walk there
          const yaw = Math.atan2(-dir.dx, -dir.dz);
          await this.bot.look(yaw, 0, false);
          
          this.bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 500));
          this.bot.clearControlStates();
          
          const endPos = this.bot.entity.position;
          const distMoved = startPos.distanceTo(endPos);
          
          if (distMoved > 1.5) {
            successDir = dir.name;
            logger.info('[HORIZONTAL-ESCAPE] Cleared path!', { dir: dir.name, blocksMined, distMoved: distMoved.toFixed(1) });
            return `Success! Cleared path ${dir.name}, mined ${blocksMined} blocks, moved ${distMoved.toFixed(1)} blocks`;
          }
        }
      }
    }

    // Even if we didn't move, report what we mined
    const finalPos = this.bot.entity.position;
    const finalDist = startPos.distanceTo(finalPos);
    
    if (blocksMinedTotal > 0) {
      if (finalDist > 1) {
        return `Success! Mined ${blocksMinedTotal} blocks, moved ${finalDist.toFixed(1)} blocks`;
      }
      return `Mined ${blocksMinedTotal} blocks but path still blocked - may need more mining`;
    }

    return 'No mineable blocks found - may be surrounded by water/lava';
  }

  /**
   * Pillar up - jump and place block below to climb out of hole
   */
  private async pillarUp(blockName: string, targetHeight: number = 5): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startY = Math.floor(this.bot.entity.position.y);
    const item = this.bot.inventory.items().find(i => i.name === blockName);
    
    if (!item) {
      return `No ${blockName} in inventory for pillar`;
    }

    logger.info('[PILLAR-UP] Starting pillar escape', { block: blockName, targetHeight });

    // Equip the block
    try {
      await this.bot.equip(item, 'hand');
    } catch (e) {
      return `Failed to equip ${blockName}`;
    }

    let blocksPlaced = 0;
    const maxBlocks = Math.min(targetHeight, item.count);

    for (let i = 0; i < maxBlocks; i++) {
      try {
        // Jump
        this.bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // At peak of jump, place block below
        const blockBelow = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
        if (blockBelow && blockBelow.name === 'air') {
          // Find adjacent block to place against
          const adjacentPositions = [
            this.bot.entity.position.offset(0, -2, 0),
            this.bot.entity.position.offset(1, -1, 0),
            this.bot.entity.position.offset(-1, -1, 0),
            this.bot.entity.position.offset(0, -1, 1),
            this.bot.entity.position.offset(0, -1, -1),
          ];
          
          for (const adjPos of adjacentPositions) {
            const adjBlock = this.bot.blockAt(adjPos);
            if (adjBlock && adjBlock.name !== 'air') {
              await this.bot.placeBlock(adjBlock, new Vec3(0, 1, 0));
              blocksPlaced++;
              logger.info('[PILLAR-UP] Placed block', { placed: blocksPlaced, y: Math.floor(this.bot.entity.position.y) });
              break;
            }
          }
        }
        
        this.bot.setControlState('jump', false);
        await new Promise(resolve => setTimeout(resolve, 300));

        // Check if we can see sky or have reached target
        const currentY = Math.floor(this.bot.entity.position.y);
        const blockAbove = this.bot.blockAt(this.bot.entity.position.offset(0, 2, 0));
        if (blockAbove && blockAbove.skyLight === 15) {
          logger.info('[PILLAR-UP] Reached surface!');
          break;
        }
        if (currentY - startY >= targetHeight) {
          break;
        }
      } catch (e) {
        logger.warn('[PILLAR-UP] Failed to place block', { error: e });
      }
    }

    this.bot.setControlState('jump', false);
    
    const finalY = Math.floor(this.bot.entity.position.y);
    const heightGained = finalY - startY;

    if (heightGained > 0) {
      return `Success! Pillared up ${heightGained} blocks using ${blocksPlaced} ${blockName}`;
    }
    return `Pillar failed - could not place blocks`;
  }

  /**
   * Dig stairs upward - mine a diagonal staircase to escape
   */
  private async digStairsUp(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startY = Math.floor(this.bot.entity.position.y);
    logger.info('[DIG-STAIRS] Starting stair escape from Y=' + startY);

    // Pick a direction and dig stairs
    const directions = [
      { dx: 0, dz: 1, name: 'south' },
      { dx: 1, dz: 0, name: 'east' },
      { dx: 0, dz: -1, name: 'north' },
      { dx: -1, dz: 0, name: 'west' },
    ];
    
    // Find best direction (preferring where there's already some air)
    let bestDir = directions[0];
    let bestAirCount = 0;
    
    for (const dir of directions) {
      const pos = this.bot.entity.position;
      let airCount = 0;
      for (let i = 1; i <= 3; i++) {
        const checkBlock = this.bot.blockAt(new Vec3(
          Math.floor(pos.x) + dir.dx * i,
          Math.floor(pos.y) + i,
          Math.floor(pos.z) + dir.dz * i
        ));
        if (checkBlock && checkBlock.name === 'air') airCount++;
      }
      if (airCount > bestAirCount) {
        bestAirCount = airCount;
        bestDir = dir;
      }
    }

    logger.info('[DIG-STAIRS] Digging stairs ' + bestDir.name);

    // Check if we're already at surface (skyLight >= 10) - if so, dig horizontally instead of upward
    const initialBlockAbove = this.bot.blockAt(this.bot.entity.position.offset(0, 2, 0));
    const alreadyAtSurface = startY >= 60 && initialBlockAbove && initialBlockAbove.skyLight >= 10;
    
    if (alreadyAtSurface) {
      logger.info('[DIG-STAIRS] Already at surface, digging horizontally instead');
    }

    // Dig 5 stair steps (or horizontal steps if at surface)
    let stepsDug = 0;
    const startPos = this.bot.entity.position.clone();
    
    for (let step = 0; step < 5; step++) {
      const pos = this.bot.entity.position;
      
      // If at surface, dig horizontally (same Y level). Otherwise dig upward.
      const yOffset = alreadyAtSurface ? 0 : step;
      const headY = Math.floor(pos.y) + 1;
      const feetY = Math.floor(pos.y);
      const forwardX = Math.floor(pos.x) + bestDir.dx * (step + 1);
      const forwardZ = Math.floor(pos.z) + bestDir.dz * (step + 1);

      // Dig blocks at head and feet level in front
      for (const y of [headY, feetY]) {
        const blockPos = new Vec3(forwardX, y, forwardZ);
        const block = this.bot.blockAt(blockPos);
        
        if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'lava' && block.name !== 'bedrock') {
          try {
            // Look at block
            await this.bot.lookAt(blockPos.offset(0.5, 0.5, 0.5));
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Mine it
            await this.bot.dig(block);
            stepsDug++;
            logger.info('[DIG-STAIRS] Dug block', { block: block.name, y, horizontal: alreadyAtSurface });
          } catch (e) {
            logger.warn('[DIG-STAIRS] Failed to dig', { block: block?.name, error: e });
          }
        }
      }

      // Move forward (and up if not at surface)
      this.bot.setControlState('forward', true);
      if (!alreadyAtSurface) {
        this.bot.setControlState('jump', true);
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      this.bot.setControlState('jump', false);
      this.bot.setControlState('forward', false);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if we've made progress (moved from start position)
      const currentPos = this.bot.entity.position;
      const distMoved = startPos.distanceTo(currentPos);
      
      // Only exit early if we've actually moved AND can see sky
      const blockAbove = this.bot.blockAt(currentPos.offset(0, 3, 0));
      if (blockAbove && blockAbove.skyLight === 15 && distMoved > 2) {
        logger.info('[DIG-STAIRS] Reached surface and moved!', { distMoved: distMoved.toFixed(1) });
        break;
      }
    }

    this.bot.clearControlStates();
    
    const finalPos = this.bot.entity.position;
    const finalY = Math.floor(finalPos.y);
    const heightGained = finalY - startY;
    const distanceMoved = startPos.distanceTo(finalPos);

    // Success if we gained height OR moved horizontally
    if (heightGained > 0) {
      return `Success! Dug stairs ${bestDir.name}, climbed ${heightGained} blocks`;
    }
    if (distanceMoved > 2) {
      return `Success! Dug horizontal path ${bestDir.name}, moved ${distanceMoved.toFixed(1)} blocks`;
    }
    if (stepsDug > 0) {
      return `Dug ${stepsDug} blocks ${bestDir.name} but path still blocked`;
    }
    return `Stair digging incomplete - dug ${stepsDug} blocks but didn't move`;
  }

  /**
   * Swim to surface - for water escapes
   */
  private async swimToSurface(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startY = Math.floor(this.bot.entity.position.y);
    logger.info('[SWIM] Starting swim to surface from Y=' + startY);

    // Hold jump to swim up
    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);

    const startTime = Date.now();
    const timeout = 10000; // 10 second timeout

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const pos = this.bot.entity.position;
      const currentBlock = this.bot.blockAt(pos);
      
      // Check if we've surfaced
      if (!currentBlock || currentBlock.name !== 'water') {
        // We're out of water!
        this.bot.clearControlStates();
        const finalY = Math.floor(pos.y);
        logger.info('[SWIM] Surfaced!', { startY, finalY });
        
        // Now try to find shore
        await this.findShore();
        
        return `Success! Swam to surface (Y=${startY} → Y=${finalY})`;
      }
    }

    this.bot.clearControlStates();
    return `Swim failed - still in water after ${timeout/1000}s`;
  }

  /**
   * Find and move to shore from water
   */
  private async findShore(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Look for solid ground in all directions
    const directions = [
      { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
      { dx: 1, dz: 1 }, { dx: -1, dz: -1 },
      { dx: 1, dz: -1 }, { dx: -1, dz: 1 },
    ];

    for (const dir of directions) {
      for (let dist = 1; dist <= 10; dist++) {
        const pos = this.bot.entity.position;
        const checkPos = new Vec3(
          Math.floor(pos.x) + dir.dx * dist,
          Math.floor(pos.y),
          Math.floor(pos.z) + dir.dz * dist
        );
        
        const groundBlock = this.bot.blockAt(checkPos.offset(0, -1, 0));
        const feetBlock = this.bot.blockAt(checkPos);
        const headBlock = this.bot.blockAt(checkPos.offset(0, 1, 0));
        
        // Found solid ground with air above
        if (groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'water' &&
            feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'water') &&
            headBlock && headBlock.name === 'air') {
          
          // Move towards it
          const yaw = Math.atan2(-dir.dx, -dir.dz);
          await this.bot.look(yaw, 0, false);
          
          this.bot.setControlState('forward', true);
          this.bot.setControlState('jump', true); // Keep jumping in case still in water
          await new Promise(resolve => setTimeout(resolve, dist * 300));
          this.bot.clearControlStates();
          
          logger.info('[SHORE] Found shore!');
          return 'Found shore';
        }
      }
    }

    return 'Could not find shore';
  }

  /**
   * Jump spam escape - just jump repeatedly while moving forward
   */
  private async jumpSpamEscape(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();
    logger.info('[JUMP-SPAM] Attempting jump escape');

    // Pick a random direction
    const randomYaw = Math.random() * Math.PI * 2 - Math.PI;
    await this.bot.look(randomYaw, 0, false);

    // Spam jump while moving forward
    this.bot.setControlState('forward', true);
    
    for (let i = 0; i < 10; i++) {
      this.bot.setControlState('jump', true);
      await new Promise(resolve => setTimeout(resolve, 200));
      this.bot.setControlState('jump', false);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.bot.clearControlStates();

    const endPos = this.bot.entity.position;
    const distMoved = startPos.distanceTo(endPos);
    const heightGained = endPos.y - startPos.y;

    if (distMoved > 3 || heightGained > 1) {
      return `Jump escaped! Moved ${distMoved.toFixed(1)} blocks, height change: ${heightGained.toFixed(1)}`;
    }

    return 'Jump spam did not help';
  }

  /**
   * Track move result and update stuck state
   */
  public trackMoveResult(success: boolean, result: string): void {
    if (success) {
      this.stuckState.consecutiveBlockedMoves = 0;
      this.stuckState.lastSuccessfulMoveTime = Date.now();
      
      // Track position
      if (this.bot) {
        const pos = this.bot.entity.position;
        this.stuckState.positionHistoryForStuck.push({
          x: pos.x, y: pos.y, z: pos.z,
          time: Date.now()
        });
        // Keep only last 10 positions
        if (this.stuckState.positionHistoryForStuck.length > 10) {
          this.stuckState.positionHistoryForStuck.shift();
        }
      }
    } else {
      // Check if it's a "all directions blocked" failure
      if (result.includes('all directions blocked') || result.includes('Could not move')) {
        this.stuckState.consecutiveBlockedMoves++;
        logger.warn('[STUCK-TRACK] Consecutive blocked moves', { 
          count: this.stuckState.consecutiveBlockedMoves 
        });
      }
    }
  }

  /**
   * Check if we're stuck and need recovery
   */
  public isStuck(): boolean {
    // Check for consecutive blocked moves
    if (this.stuckState.consecutiveBlockedMoves >= 2) {
      logger.warn('[STUCK-CHECK] Stuck due to consecutive blocked moves');
      return true;
    }

    // Check if we haven't moved successfully in a while
    const timeSinceSuccess = Date.now() - this.stuckState.lastSuccessfulMoveTime;
    if (timeSinceSuccess > this.STUCK_THRESHOLD_MS) {
      // Also check if we've actually moved (position history)
      if (this.stuckState.positionHistoryForStuck.length >= 2) {
        const oldest = this.stuckState.positionHistoryForStuck[0];
        const newest = this.stuckState.positionHistoryForStuck[this.stuckState.positionHistoryForStuck.length - 1];
        const dist = Math.sqrt(
          Math.pow(newest.x - oldest.x, 2) + 
          Math.pow(newest.z - oldest.z, 2)
        );
        if (dist < 2) { // Haven't moved more than 2 blocks in 30s
          logger.warn('[STUCK-CHECK] Stuck due to no movement');
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get stuck state for AI context
   */
  public getStuckInfo(): { isStuck: boolean; blockedMoves: number; inWater: boolean; inRecovery: boolean } {
    const inWater = this.bot ? 
      (this.bot.blockAt(this.bot.entity.position)?.name === 'water') : false;
    
    return {
      isStuck: this.isStuck(),
      blockedMoves: this.stuckState.consecutiveBlockedMoves,
      inWater,
      inRecovery: this.stuckState.isInRecoveryMode
    };
  }

  /**
   * Reset stuck state after successful recovery
   */
  private resetStuckState(): void {
    this.stuckState.consecutiveBlockedMoves = 0;
    this.stuckState.currentRecoveryAttempts = 0;
    this.stuckState.isInRecoveryMode = false;
    this.stuckState.lastSuccessfulMoveTime = Date.now();
    
    // Re-enable idle looking after recovery
    this.isNavigating = false;
    this.humanBehavior?.notifyTaskEnd();
    
    logger.info('[STUCK-RECOVERY] State reset - recovery complete');
  }

  /**
   * Smooth walking using direct control states - like a real player pressing W
   * This looks much more natural than pathfinder's jumpy movement
   */
  private async walkSmoothly(targetYaw: number, distance: number, label: string, sessionId: number): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startPos = this.bot.entity.position.clone();
    const maxTime = 5000; // 5 second timeout
    const startTime = Date.now();

    try {
      // Step 1: Smoothly turn to face the direction (like a real player)
      const currentYaw = this.bot.entity.yaw;
      const currentPitch = this.bot.entity.pitch;
      const yawDiff = this.normalizeAngle(targetYaw - currentYaw);

      // Log look change and smooth pitch reset if needed
      movementLogger.logLookChange('walkSmoothly-start', currentYaw, currentPitch);

      // Smooth turn over 300-500ms, also reset pitch to horizontal
      const turnSteps = Math.max(3, Math.abs(yawDiff) * 5);
      for (let i = 1; i <= turnSteps; i++) {
        const intermediateYaw = currentYaw + (yawDiff * i / turnSteps);
        const intermediatePitch = currentPitch * (1 - i / turnSteps); // Smooth pitch to 0
        await this.bot.look(intermediateYaw, intermediatePitch, false); // false = smooth
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Final look to exact yaw
      await this.bot.look(targetYaw, 0, true);
      movementLogger.logLookChange('walkSmoothly-ready', targetYaw, 0, currentYaw, currentPitch);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 2: Walk forward using control states
      this.bot.setControlState('forward', true);
      this.bot.setControlState('sprint', true); // Sprint for faster movement

      let stuckCounter = 0;
      let totalMoved = 0;

      // Walk until we've gone far enough or hit obstacle
      while (Date.now() - startTime < maxTime) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const currentPos = this.bot.entity.position;
        const moved = Math.sqrt(
          Math.pow(currentPos.x - startPos.x, 2) +
          Math.pow(currentPos.z - startPos.z, 2)
        );
        totalMoved = moved;

        // Check if we've walked far enough
        if (moved >= distance - 1) {
          this.bot.clearControlStates();
          logger.info(`[SMOOTH-WALK-${sessionId}] ✓ Walked ${moved.toFixed(1)} blocks ${label}`);
          return `Smoothly walked ${moved.toFixed(1)} blocks ${label}`;
        }

        // Check for obstacles - if we stopped moving
        const horizontalSpeed = this.getHorizontalSpeed();

        // Auto-jump if we hit something
        if (horizontalSpeed < 0.5 && this.bot.entity.onGround) {
          // Try jumping over obstacle
          this.bot.setControlState('jump', true);
          await new Promise(resolve => setTimeout(resolve, 100));
          this.bot.setControlState('jump', false);
          stuckCounter++;

          if (stuckCounter >= 3) {
            // Really stuck - stop and report
            this.bot.clearControlStates();
            logger.info(`[SMOOTH-WALK-${sessionId}] Blocked after ${moved.toFixed(1)} blocks`);
            return `Walked ${moved.toFixed(1)} blocks ${label}, then blocked`;
          }
        } else {
          stuckCounter = 0;
        }
      }

      // Timeout
      this.bot.clearControlStates();
      logger.info(`[SMOOTH-WALK-${sessionId}] Timeout after ${totalMoved.toFixed(1)} blocks`);
      return `Walked ${totalMoved.toFixed(1)} blocks ${label} (timeout)`;

    } catch (error) {
      this.bot?.clearControlStates();
      return `Walk failed: ${error}`;
    }
  }

  /**
   * Get current horizontal speed
   */
  private getHorizontalSpeed(): number {
    if (!this.bot) return 0;
    const vel = this.bot.entity.velocity;
    return Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  }

  /**
   * Walk in a fixed direction - for cardinal/relative directions (forward, north, etc.)
   * Uses pathfinder directly for reliable movement
   * If primary direction is blocked, tries alternative angles (±45°, ±90°)
   */
  private async walkInDirection(yaw: number, label: string, startPos: Vec3): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const sessionId = ++this.movementSessionId;
    const distance = MOVE_DISTANCE; // 10 blocks

    // Calculate target position
    const targetX = startPos.x - Math.sin(yaw) * distance;
    const targetZ = startPos.z + Math.cos(yaw) * distance;
    const targetY = startPos.y;

    logger.info(`[DIR-WALK-${sessionId}] Starting directional walk`, {
      direction: label,
      yaw: yaw.toFixed(2),
      yawDegrees: `${(yaw * 180 / Math.PI).toFixed(1)}°`,
      from: `(${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`,
      to: `(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)})`
    });

    try {
      // Use pathfinder directly - smooth walk is unreliable
      // ignoreY=true: Use GoalNearXZ so pathfinder finds ground level (fixes beach/water navigation)
      const result = await this.navigateWithPathfinder(targetX, targetY, targetZ, label, 2, sessionId, true);

      // Check if primary path failed (moved < 1 block)
      const pathfinderMatch = result.match(/moved\s+(\d+\.?\d*)/i);
      if (pathfinderMatch) {
        const pfDistanceMoved = parseFloat(pathfinderMatch[1]);
        if (pfDistanceMoved < 1) {
          // Primary path blocked - try alternative directions
          logger.info(`[DIR-WALK-${sessionId}] Primary path blocked, trying alternatives...`);

          // Try angles in order: +45°, -45°, +90°, -90° from original direction
          const alternativeAngles = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];

          for (const offset of alternativeAngles) {
            const altYaw = this.normalizeAngle(yaw + offset);
            const altX = startPos.x - Math.sin(altYaw) * distance;
            const altZ = startPos.z + Math.cos(altYaw) * distance;
            const angleLabel = offset > 0 ? `+${(offset * 180 / Math.PI).toFixed(0)}°` : `${(offset * 180 / Math.PI).toFixed(0)}°`;

            logger.info(`[DIR-WALK-${sessionId}] Trying alternative angle ${angleLabel}`, {
              altYaw: altYaw.toFixed(2),
              to: `(${altX.toFixed(1)}, ${targetY.toFixed(1)}, ${altZ.toFixed(1)})`
            });

            const altResult = await this.navigateWithPathfinder(altX, targetY, altZ, `${label} (${angleLabel})`, 2, sessionId, true);

            // Check if alternative worked (moved > 2 blocks)
            const altMovedMatch = altResult.match(/moved\s+(\d+\.?\d*)/i);
            if (altMovedMatch) {
              const altMoved = parseFloat(altMovedMatch[1]);
              if (altMoved >= 2) {
                logger.info(`[DIR-WALK-${sessionId}] ✓ Alternative angle ${angleLabel} succeeded`, { moved: altMoved });
                return `${label} was blocked, moved ${angleLabel} instead - ${altResult}`;
              }
            } else if (altResult.includes('Reached')) {
              logger.info(`[DIR-WALK-${sessionId}] ✓ Alternative angle ${angleLabel} succeeded`);
              return `${label} was blocked, moved ${angleLabel} instead - ${altResult}`;
            }
          }

          // All pathfinder alternatives failed - try manual walk with jump as last resort
          logger.info(`[DIR-WALK-${sessionId}] Pathfinder blocked, trying manual walk...`);
          
          const manualResult = await this.manualWalkWithJump(yaw, label, sessionId);
          if (manualResult.moved > 2) {
            logger.info(`[DIR-WALK-${sessionId}] ✓ Manual walk succeeded`, { moved: manualResult.moved.toFixed(1) });
            return `Manually walked ${label} - moved ${manualResult.moved.toFixed(1)} blocks`;
          }
          
          // All alternatives failed - track for stuck detection
          logger.warn(`[DIR-WALK-${sessionId}] All directions blocked (pathfinder + manual)`);
          this.trackMoveResult(false, 'all directions blocked');
          
          // If we're stuck, suggest recovery
          if (this.stuckState.consecutiveBlockedMoves >= 2) {
            return `STUCK! All directions blocked ${this.stuckState.consecutiveBlockedMoves}x - use 'recover' action to escape`;
          }
          return `Could not move ${label} - all directions blocked (try 'recover' action if stuck)`;
        }
      }

      return result;
    } catch (error) {
      this.bot?.clearControlStates();
      logger.error(`[DIR-WALK-${sessionId}] ✗ FAILED`, { error, direction: label });
      return `Failed to walk ${label}: ${error}`;
    }
  }

  /**
   * Manual walk with jump - fallback when pathfinder fails
   * Tries to walk forward while jumping, can escape some edge cases like water edges
   */
  private async manualWalkWithJump(yaw: number, label: string, sessionId: number): Promise<{ moved: number; result: string }> {
    if (!this.bot) return { moved: 0, result: 'Bot not initialized' };

    const startPos = this.bot.entity.position.clone();
    
    // Look in the target direction
    await this.bot.look(yaw, 0, false);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Walk forward with jump for 2 seconds
    this.bot.setControlState('forward', true);
    
    const walkDuration = 2000;
    const jumpInterval = 300;
    const startTime = Date.now();
    
    while (Date.now() - startTime < walkDuration) {
      // Jump periodically
      this.bot.setControlState('jump', true);
      await new Promise(resolve => setTimeout(resolve, 150));
      this.bot.setControlState('jump', false);
      await new Promise(resolve => setTimeout(resolve, jumpInterval - 150));
      
      // Check if we're moving
      const currentPos = this.bot.entity.position;
      const moved = startPos.distanceTo(currentPos);
      
      // If we've made good progress, we're out
      if (moved > 3) {
        break;
      }
    }

    this.bot.clearControlStates();
    
    const endPos = this.bot.entity.position;
    const moved = startPos.distanceTo(endPos);
    
    logger.info(`[MANUAL-WALK-${sessionId}] Manual walk result`, { 
      direction: label, 
      moved: moved.toFixed(1),
      from: `(${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`,
      to: `(${endPos.x.toFixed(1)}, ${endPos.y.toFixed(1)}, ${endPos.z.toFixed(1)})`
    });

    if (moved > 2) {
      return { moved, result: `Walked ${moved.toFixed(1)} blocks ${label}` };
    }
    return { moved, result: `Manual walk only moved ${moved.toFixed(1)} blocks` };
  }

  /**
   * Navigate to a specific 3D position with real-time trajectory calculations
   */
  private async navigateToPosition3D(
    x: number,
    y: number,
    z: number,
    label: string,
    tolerance: number = 2
  ): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const vec = this.calculate3DVector(x, y, z);

    logger.info(`Navigating to ${label}`, {
      target: { x: x.toFixed(1), y: y.toFixed(1), z: z.toFixed(1) },
      distance: vec.totalDist.toFixed(1),
      horizontalDist: vec.horizontalDist.toFixed(1),
      elevationDiff: vec.dy.toFixed(1)
    });

    // Use 3D smooth walking toward the target
    return await this.walkTowardTarget3D(x, y, z, label, tolerance);
  }

  /**
   * Legacy navigation wrapper (for backward compatibility)
   */
  private async navigateToPosition(
    x: number,
    y: number,
    z: number,
    label: string,
    tolerance: number = 2
  ): Promise<string> {
    return this.navigateToPosition3D(x, y, z, label, tolerance);
  }

  /**
   * Mine a block - positions close, digs, collects item
   */
  private async mine(blockName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Prevent concurrent actions - check if another action is already running
    if (this.actionInProgress) {
      logger.warn(`[MINE] Action blocked - ${this.actionInProgress} already in progress`);
      return `Cannot mine - ${this.actionInProgress} already in progress`;
    }
    this.actionInProgress = 'mining';

    // Notify human behavior: task starting
    this.humanBehavior?.notifyTaskStart('mining');

    const blockType = this.mcData.blocksByName[blockName.toLowerCase()];
    if (!blockType) {
      this.actionInProgress = null;
      this.humanBehavior?.notifyTaskEnd();
      return `Unknown block type: ${blockName}`;
    }

    // Use findBlocks to get multiple candidates and pick the best one
    const blockPositions = this.bot.findBlocks({
      matching: blockType.id,
      maxDistance: 32,
      count: 10, // Get up to 10 candidates
    });

    if (blockPositions.length === 0) {
      this.actionInProgress = null;
      this.humanBehavior?.notifyTaskEnd();
      return `No ${blockName} found nearby`;
    }

    const playerPos = this.bot.entity.position;
    const playerY = Math.floor(playerPos.y);
    const isLogBlock = blockName.toLowerCase().includes('log');

    // Score and sort blocks - prefer closest AND at player Y level for logs
    // Also filter out inaccessible logs (inside tree canopy)
    const scoredBlocks = blockPositions
      .filter(pos => {
        // For logs, skip inaccessible blocks (surrounded by leaves)
        if (isLogBlock && !this.isLogAccessible(pos)) {
          return false;
        }
        return true;
      })
      .map(pos => {
        const dist = playerPos.distanceTo(pos);
        const yDiff = Math.abs(pos.y - playerY);
        // For logs (trees), heavily prefer blocks at player Y level (trunk base)
        // This prevents trying to mine logs at the top of trees
        const yPenalty = isLogBlock ? yDiff * 2 : 0;
        return { pos, dist, score: dist + yPenalty };
      }).sort((a, b) => a.score - b.score);

    // Check if any accessible blocks remain
    if (scoredBlocks.length === 0) {
      this.actionInProgress = null;
      this.humanBehavior?.notifyTaskEnd();
      return `No accessible ${blockName} found - all nearby logs are inside tree canopy`;
    }

    // Pick the best block
    const bestPos = scoredBlocks[0].pos;
    const block = this.bot.blockAt(bestPos);

    if (!block) {
      this.actionInProgress = null;
      this.humanBehavior?.notifyTaskEnd();
      return `No ${blockName} found nearby`;
    }

    logger.info(`[MINE] Selected best block from ${blockPositions.length} candidates`, {
      block: blockName,
      position: `${bestPos.x}, ${bestPos.y}, ${bestPos.z}`,
      distance: scoredBlocks[0].dist.toFixed(2),
      isLog: isLogBlock,
      playerY,
      blockY: bestPos.y
    });

    try {
      const startPos = this.bot.entity.position.clone();
      const distance = this.bot.entity.position.distanceTo(block.position);
      logger.info(`Mining ${blockName} at distance ${distance.toFixed(2)}`);

      // Track inventory changes by item count, not slot count
      const getInventoryMap = () => {
        const map = new Map<string, number>();
        this.bot!.inventory.items().forEach(item => {
          map.set(item.name, (map.get(item.name) || 0) + item.count);
        });
        return map;
      };

      const inventoryBefore = getInventoryMap();
      logger.info(`Inventory before: ${Array.from(inventoryBefore.entries()).map(([name, count]) => `${count}x ${name}`).join(', ') || 'empty'}`);

      // ========================================================================
      // HUMAN-LIKE MINING SEQUENCE (Fixed order)
      // ========================================================================
      // A human player would:
      // 1. LOOK at the target block first (identify what to mine)
      // 2. WALK toward it while maintaining look direction
      // 3. STOP when close enough
      // 4. Brief PAUSE to "aim" (100-200ms)
      // 5. MINE the block
      // 6. WALK FORWARD to collect the dropped item
      // ========================================================================

      // STEP 1: LOOK at the block FIRST (like a human spotting a target)
      // This happens BEFORE we start walking, so we know where we're going
      logger.info(`[MINE-HUMAN] Step 1: Looking at ${blockName}`);
      await this.smoothLookAt(
        block.position.x + 0.5,
        block.position.y + 0.5,
        block.position.z + 0.5,
        300  // 300ms for natural head turn
      );
      
      // Brief pause after looking (human "recognition" moment)
      await new Promise(resolve => setTimeout(resolve, 100));

      // STEP 2: APPROACH the block if too far (maintain look direction)
      // Mining reach is ~5.2 blocks, we want to be closer for reliable item pickup
      const MINING_REACH = 4.5;  // Stay within comfortable reach
      const ITEM_PICKUP_REACH = 2.5;  // Close enough to auto-collect items

      if (distance > MINING_REACH) {
        logger.info(`[MINE-HUMAN] Step 2: Walking to ${blockName} (${distance.toFixed(1)} blocks away)`);
        
        // Calculate approach position - stop ITEM_PICKUP_REACH blocks from the block
        // so we're close enough to collect items after mining
        const dx = block.position.x - startPos.x;
        const dz = block.position.z - startPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        
        if (horizontalDist > ITEM_PICKUP_REACH + 1) {
          // Walk to a point that's ITEM_PICKUP_REACH blocks from the block
          const ratio = (horizontalDist - ITEM_PICKUP_REACH) / horizontalDist;
          const approachX = startPos.x + dx * ratio;
          const approachZ = startPos.z + dz * ratio;
          
          // Use pathfinder for longer distances, but with mining target context
          await this.walkTowardTarget3D(
            approachX,
            block.position.y,  // Approach at block's Y level
            approachZ,
            blockName,
            1.5  // Stop distance from approach point
          );
          
          // After pathfinder, RE-LOOK at the block (pathfinder may have changed direction)
          logger.info(`[MINE-HUMAN] Re-acquiring target after approach`);
          await this.smoothLookAt(
            block.position.x + 0.5,
            block.position.y + 0.5,
            block.position.z + 0.5,
            200  // Quick re-aim
          );
        }
      } else if (distance > ITEM_PICKUP_REACH) {
        // Close but not close enough for easy item pickup
        // Use DIRECT walking (not pathfinder) for short final approach
        logger.info(`[MINE-HUMAN] Step 2: Short approach to ${blockName}`);
        await this.walkDirectlyToward(block.position.x, block.position.z, {
          stopDistance: ITEM_PICKUP_REACH,
          timeoutMs: 2000,
          label: blockName
        });
        
        // Re-look at block after approach
        await this.smoothLookAt(
          block.position.x + 0.5,
          block.position.y + 0.5,
          block.position.z + 0.5,
          150
        );
      }

      // STEP 3: Verify we're in range
      const finalDistance = this.bot.entity.position.distanceTo(block.position);
      logger.info(`[MINE-HUMAN] Final distance: ${finalDistance.toFixed(2)} blocks`);

      if (finalDistance > 5.5) {
        this.actionInProgress = null;
        this.humanBehavior?.notifyTaskEnd();
        return `Cannot reach ${blockName} (${finalDistance.toFixed(1)} blocks away - need to be within 5.5)`;
      }

      // STEP 4: SMART TOOL SELECTION (equip best tool before mining)
      const toolResult = await this.equipBestToolForBlock(blockName);
      if (toolResult.equipped) {
        logger.info('[TOOL-SELECT] Equipped optimal tool', {
          block: blockName,
          tool: toolResult.toolName,
          reason: toolResult.reason
        });
        // Brief pause after equipping (human would take a moment)
        await new Promise(resolve => setTimeout(resolve, 80));
      } else if (toolResult.warning) {
        logger.warn('[TOOL-SELECT] No optimal tool available', {
          block: blockName,
          warning: toolResult.warning,
          willUse: toolResult.toolName || 'hand'
        });
      }

      // CRITICAL CHECK: Will this block actually drop anything with current tool?
      const currentTool = this.bot.heldItem?.name || null;
      const digDecision = shouldDigBlock(blockName, currentTool);

      logger.info('[MINING] Tool check', {
        block: blockName,
        heldItem: currentTool,
        shouldDig: digDecision.shouldDig,
        reason: digDecision.reason,
        recommendedTool: digDecision.recommendedTool
      });

      if (!digDecision.shouldDig) {
        this.actionInProgress = null;
        this.humanBehavior?.notifyTaskEnd();
        const needTool = digDecision.recommendedTool || 'pickaxe';
        logger.warn('[MINING] Aborting - wrong tool would produce no drops', {
          block: blockName,
          currentTool: currentTool || 'hand',
          required: needTool,
          reason: digDecision.reason
        });
        return `Cannot mine ${blockName} - ${digDecision.reason}. Need ${needTool} first! Craft wooden pickaxe: get wood logs → craft planks → craft sticks → craft crafting_table → craft wooden_pickaxe`;
      }

      // STEP 5: Track item entity spawns (backup detection)
      let itemSpawned = false;
      let spawnedItemEntity: any = null;
      const entitySpawnHandler = (entity: any) => {
        if (!entity || !entity.position) return;
        const dist = entity.position.distanceTo(block.position);
        // Log ALL entities spawning nearby for debugging (use displayName, not deprecated objectType)
        if (dist < 10) {
          logger.debug(`[ENTITY-SPAWN] type=${entity.type} name=${entity.name} displayName=${entity.displayName} dist=${dist.toFixed(2)}`);
        }
        // Dropped items in Mineflayer: type='object' with displayName containing item info
        // CRITICAL: Exclude players and mobs first! They also have displayNames.
        if (entity.type === 'player' || entity.type === 'mob') return;
        
        // Also check if it's an item entity by name matching the block we mined
        const isDroppedItem = 
          entity.type === 'object' ||
          entity.type === 'item' ||
          (entity.name && entity.name.toLowerCase().includes(blockName.toLowerCase().replace('_', '')));
        
        if (isDroppedItem && dist < 8) {
          itemSpawned = true;
          spawnedItemEntity = entity;
          logger.info(`✓ Item entity detected! type=${entity.type} displayName=${entity.displayName} dist=${dist.toFixed(2)} pos=(${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}, ${entity.position.z.toFixed(1)})`);
        }
      };
      this.bot.on('entitySpawn', entitySpawnHandler);

      // STEP 6: STOP ALL MOVEMENT before mining (critical - prevents walking while digging)
      this.bot.clearControlStates();
      
      // Brief "aiming" pause before mining (human-like targeting)
      await new Promise(resolve => setTimeout(resolve, 120));

      // Save block position before it's destroyed
      const blockPos = block.position.clone();

      // STEP 7: MINE with visible arm swing animation
      logger.info(`[MINE-HUMAN] Step 5: Mining ${blockName}`);
      const predigYaw = this.bot.entity.yaw;
      const predigPitch = this.bot.entity.pitch;
      
      await this.digWithAnimation(block);

      // Log if dig caused unexpected look snap
      const postdigPitch = this.bot.entity.pitch;
      const pitchChange = Math.abs(postdigPitch - predigPitch) * 180 / Math.PI;
      if (pitchChange > 15) {
        movementLogger.logLookChange('dig-internal-snap', this.bot.entity.yaw, postdigPitch, predigYaw, predigPitch);
      }

      // STEP 8: Wait for item to spawn and settle (500ms for reliability)
      await new Promise(resolve => setTimeout(resolve, 500));
      this.bot.removeListener('entitySpawn', entitySpawnHandler);
      
      // DEBUG: Log all entities near the mined block to understand what's there
      const debugEntities: string[] = [];
      for (const entity of Object.values(this.bot.entities) as any[]) {
        if (!entity || !entity.position) continue;
        const dist = entity.position.distanceTo(blockPos);
        if (dist < 15) {
          debugEntities.push(`${entity.type}/${entity.displayName || entity.name || 'unknown'} at (${entity.position.x.toFixed(1)},${entity.position.y.toFixed(1)},${entity.position.z.toFixed(1)}) dist=${dist.toFixed(1)}`);
        }
      }
      if (debugEntities.length > 0) {
        logger.info(`[DEBUG-ENTITIES] Near mined block: ${debugEntities.join(' | ')}`);
      } else {
        logger.warn(`[DEBUG-ENTITIES] NO entities found within 15 blocks of mined block!`);
      }

      // ========================================================================
      // ROBUST ITEM COLLECTION
      // ========================================================================
      // The entity spawn event often fails to detect items. Instead:
      // 1. ACTIVELY SEARCH for all item entities near the mined block
      // 2. Find the closest one (could have fallen into a hole)
      // 3. Walk directly to it
      // ========================================================================

      logger.info(`[MINE-HUMAN] Step 6: Collecting dropped item`);
      
      // CRITICAL: Search for actual item entities, don't rely on spawn event
      const botPos = this.bot.entity.position;
      let closestItem: { entity: any; dist: number } | null = null;
      
      // Search ALL entities for dropped items near the mined block
      for (const entity of Object.values(this.bot.entities) as any[]) {
        if (!entity || !entity.position) continue;
        
        // Check if this is a dropped item entity
        // CRITICAL: Exclude players and mobs first! They also have displayNames.
        if (entity.type === 'player' || entity.type === 'mob') continue;
        
        // In Mineflayer, dropped items have type='object' and a displayName
        const isItemEntity = 
          entity.type === 'object' ||
          entity.type === 'item' ||
          (entity.metadata && Array.isArray(entity.metadata) && entity.metadata.length > 7);
        
        if (!isItemEntity) continue;
        
        // Calculate distance from mined block position
        const distToBlock = entity.position.distanceTo(blockPos);
        
        // Only consider items within 10 blocks of where we mined (items can fall far)
        if (distToBlock > 10) continue;
        
        // Track the closest item
        if (!closestItem || distToBlock < closestItem.dist) {
          closestItem = { entity, dist: distToBlock };
        }
      }
      
      // Determine target position
      let itemTargetPos: { x: number; y: number; z: number };
      let itemSource: string;
      
      if (closestItem) {
        itemTargetPos = closestItem.entity.position.clone();
        itemSource = 'found-entity';
        logger.info(`[ITEM-SEARCH] Found item entity at (${itemTargetPos.x.toFixed(1)}, ${itemTargetPos.y.toFixed(1)}, ${itemTargetPos.z.toFixed(1)}), dist from block=${closestItem.dist.toFixed(2)}`);
      } else if (spawnedItemEntity && this.bot.entities[spawnedItemEntity.id]) {
        itemTargetPos = this.bot.entities[spawnedItemEntity.id].position.clone();
        itemSource = 'spawn-event';
        logger.info(`[ITEM-SEARCH] Using spawn-detected item at (${itemTargetPos.x.toFixed(1)}, ${itemTargetPos.y.toFixed(1)}, ${itemTargetPos.z.toFixed(1)})`);
      } else {
        itemTargetPos = { x: blockPos.x + 0.5, y: blockPos.y, z: blockPos.z + 0.5 };
        itemSource = 'block-fallback';
        logger.warn(`[ITEM-SEARCH] No item entity found! Using block position as fallback`);
      }
      
      // Calculate actual distance to item
      const itemDx = itemTargetPos.x - botPos.x;
      const itemDz = itemTargetPos.z - botPos.z;
      const itemDy = itemTargetPos.y - botPos.y;
      const itemHorizDist = Math.sqrt(itemDx * itemDx + itemDz * itemDz);
      const item3DDist = Math.sqrt(itemDx * itemDx + itemDy * itemDy + itemDz * itemDz);
      
      logger.info(`[ITEM-COLLECT] Target: (${itemTargetPos.x.toFixed(1)}, ${itemTargetPos.y.toFixed(1)}, ${itemTargetPos.z.toFixed(1)}) source=${itemSource} horizDist=${itemHorizDist.toFixed(2)} Ydiff=${itemDy.toFixed(2)}`);
      
      // Collection strategy based on item position
      if (item3DDist < 2.5) {
        // Already close enough for auto-pickup - just wait
        logger.info('[ITEM-COLLECT] Close enough, waiting for auto-pickup...');
        await new Promise(resolve => setTimeout(resolve, 500));
      } else if (itemDy < -1.5 && itemHorizDist < 2) {
        // Item fell into a deep hole below us - need to jump down
        logger.info(`[ITEM-COLLECT] Item ${Math.abs(itemDy).toFixed(1)} blocks below - jumping into hole`);
        // Look down at the item first
        await this.smoothLookAt(itemTargetPos.x, itemTargetPos.y, itemTargetPos.z, 200);
        // Walk forward to fall into hole
        this.bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 600));
        this.bot.setControlState('forward', false);
        // Wait to land and collect
        await new Promise(resolve => setTimeout(resolve, 800));
      } else if (itemDy > 1.5) {
        // Item is above us (mined upper log, item on ledge) - can't reach easily
        logger.info(`[ITEM-COLLECT] Item ${itemDy.toFixed(1)} blocks ABOVE - walking under to catch falling item`);
        // Walk to the X,Z position and wait for item to fall
        await this.walkDirectlyToward(itemTargetPos.x, itemTargetPos.z, {
          stopDistance: 0.3,
          timeoutMs: 2000,
          label: 'catch falling item'
        });
        await new Promise(resolve => setTimeout(resolve, 800));
      } else {
        // Normal case - walk to item
        // Reset pitch if looking too far down
        const currentPitch = this.bot.entity.pitch;
        if (currentPitch < -0.6) {
          const targetPitch = -0.2;
          const currentYaw = this.bot.entity.yaw;
          for (let i = 1; i <= 4; i++) {
            const newPitch = currentPitch + (targetPitch - currentPitch) * (i / 4);
            await this.bot.look(currentYaw, newPitch, false);
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
        
        logger.info('[ITEM-COLLECT] Walking to item...');
        await this.walkDirectlyToward(itemTargetPos.x, itemTargetPos.z, {
          stopDistance: 0.3,  // Get very close
          timeoutMs: 3000,
          label: 'item pickup',
          autoJump: true
        });
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      // Final pickup wait
      await new Promise(resolve => setTimeout(resolve, 300));

      // Final sweep: Check for any remaining items we might have missed
      let currentBotPos = this.bot.entity.position;
      const remainingItems = Object.values(this.bot.entities).filter((e: any) => {
        if (!e.position) return false;
        // CRITICAL: Exclude players and mobs first! They also have displayNames.
        if (e.type === 'player' || e.type === 'mob') return false;
        // Check for item entities
        const isItem = 
          e.type === 'object' ||
          e.type === 'item' ||
          (e.metadata && Array.isArray(e.metadata) && e.metadata.length > 7);
        if (!isItem) return false;
        // Within 10 blocks of where we mined
        return e.position.distanceTo(blockPos) < 10;
      });
      
      if (remainingItems.length > 0) {
        logger.info(`[FINAL-SWEEP] Found ${remainingItems.length} remaining item(s), collecting...`);
        for (const item of remainingItems as any[]) {
          currentBotPos = this.bot.entity.position;
          const dist = currentBotPos.distanceTo(item.position);
          const yDiff = item.position.y - currentBotPos.y;
          
          if (dist > 2) {
            logger.info(`[FINAL-SWEEP] Walking to item at dist=${dist.toFixed(2)}, yDiff=${yDiff.toFixed(1)}`);
            
            // If item is below us, we need to fall down to it
            if (yDiff < -1) {
              // Walk toward item position and fall
              this.bot.setControlState('forward', true);
              await new Promise(resolve => setTimeout(resolve, 500));
              this.bot.setControlState('forward', false);
              await new Promise(resolve => setTimeout(resolve, 600)); // Wait to land
            }
            
            // Walk directly toward item's X/Z position
            await this.walkDirectlyToward(item.position.x, item.position.z, {
              stopDistance: 0.5,
              timeoutMs: 2500,
              label: 'final item collect',
              autoJump: true  // Enable jump in case we need to get up
            });
          }
          // Wait for auto-pickup
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      // Check game mode
      if (this.bot.game.gameMode === 'creative') {
        logger.warn(`⚠️ In CREATIVE mode - blocks don't drop items! Use /gamemode survival`);
      }

      // Check what we got
      const inventoryAfter = getInventoryMap();
      logger.info(`Inventory after: ${Array.from(inventoryAfter.entries()).map(([name, count]) => `${count}x ${name}`).join(', ') || 'empty'}`);

      // Calculate what changed
      const changes: string[] = [];
      inventoryAfter.forEach((countAfter, itemName) => {
        const countBefore = inventoryBefore.get(itemName) || 0;
        if (countAfter > countBefore) {
          changes.push(`+${countAfter - countBefore} ${itemName}`);
        }
      });

      if (changes.length > 0) {
        this.sessionStats.blocksMined++;
        this.sessionStats.actionsCompleted++;
        return `Mined ${blockName} → ${changes.join(', ')}`;
      }

      // Wait a bit longer for item pickup (don't do random search movements)
      logger.info('Waiting for item pickup...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Check one more time
      const inventoryFinal = getInventoryMap();
      const finalChanges: string[] = [];
      inventoryFinal.forEach((countAfter, itemName) => {
        const countBefore = inventoryBefore.get(itemName) || 0;
        if (countAfter > countBefore) {
          finalChanges.push(`+${countAfter - countBefore} ${itemName}`);
        }
      });
      
      if (finalChanges.length > 0) {
        this.sessionStats.blocksMined++;
        this.sessionStats.actionsCompleted++;
        return `Mined ${blockName} → ${finalChanges.join(', ')}`;
      }

      // Check if in creative mode
      if (this.bot.game.gameMode === 'creative') {
        this.sessionStats.blocksMined++;
        this.sessionStats.actionsCompleted++;
        return `Mined ${blockName} (in CREATIVE mode - items don't drop. Use /gamemode survival)`;
      }

      // Block was mined but item wasn't collected
      this.sessionStats.blocksMined++;
      this.sessionStats.actionsCompleted++;
      return `Mined ${blockName} but item was not collected (may have despawned or fallen)`;
    } catch (error) {
      this.sessionStats.actionsFailed++;
      return `Failed to mine ${blockName}: ${error}`;
    } finally {
      // Clear action lock and notify human behavior: task ended
      this.actionInProgress = null;
      this.humanBehavior?.notifyTaskEnd();
    }
  }

  /**
   * Dig upward - Uses pathfinder with digging enabled, falls back to manual if needed
   */
  private async digUp(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Look up to survey escape route (visual feedback)
    await this.bot.look(this.bot.entity.yaw, -Math.PI / 4); // Look up at 45 degrees
    await new Promise(resolve => setTimeout(resolve, 300));

    const startPos = this.bot.entity.position.clone();
    const startY = Math.floor(startPos.y);

    // DIAGNOSTIC: Log exact position and surrounding blocks
    logger.info(`[dig_up] === DIAGNOSTIC START ===`);
    logger.info(`[dig_up] Exact position: (${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)}, ${startPos.z.toFixed(2)})`);
    logger.info(`[dig_up] Floor Y: ${startY}`);

    // Check blocks at multiple heights above
    const blockAtY1 = this.bot.blockAt(startPos.offset(0, 1, 0));
    const blockAtY2 = this.bot.blockAt(startPos.offset(0, 2, 0));
    const blockAtY3 = this.bot.blockAt(startPos.offset(0, 3, 0));
    const blockBelow = this.bot.blockAt(startPos.offset(0, -1, 0));

    logger.info(`[dig_up] Block at Y+1 (head level): ${blockAtY1?.name || 'null'}`);
    logger.info(`[dig_up] Block at Y+2 (above head): ${blockAtY2?.name || 'null'}`);
    logger.info(`[dig_up] Block at Y+3: ${blockAtY3?.name || 'null'}`);
    logger.info(`[dig_up] Block below (Y-1): ${blockBelow?.name || 'null'}`);

    // Check inventory for placeable blocks
    const inventory = this.bot.inventory.items();
    const placeableBlocks = inventory.filter(item =>
      item.name.includes('_block') || item.name.includes('cobblestone') ||
      item.name.includes('dirt') || item.name.includes('stone') ||
      item.name.includes('plank') || item.name.includes('wood') ||
      item.name === 'gravel' || item.name === 'sand' || item.name === 'clay_ball'
    );
    logger.info(`[dig_up] Inventory: ${inventory.map(i => `${i.count}x ${i.name}`).join(', ') || 'empty'}`);
    logger.info(`[dig_up] Placeable blocks: ${placeableBlocks.map(i => `${i.count}x ${i.name}`).join(', ') || 'NONE'}`);

    // Check surrounding blocks at current level
    const north = this.bot.blockAt(startPos.offset(0, 0, -1));
    const south = this.bot.blockAt(startPos.offset(0, 0, 1));
    const east = this.bot.blockAt(startPos.offset(1, 0, 0));
    const west = this.bot.blockAt(startPos.offset(-1, 0, 0));
    logger.info(`[dig_up] Surroundings: N=${north?.name}, S=${south?.name}, E=${east?.name}, W=${west?.name}`);

    logger.info(`[dig_up] === END DIAGNOSTIC ===`);

    // If already at or above surface, no need to dig up
    if (startY >= 62) {
      return `Already at surface level (Y=${startY}). Look for trees with "mine oak_log" or "mine birch_log".`;
    }

    // CRITICAL: If air is directly above (Y+2), try jumping first before pathfinder
    if (blockAtY2?.name === 'air' && blockAtY1?.name === 'air') {
      logger.info(`[dig_up] Air above - attempting manual jump climb`);

      // Try to jump up multiple times
      for (let jumpAttempt = 0; jumpAttempt < 5; jumpAttempt++) {
        const beforeJumpY = this.bot.entity.position.y;

        // Jump and move forward slightly
        this.bot.setControlState('jump', true);
        this.bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 400));
        this.bot.clearControlStates();
        await new Promise(resolve => setTimeout(resolve, 200));

        const afterJumpY = this.bot.entity.position.y;
        logger.info(`[dig_up] Jump attempt ${jumpAttempt + 1}: Y ${beforeJumpY.toFixed(2)} → ${afterJumpY.toFixed(2)}`);

        if (afterJumpY <= beforeJumpY + 0.1) {
          logger.info(`[dig_up] Jump didn't gain height - may need to pillar or path around`);
          break;
        }
      }

      const afterJumpsY = Math.floor(this.bot.entity.position.y);
      if (afterJumpsY > startY) {
        const gain = afterJumpsY - startY;
        logger.info(`[dig_up] Manual jumping gained ${gain} blocks`);
        return `Climbed ${gain} blocks by jumping (Y: ${startY} → ${afterJumpsY}). ${afterJumpsY >= 60 ? 'At surface!' : 'Continue with dig_up.'}`;
      }
    }

    // Target position: 8 blocks directly above current position
    const targetY = Math.min(startY + 8, 70); // Don't go above 70
    const targetX = Math.floor(startPos.x);
    const targetZ = Math.floor(startPos.z);

    try {
      // First, try to dig any block directly above (Y+2)
      if (blockAtY2 && blockAtY2.name !== 'air' && blockAtY2.name !== 'water' && blockAtY2.name !== 'lava') {
        logger.info(`[dig_up] Block above: ${blockAtY2.name} - attempting to dig`);

        // Check if it's diggable without tools (dirt, gravel, sand)
        const softBlocks = ['dirt', 'grass_block', 'gravel', 'sand', 'clay', 'soul_sand', 'coarse_dirt'];
        const isSoft = softBlocks.some(b => blockAtY2.name.includes(b));

        if (isSoft || blockAtY2.name === 'stone' || blockAtY2.name.includes('_ore')) {
          try {
            await this.digWithAnimation(blockAtY2);
            logger.info(`[dig_up] Dug ${blockAtY2.name}`);
          } catch (digError) {
            logger.warn(`[dig_up] Could not dig ${blockAtY2.name} - ${digError}`);
          }
        }
      }

      // Use pathfinder to navigate upward
      const movements = new Movements(this.bot);
      movements.canDig = true;  // Allow digging through blocks
      movements.allow1by1towers = placeableBlocks.length > 0;  // Only allow towers if we have blocks!
      movements.allowParkour = true;
      movements.allowSprinting = true;
      movements.digCost = 10; // Lower cost to encourage digging

      logger.info(`[dig_up] Pathfinder settings: canDig=true, allow1by1towers=${placeableBlocks.length > 0}, target=(${targetX}, ${targetY}, ${targetZ})`);

      this.bot.pathfinder.setMovements(movements);
      this.bot.pathfinder.setGoal(new goals.GoalBlock(targetX, targetY, targetZ));

      // Monitor pathfinder progress during the 8 seconds
      const startTime = Date.now();
      let lastLoggedY = startY;

      while (Date.now() - startTime < 8000) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const currentY = Math.floor(this.bot.entity.position.y);
        const isMoving = this.bot.pathfinder.isMoving();

        if (currentY !== lastLoggedY) {
          logger.info(`[dig_up] Progress: Y=${currentY}, pathfinder moving=${isMoving}`);
          lastLoggedY = currentY;
        } else if (!isMoving) {
          logger.warn(`[dig_up] Pathfinder stopped moving at Y=${currentY}`);
          break;
        }
      }

      // Stop pathfinding
      this.bot.pathfinder.setGoal(null);

      const finalY = Math.floor(this.bot.entity.position.y);
      const actualGain = finalY - startY;
      const surfaceRemaining = Math.max(0, 62 - finalY);

      logger.info(`[dig_up] Result: Y=${startY} → Y=${finalY} (gained ${actualGain})`);

      if (actualGain <= 0) {
        // If stuck, provide detailed diagnosis
        const currentBlockAbove = this.bot.blockAt(this.bot.entity.position.offset(0, 2, 0));
        const blockName = currentBlockAbove?.name || 'unknown';

        logger.warn(`[dig_up] STUCK DIAGNOSIS:`);
        logger.warn(`[dig_up]   - Block above: ${blockName}`);
        logger.warn(`[dig_up]   - Has placeable blocks: ${placeableBlocks.length > 0}`);
        logger.warn(`[dig_up]   - Surrounded by: N=${north?.name}, S=${south?.name}, E=${east?.name}, W=${west?.name}`);

        if (blockName === 'air') {
          if (placeableBlocks.length === 0) {
            return `Stuck in vertical shaft at Y=${finalY}. Air above but NO BLOCKS to pillar up. Need to explore horizontally to find dirt/cobblestone, or mine blocks from walls.`;
          }
          return `Air above at Y=${finalY} but couldn't climb. Try "place ${placeableBlocks[0]?.name}" below you and jump, or "move" to find a different path.`;
        } else if (blockName.includes('stone') || blockName.includes('_ore') || blockName.includes('andesite') || blockName.includes('diorite') || blockName.includes('granite')) {
          return `Blocked by ${blockName} at Y=${finalY}. Need PICKAXE to continue. Cannot mine stone with bare hands. Explore horizontally to find wood for tools.`;
        } else if (blockName === 'bedrock') {
          return `Hit bedrock at Y=${finalY}. Cannot dig through bedrock. Move sideways first.`;
        }
        return `Could not climb (Y=${finalY}). Blocked by ${blockName}. Try "mine ${blockName}" or explore horizontally.`;
      }

      if (finalY >= 60) {
        return `Escaped underground! Now at Y=${finalY}. Look for trees with "mine oak_log" or "analyze".`;
      }

      return `Climbed ${actualGain} blocks (Y: ${startY} → ${finalY}). ${surfaceRemaining > 0 ? `Use dig_up again (~${surfaceRemaining} more to surface).` : 'At surface!'}`;

    } catch (error) {
      logger.error(`[dig_up] Pathfinding failed: ${error}`);
      return `dig_up failed. Check what's above you with "analyze" then "mine <block>" the blocking block.`;
    }
  }

  /**
   * Place a block - functional blocks go in front, building blocks use pillaring
   */
  private async place(blockName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Notify human behavior: task starting
    this.humanBehavior?.notifyTaskStart('placing');

    const item = this.bot.inventory.items().find(i => i.name === blockName);
    if (!item) {
      this.humanBehavior?.notifyTaskEnd();
      return `Don't have ${blockName} in inventory`;
    }

    // Functional blocks should be placed in front of us, not used for pillaring
    const functionalBlocks = ['crafting_table', 'furnace', 'chest', 'ender_chest', 'enchanting_table', 'anvil', 'smithing_table', 'brewing_stand', 'bed', 'barrel', 'composter', 'lectern', 'stonecutter', 'grindstone', 'loom', 'cartography_table', 'fletching_table'];
    const isFunctional = functionalBlocks.some(fb => blockName.includes(fb));

    try {
      await this.bot.equip(item, 'hand');

      if (isFunctional) {
        // Place functional block in front of us on the ground
        return await this.placeFunctionalBlock(blockName);
      } else {
        // Use pillaring for building blocks
        return await this.pillarPlace(blockName);
      }
    } catch (error) {
      return `Failed to place ${blockName}: ${error}`;
    } finally {
      this.humanBehavior?.notifyTaskEnd();
    }
  }

  /**
   * Place a functional block (crafting table, furnace, etc.) in front of the bot
   */
  private async placeFunctionalBlock(blockName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const pos = this.bot.entity.position;

    // Look for a suitable spot in front of us (check all 4 directions)
    const directions = [
      { yaw: this.bot.entity.yaw, dx: -Math.sin(this.bot.entity.yaw), dz: -Math.cos(this.bot.entity.yaw) },
      { yaw: this.bot.entity.yaw + Math.PI / 2, dx: -Math.sin(this.bot.entity.yaw + Math.PI / 2), dz: -Math.cos(this.bot.entity.yaw + Math.PI / 2) },
      { yaw: this.bot.entity.yaw - Math.PI / 2, dx: -Math.sin(this.bot.entity.yaw - Math.PI / 2), dz: -Math.cos(this.bot.entity.yaw - Math.PI / 2) },
      { yaw: this.bot.entity.yaw + Math.PI, dx: -Math.sin(this.bot.entity.yaw + Math.PI), dz: -Math.cos(this.bot.entity.yaw + Math.PI) },
    ];

    for (const dir of directions) {
      // Check 1 block in front
      const targetX = Math.floor(pos.x + dir.dx);
      const targetY = Math.floor(pos.y);
      const targetZ = Math.floor(pos.z + dir.dz);

      const groundBlock = this.bot.blockAt(new Vec3(targetX, targetY - 1, targetZ));
      const targetBlock = this.bot.blockAt(new Vec3(targetX, targetY, targetZ));

      // Need solid ground and air at target
      if (groundBlock && groundBlock.name !== 'air' && groundBlock.boundingBox === 'block' &&
          targetBlock && targetBlock.name === 'air') {

        // Look at the ground block with smooth transition
        await this.smoothLookAt(targetX + 0.5, targetY - 0.5, targetZ + 0.5, 150);

        // Place on top of ground block
        try {
          this.bot.swingArm('right'); // Arm swing animation
          await this.bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
          // Remember this placement for future reference
          this.rememberPlacedBlock(blockName, { x: targetX, y: targetY, z: targetZ });
          return `Placed ${blockName} at (${targetX}, ${targetY}, ${targetZ})`;
        } catch (err) {
          // Try next direction
          continue;
        }
      }
    }

    return `Could not find suitable spot to place ${blockName} - need clear ground nearby`;
  }

  /**
   * Pillar placement - for building blocks (jump + place below to climb)
   */
  private async pillarPlace(blockName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const referenceBlock = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!referenceBlock) {
      return 'No block to place on';
    }

    const startY = Math.floor(this.bot.entity.position.y);

    // Sneak for safety while placing (like real players do)
    this.bot.setControlState('sneak', true);

    // Smoothly look down to place block beneath (not instant snap)
    const currentYaw = this.bot.entity.yaw;
    const currentPitch = this.bot.entity.pitch;
    const targetPitch = Math.PI / 2; // Look straight down

    movementLogger.logLookChange('place-look-down-start', currentYaw, currentPitch);

    // Smooth transition to look down (200ms)
    const lookDownSteps = 6;
    const lookDownDuration = 200;
    for (let i = 1; i <= lookDownSteps; i++) {
      const progress = i / lookDownSteps;
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const pitch = currentPitch + (targetPitch - currentPitch) * eased;
      await this.bot.look(currentYaw, pitch, false);
      await new Promise(resolve => setTimeout(resolve, lookDownDuration / lookDownSteps));
    }

    movementLogger.logLookChange('place-look-down-end', currentYaw, targetPitch, currentYaw, currentPitch);

    // Jump and place in one motion (pillaring technique)
    this.bot.setControlState('jump', true);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Don't await placeBlock - it times out waiting for block updates
    this.bot.swingArm('right'); // Arm swing animation
    this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)).catch(() => {
      // Ignore placement errors
    });

    await new Promise(resolve => setTimeout(resolve, 400));
    this.bot.setControlState('jump', false);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Stop sneaking
    this.bot.setControlState('sneak', false);

    // Smooth pitch reset back to horizontal after placing
    const postPlaceYaw = this.bot.entity.yaw;
    const postPlacePitch = this.bot.entity.pitch;

    if (Math.abs(postPlacePitch) > 0.1) {
      movementLogger.logLookChange('place-pitch-reset-start', postPlaceYaw, postPlacePitch);

      const resetSteps = 6;
      const resetDuration = 200;
      for (let i = 1; i <= resetSteps; i++) {
        const progress = i / resetSteps;
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const pitch = postPlacePitch * (1 - eased);
        await this.bot.look(postPlaceYaw, pitch, false);
        await new Promise(resolve => setTimeout(resolve, resetDuration / resetSteps));
      }

      movementLogger.logLookChange('place-pitch-reset-end', postPlaceYaw, 0, postPlaceYaw, postPlacePitch);
    }

    const finalY = Math.floor(this.bot.entity.position.y);
    const gained = finalY - startY;

    if (gained > 0) {
      return `Placed ${blockName} and climbed up (Y: ${startY} → ${finalY})`;
    } else {
      return `Placed ${blockName} below (no climb)`;
    }
  }

  /**
   * Interact with entity or block
   */
  private async interact(target: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Try to find entity first
    const entity = Object.values(this.bot.entities).find(
      e => e.name?.toLowerCase().includes(target.toLowerCase())
    );

    if (entity) {
      // this.bot.useOn(entity);
      return `Interacted with ${target}`;
    }

    // Try to find block
    const blockType = this.mcData.blocksByName[target.toLowerCase().replace(/ /g, '_')];
    if (blockType) {
      const block = this.bot.findBlock({
        matching: blockType.id,
        maxDistance: 32,
      });

      if (block) {
        try {
          // Look at the block with smooth transition
          await this.smoothLookAt(
            block.position.x + 0.5,
            block.position.y + 0.5,
            block.position.z + 0.5,
            150
          );
          // Arm swing animation before interaction
          this.bot.swingArm('right');
          await this.bot.activateBlock(block);
          return `Interacted with ${target}`;
        } catch (error) {
          return `Found ${target} but couldn't interact: ${error}`;
        }
      }
    }

    return `Could not find ${target} to interact with`;
  }

  /**
   * Attack entity
   */
  private async attack(target: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const botPos = this.bot.entity.position;

    // Debug: Log all entities to understand what's available
    // Entity types (per prismarine-entity docs): 'player', 'mob', 'object', 'global', 'orb', 'other'
    // NOTE: There is NO 'hostile' type - hostile mobs have type='mob' with kind='Hostile mobs'
    const allEntities = Object.values(this.bot.entities);
    const nearbyEntities = allEntities.filter(e => e.position.distanceTo(botPos) < 16);
    const mobEntities = nearbyEntities.filter(e => e.type === 'mob');

    logger.info(`[ATTACK-DEBUG] Looking for "${target}"`, {
      totalEntities: allEntities.length,
      within16Blocks: nearbyEntities.length,
      mobCount: mobEntities.length,
      mobs: mobEntities.slice(0, 10).map(e => ({
        name: e.name,
        displayName: (e as any).displayName,
        type: e.type,
        kind: (e as any).kind,
        dist: e.position.distanceTo(botPos).toFixed(1)
      }))
    });

    // Find the closest matching entity within reasonable distance
    // Match by name or displayName (mobType is deprecated, use displayName instead)
    const targetLower = target.toLowerCase();
    const MAX_ATTACK_SEARCH_DIST = 32; // Don't try to attack things 32+ blocks away
    
    const entities = Object.values(this.bot.entities)
      .filter(e => {
        if (!e.position) return false;
        const dist = e.position.distanceTo(botPos);
        if (dist > MAX_ATTACK_SEARCH_DIST) return false; // Too far
        
        const nameMatch = e.name?.toLowerCase().includes(targetLower);
        const displayMatch = (e as any).displayName?.toLowerCase().includes(targetLower);
        // Blacklist non-attackable types (more permissive than whitelisting)
        const nonAttackable = ['object', 'orb', 'global', 'projectile'];
        const isAttackable = !nonAttackable.includes(e.type);
        return (nameMatch || displayMatch) && isAttackable;
      })
      .sort((a, b) => {
        const distA = a.position.distanceTo(botPos);
        const distB = b.position.distanceTo(botPos);
        return distA - distB;
      });

    if (entities.length === 0) {
      // Debug: Check if there's anything with the target name regardless of type/distance
      const anyMatch = allEntities.filter(e => {
        const nameMatch = e.name?.toLowerCase().includes(targetLower);
        const displayMatch = (e as any).displayName?.toLowerCase().includes(targetLower);
        return nameMatch || displayMatch;
      });
      if (anyMatch.length > 0) {
        // Show why they were rejected
        const nonAttackable = ['object', 'orb', 'global', 'projectile'];
        const reasons = anyMatch.slice(0, 5).map(e => {
          const dist = e.position?.distanceTo(botPos) || 999;
          const isValidType = !nonAttackable.includes(e.type);
          const issues: string[] = [];
          if (dist > MAX_ATTACK_SEARCH_DIST) issues.push(`too_far:${dist.toFixed(0)}m`);
          if (!isValidType) issues.push(`wrong_type:${e.type}`);
          return `${e.name}(type=${e.type},dist=${dist.toFixed(0)}m,issues=${issues.join('|') || 'none'})`;
        });
        logger.warn(`[ATTACK] Cannot attack "${target}": ${reasons.join(', ')}`);
      } else {
        logger.warn(`[ATTACK] No "${target}" exists. Nearby mobs: ${mobEntities.map(e => e.name).join(', ')}`);
      }
      return `No ${target} found nearby`;
    }

    const entity = entities[0];
    const distance = entity.position.distanceTo(this.bot.entity.position);
    const entityHealth = (entity as any).health || '?';

    logger.info('[ATTACK-HUMAN] Step 1: Target acquired', {
      target: entity.name || target,
      distance: distance.toFixed(1),
      health: entityHealth,
      position: `${entity.position.x.toFixed(0)}, ${entity.position.y.toFixed(0)}, ${entity.position.z.toFixed(0)}`
    });

    try {
      // EQUIP BEST WEAPON before attacking
      logger.info('[ATTACK-HUMAN] Step 2: Equipping weapon');
      const weaponResult = await this.equipBestWeapon();
      const equippedWeapon = this.bot.heldItem?.name || 'fists';
      logger.info('[ATTACK-HUMAN] Weapon ready', { weapon: equippedWeapon });

      // If too far, navigate closer first
      if (distance > 3) {
        logger.info('[ATTACK-HUMAN] Step 3: Approaching target', {
          currentDistance: distance.toFixed(1),
          targetDistance: 2
        });

        const movements = new Movements(this.bot);
        movements.allowSprinting = true; // Sprint to catch up to target
        movements.allowParkour = true;
        this.bot.pathfinder.setMovements(movements);
        
        const goal = new goals.GoalNear(
          entity.position.x,
          entity.position.y,
          entity.position.z,
          2
        );
        this.bot.pathfinder.setGoal(goal, false);

        // Wait for approach
        const startTime = Date.now();
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.bot) {
              clearInterval(checkInterval);
              resolve();
              return;
            }
            const currentDist = entity.position.distanceTo(this.bot.entity.position);
            const timedOut = Date.now() - startTime > 5000;
            
            if (currentDist < 3 || timedOut || !this.bot.pathfinder.isMoving()) {
              clearInterval(checkInterval);
              this.bot.pathfinder.setGoal(null);
              resolve();
            }
          }, 100);
        });
        
        const newDist = entity.position.distanceTo(this.bot.entity.position);
        logger.info('[ATTACK-HUMAN] Approach complete', { newDistance: newDist.toFixed(1) });
      } else {
        logger.info('[ATTACK-HUMAN] Step 3: Already in range', { distance: distance.toFixed(1) });
      }

      // Look at the entity with smooth transition (prevents jerky snap)
      logger.info('[ATTACK-HUMAN] Step 4: Looking at target');
      const entityCenter = entity.position.offset(0, entity.height * 0.5, 0);
      await this.smoothLookAt(entityCenter.x, entityCenter.y, entityCenter.z, 150);

      // Attack multiple times for effectiveness
      logger.info('[ATTACK-HUMAN] Step 5: Attacking!', { weapon: equippedWeapon });
      let hits = 0;
      for (let i = 0; i < 3; i++) {
        this.bot.swingArm('right'); // Arm swing animation
        await this.bot.attack(entity);
        hits++;
        
        logger.info(`[ATTACK-HUMAN] Hit ${hits}/3`, { 
          targetHealth: (entity as any).health?.toFixed(0) || '?'
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if entity is dead
        if (!this.bot.entities[entity.id]) {
          logger.info('[ATTACK-HUMAN] Step 6: Target eliminated!', {
            target: entity.name || target,
            hitsLanded: hits
          });
          return `Killed ${target}!`;
        }
      }
      
      const remainingHealth = (entity as any).health?.toFixed(0) || '?';
      logger.info('[ATTACK-HUMAN] Step 6: Combat round complete', {
        target: entity.name || target,
        hitsLanded: hits,
        remainingHealth
      });
      
      return `Attacked ${target} (${remainingHealth} health remaining)`;
    } catch (error) {
      logger.error('[ATTACK-HUMAN] Attack failed', { target, error });
      return `Failed to attack ${target}: ${error}`;
    }
  }

  /**
   * Craft an item - smart crafting with timeout protection and human-like animation
   */
  private async craft(itemName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Normalize common AI mistakes in item names
    const itemNameNormalized = this.normalizeItemName(itemName);
    
    const item = this.mcData.itemsByName[itemNameNormalized.toLowerCase()];
    if (!item) {
      return `Unknown item: ${itemName} (tried: ${itemNameNormalized})`;
    }

    logger.info('[CRAFT-HUMAN] Step 1: Preparing to craft', { item: itemNameNormalized });

    // Close any open windows first (fixes crafting hanging)
    if (this.bot.currentWindow) {
      logger.debug('[CRAFT-HUMAN] Closing open window before crafting');
      this.bot.closeWindow(this.bot.currentWindow);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Check for nearby crafting table - search wider radius first
    let craftingTable = this.bot.findBlock({
      matching: this.mcData.blocksByName['crafting_table']?.id,
      maxDistance: 32,  // Search wider - we'll navigate if needed
    });

    // If not found in world, check our memory for placed crafting tables
    if (!craftingTable) {
      const rememberedBlocks = this.getNearbyFunctionalBlocks();
      const rememberedTable = rememberedBlocks.find(b => b.type === 'crafting_table');
      if (rememberedTable && rememberedTable.distance < 50) {
        logger.info('[CRAFT-HUMAN] Found remembered crafting table in memory', {
          position: `${rememberedTable.position.x}, ${rememberedTable.position.y}, ${rememberedTable.position.z}`,
          distance: rememberedTable.distance.toFixed(1)
        });
        // Try to find it in the world at that position
        const blockAtPos = this.bot.blockAt(new Vec3(
          rememberedTable.position.x,
          rememberedTable.position.y,
          rememberedTable.position.z
        ));
        if (blockAtPos && blockAtPos.name === 'crafting_table') {
          craftingTable = blockAtPos;
        }
      }
    }

    // If crafting table found but far away, navigate to it first
    if (craftingTable) {
      const dist = this.bot.entity.position.distanceTo(craftingTable.position);
      if (dist > 4) {
        logger.info('[CRAFT-HUMAN] Crafting table found but far away, navigating...', {
          distance: dist.toFixed(1),
          position: `${craftingTable.position.x}, ${craftingTable.position.y}, ${craftingTable.position.z}`
        });
        
        // Navigate to the crafting table
        try {
          // Movements and goals already imported from pathfinder at top of file
          const movements = new Movements(this.bot);
          movements.canDig = false;  // Don't dig to reach crafting table
          this.bot.pathfinder.setMovements(movements);
          
          const goal = new goals.GoalNear(
            craftingTable.position.x,
            craftingTable.position.y,
            craftingTable.position.z,
            2  // Get within 2 blocks
          );
          
          await this.bot.pathfinder.goto(goal);
          logger.info('[CRAFT-HUMAN] Reached crafting table');
        } catch (navError) {
          logger.warn('[CRAFT-HUMAN] Could not navigate to crafting table', { error: navError });
          // Continue anyway - maybe we can still reach it
        }
      }
    }

    // Get current inventory count of target item
    const beforeCount = this.bot.inventory.items()
      .filter(i => i.name === itemNameNormalized)
      .reduce((sum, i) => sum + i.count, 0);

    // If crafting table available (we may have navigated to it), use it
    if (craftingTable) {
      // Recheck distance after potential navigation
      const dist = this.bot.entity.position.distanceTo(craftingTable.position);
      if (dist <= 5) {  // Slightly larger radius to account for navigation accuracy
        const recipe = this.bot.recipesFor(item.id, null, 1, craftingTable)[0];
        if (recipe) {
          logger.info('[CRAFT-HUMAN] Step 2: Using crafting table', { 
            distance: dist.toFixed(1),
            position: `${craftingTable.position.x}, ${craftingTable.position.y}, ${craftingTable.position.z}`
          });

          // Look at the crafting table with smooth transition
          logger.info('[CRAFT-HUMAN] Step 3: Looking at crafting table');
          await this.smoothLookAt(
            craftingTable.position.x + 0.5,
            craftingTable.position.y + 0.5,
            craftingTable.position.z + 0.5,
            200
          );

          // Human pause before interacting
          await new Promise(resolve => setTimeout(resolve, 100));

          logger.info('[CRAFT-HUMAN] Step 4: Opening crafting table and crafting', { 
            item: itemNameNormalized,
            recipe: (recipe.result as any)?.name || itemNameNormalized
          });
          
          try {
            const startTime = Date.now();
            await this.craftWithTimeout(recipe, 1, craftingTable, 5000);
            const elapsed = Date.now() - startTime;
            
            // Visual feedback: crafting animation
            await this.craftingAnimation();
            
            // Get new count
            const afterCount = this.bot.inventory.items()
              .filter(i => i.name === itemNameNormalized)
              .reduce((sum, i) => sum + i.count, 0);
            const gained = afterCount - beforeCount;
            
            logger.info('[CRAFT-HUMAN] Step 5: Crafting complete!', { 
              item: itemNameNormalized,
              gained: gained,
              totalNow: afterCount,
              durationMs: elapsed
            });
            
            // Emit craft callback for UI notification
            if (this.onItemCraftCallback && gained > 0) {
              const displayName = itemNameNormalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              this.onItemCraftCallback(itemNameNormalized, displayName, gained);
            }
            
            // Notify UI of inventory change
            this.notifyStateChange();
            
            return `Crafted ${itemNameNormalized} (now have ${afterCount})`;
          } catch (error: any) {
            logger.error('[CRAFT-HUMAN] Workbench craft failed', { error: error.message, item: itemNameNormalized });
            return `Failed to craft ${itemNameNormalized}: ${error.message}`;
          }
        }
      }
    }

    // Try 2x2 inventory crafting (works for planks, sticks, etc.)
    const recipe = this.bot.recipesFor(item.id, null, 1, null)[0];
    if (recipe) {
      logger.info('[CRAFT-HUMAN] Step 2: Using inventory crafting (2x2)', { 
        item: itemNameNormalized,
        recipe: (recipe.result as any)?.name || itemNameNormalized
      });
      
      // Human-like: look down at hands while crafting
      logger.info('[CRAFT-HUMAN] Step 3: Looking down at inventory');
      const currentYaw = this.bot.entity.yaw;
      await this.bot.look(currentYaw, 0.8, false); // Look down at hands
      await new Promise(resolve => setTimeout(resolve, 150));
      
      try {
        const startTime = Date.now();
        logger.info('[CRAFT-HUMAN] Step 4: Crafting item');
        await this.craftWithTimeout(recipe, 1, null, 5000);
        const elapsed = Date.now() - startTime;
        
        // Visual feedback: crafting animation
        await this.craftingAnimation();
        
        // Look back to normal
        await this.bot.look(currentYaw, 0, false);
        
        // Get new count
        const afterCount = this.bot.inventory.items()
          .filter(i => i.name === itemNameNormalized)
          .reduce((sum, i) => sum + i.count, 0);
        const gained = afterCount - beforeCount;
        
        logger.info('[CRAFT-HUMAN] Step 5: Crafting complete!', { 
          item: itemNameNormalized,
          gained: gained,
          totalNow: afterCount,
          durationMs: elapsed
        });
        
        // Emit craft callback for UI notification
        if (this.onItemCraftCallback && gained > 0) {
          const displayName = itemNameNormalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          this.onItemCraftCallback(itemNameNormalized, displayName, gained);
        }
        
        // Notify UI of inventory change
        this.notifyStateChange();
        
        return `Crafted ${itemNameNormalized} (now have ${afterCount})`;
      } catch (error: any) {
        logger.error('[CRAFT-HUMAN] Inventory craft failed', { error: error.message, item: itemNameNormalized });
        // If inventory craft fails, maybe we need a crafting table
        return `Failed to craft ${itemNameNormalized}: ${error.message}. Try near a crafting table.`;
      }
    }

    logger.warn('[CRAFT-HUMAN] No recipe available', { 
      item: itemNameNormalized,
      reason: 'Missing materials or need crafting table'
    });
    return `No recipe for ${itemNameNormalized} (missing materials or need crafting table)`;
  }

  /**
   * Human-like crafting animation - arm swings and brief pause
   */
  private async craftingAnimation(): Promise<void> {
    if (!this.bot) return;
    
    // Multiple arm swings like placing items in crafting grid
    for (let i = 0; i < 3; i++) {
      this.bot.swingArm('right');
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    
    // Brief pause as if picking up crafted item
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Final arm swing to pick up result
    this.bot.swingArm('right');
  }

  /**
   * Craft with timeout protection to prevent hanging
   */
  private async craftWithTimeout(
    recipe: any,
    count: number,
    craftingTable: any,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const timeout = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        logger.error(`[CRAFT] Timeout after ${elapsed}ms`, {
          recipeResult: recipe?.result?.name,
          hasCraftingTable: !!craftingTable,
          timeoutMs
        });
        reject(new Error('Craft operation timed out'));
      }, timeoutMs);

      logger.debug(`[CRAFT] Starting bot.craft()`, {
        recipeResult: recipe?.result?.name,
        hasCraftingTable: !!craftingTable
      });

      const craftPromise = craftingTable
        ? this.bot!.craft(recipe, count, craftingTable)
        : this.bot!.craft(recipe, count);

      craftPromise
        .then(() => {
          clearTimeout(timeout);
          const elapsed = Date.now() - startTime;
          logger.info(`[CRAFT] Success in ${elapsed}ms`, { recipeResult: recipe?.result?.name });
          resolve();
        })
        .catch((err) => {
          clearTimeout(timeout);
          const elapsed = Date.now() - startTime;
          logger.error(`[CRAFT] Error after ${elapsed}ms: ${err.message}`);
          reject(err);
        });
    });
  }

  /**
   * Dig a block with visible arm swing animation
   * Mineflayer's dig() doesn't always show animation to viewers
   */
  private async digWithAnimation(block: any): Promise<void> {
    if (!this.bot) return;

    // Start swinging arm periodically while digging
    let swingInterval: NodeJS.Timeout | null = null;

    try {
      // Swing arm every 250ms during mining (mimics real player mining animation)
      swingInterval = setInterval(() => {
        if (this.bot && this.bot.entity) {
          this.bot.swingArm('right');
        }
      }, 250);

      // Initial swing
      this.bot.swingArm('right');

      // Perform the actual dig
      await this.bot.dig(block);
    } finally {
      // Stop swinging when done
      if (swingInterval) {
        clearInterval(swingInterval);
      }
    }
  }

  /**
   * Smoothly look towards a target position over time
   * Creates human-like head movement instead of instant snapping
   * Duration now scales based on angle change for consistent angular velocity
   */
  private async smoothLookAt(x: number, y: number, z: number, baseDurationMs: number = 400): Promise<void> {
    if (!this.bot) return;

    const botPos = this.bot.entity.position;
    const targetVec = new Vec3(x, y, z);

    // Calculate target yaw and pitch
    const dx = targetVec.x - botPos.x;
    const dy = targetVec.y - (botPos.y + 1.62); // Eye height
    const dz = targetVec.z - botPos.z;

    // CRITICAL: Formula must be Math.atan2(-dx, -dz) to match Minecraft convention
    const targetYaw = Math.atan2(-dx, -dz);
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const targetPitch = Math.atan2(-dy, horizontalDist);

    // Get current angles
    const startYaw = this.bot.entity.yaw;
    const startPitch = this.bot.entity.pitch;

    // Calculate angle differences
    let yawDiff = targetYaw - startYaw;
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
    const pitchDiff = targetPitch - startPitch;

    // Calculate total angular distance
    const totalAngle = Math.sqrt(yawDiff * yawDiff + pitchDiff * pitchDiff);
    const totalAngleDegrees = totalAngle * 180 / Math.PI;

    // Scale duration based on angle: ~15ms per degree, with min 200ms and max 1200ms
    // This ensures large turns take longer for smooth motion
    const scaledDuration = Math.max(200, Math.min(1200, totalAngleDegrees * 15));
    const durationMs = Math.max(baseDurationMs, scaledDuration);

    // Log look change
    movementLogger.logLookChange('smoothLookAt-start', startYaw, startPitch);

    // Smooth interpolation at 60fps (16ms per frame) for buttery smooth motion
    const steps = Math.max(12, Math.floor(durationMs / 16));
    const stepDuration = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      if (!this.bot) return;

      const progress = i / steps;
      // Ease-in-out for natural acceleration and deceleration
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const currentYaw = startYaw + yawDiff * eased;
      const currentPitch = startPitch + pitchDiff * eased;

      await this.bot.look(currentYaw, currentPitch, false);
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }

    // Log final look direction
    movementLogger.logLookChange('smoothLookAt-end', targetYaw, targetPitch, startYaw, startPitch);
  }

  /**
   * Speak in chat
   */
  private speak(message: string): string {
    if (!this.bot) return 'Bot not initialized';

    this.bot.chat(message);
    logger.info('Bot spoke', { message });
    return `Said: "${message}"`;
  }

  /**
   * Analyze current situation
   */
  private async analyze(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Look around to get visual context
    const visualContext = await this.lookAround();

    const state = this.getState().metadata as unknown as MinecraftState;

    const parts = [
      `Position: (${state.position.x}, ${state.position.y}, ${state.position.z})`,
      `Health: ${state.health}/20`,
      `Food: ${state.food}/20`,
      `Time: ${state.time}`,
      `Weather: ${state.weather}`,
      `Nearby blocks: ${state.nearbyBlocks.slice(0, 5).join(', ')}`,
      `Nearby entities: ${state.nearbyEntities.slice(0, 5).join(', ') || 'none'}`,
      `Inventory: ${state.inventory.length} items`,
      `Visuals: ${visualContext}`
    ];

    return parts.join('\n');
  }

  /**
   * Look around 360 degrees and identify visible blocks
   */
  private async lookAround(): Promise<string> {
    if (!this.bot) return 'Cannot look around';

    const visibleBlocks = new Set<string>();
    const originalYaw = this.bot.entity.yaw;
    const originalPitch = this.bot.entity.pitch;

    logger.debug('[LOOK-AROUND] Scanning 360 degrees', {
      startYaw: originalYaw.toFixed(2),
      startPitch: originalPitch.toFixed(2)
    });

    // Scan 8 directions
    for (let i = 0; i < 8; i++) {
      const yaw = originalYaw + (i * (Math.PI / 4));
      await this.bot.look(yaw, 0, true);
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for look

      // Raycast to see what's in front
      const block = this.bot.blockAtCursor(10);
      if (block && block.name !== 'air') {
        visibleBlocks.add(block.name);
        logger.debug(`[LOOK-AROUND] Direction ${i}: ${block.name} at distance ${this.bot.entity.position.distanceTo(block.position).toFixed(1)}`);
      }
    }

    // Reset view
    await this.bot.look(originalYaw, originalPitch, true);

    logger.debug('[LOOK-AROUND] Scan complete', {
      blocksFound: visibleBlocks.size,
      blocks: Array.from(visibleBlocks).join(', ')
    });

    if (visibleBlocks.size === 0) return 'Nothing visible nearby';
    return `I can see: ${Array.from(visibleBlocks).join(', ')}`;
  }

  /**
   * Periodically scan environment - called during idle/wait times
   * Smooth, subtle head movement with easing
   */
  private async casualLookAround(): Promise<void> {
    if (!this.bot) return;

    const currentYaw = this.bot.entity.yaw;
    const currentPitch = this.bot.entity.pitch;

    logger.debug('[CASUAL-LOOK] Starting', {
      startYaw: currentYaw.toFixed(2),
      startPitch: currentPitch.toFixed(2)
    });

    // VERY subtle look left (10 degrees only)
    const leftYaw = this.normalizeAngle(currentYaw - Math.PI / 18); // 10 degrees left
    await this.bot.look(leftYaw, currentPitch, false); // Non-blocking, keep pitch
    await new Promise(resolve => setTimeout(resolve, 150));

    // VERY subtle look right (10 degrees)
    const rightYaw = this.normalizeAngle(currentYaw + Math.PI / 18); // 10 degrees right
    await this.bot.look(rightYaw, currentPitch, false);
    await new Promise(resolve => setTimeout(resolve, 150));

    // Back to original position
    await this.bot.look(currentYaw, currentPitch, false); // Back to center

    logger.debug('[CASUAL-LOOK] Complete', {
      endYaw: this.bot.entity.yaw.toFixed(2),
      drift: (this.bot.entity.yaw - currentYaw).toFixed(3)
    });
  }

  /**
   * SMOOTH look around with easing animation (butter smooth camera)
   * Rotates slowly at 60fps for cinematic effect
   */
  private async smoothLookAround(
    degrees: number = 360,
    durationMs: number = 5000
  ): Promise<Map<string, Set<string>>> {
    if (!this.bot) return new Map();

    const startYaw = this.bot.entity.yaw;
    const startPitch = this.bot.entity.pitch;
    const totalRadians = (degrees * Math.PI) / 180;

    // 60fps = 16ms per frame for buttery smooth motion
    const steps = Math.floor(durationMs / 16);
    const stepDelay = 16;
    const blocksFound = new Map<string, Set<string>>(); // direction -> block names

    // Sample every ~30 degrees
    const sampleInterval = Math.max(1, Math.floor(steps / (degrees / 30)));

    logger.info('[SMOOTH-LOOK] Starting smooth camera sweep', {
      degrees,
      duration: `${durationMs}ms`,
      steps,
      fps: 60
    });

    for (let i = 0; i <= steps; i++) {
      // Easing function: ease-in-out for smooth acceleration/deceleration
      const t = i / steps;
      const easedT = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const currentYaw = startYaw + (totalRadians * easedT);

      // Smooth look to current position
      await this.bot.look(currentYaw, startPitch, false);

      // Sample environment at intervals
      if (i % sampleInterval === 0) {
        const direction = Math.round((easedT * degrees)) + '°';
        const block = this.bot.blockAtCursor(10);
        if (block && block.name !== 'air') {
          if (!blocksFound.has(direction)) {
            blocksFound.set(direction, new Set());
          }
          blocksFound.get(direction)!.add(block.name);
          logger.debug(`[SMOOTH-LOOK] ${direction}: ${block.name}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, stepDelay));
    }

    // Return to original position smoothly over 500ms
    const returnSteps = Math.floor(500 / 16);
    for (let i = 1; i <= returnSteps; i++) {
      const t = i / returnSteps;
      const easedT = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const returnYaw = this.bot.entity.yaw + (startYaw - this.bot.entity.yaw) * easedT;
      await this.bot.look(returnYaw, startPitch, false);
      await new Promise(resolve => setTimeout(resolve, 16));
    }

    logger.info('[SMOOTH-LOOK] Complete', {
      uniqueBlockTypes: Array.from(blocksFound.values()).reduce((acc, set) => acc + set.size, 0)
    });

    return blocksFound;
  }

  /**
   * Enter batch mode - suppresses idle behavior between batch operations.
   * Called by index.ts when a batch mining/placing operation starts.
   * @param durationMs Duration to stay in batch mode (default 25s to cover decision cycles)
   */
  public enterBatchMode(durationMs?: number): void {
    this.humanBehavior?.enterBatchMode(durationMs);
  }

  /**
   * Exit batch mode - allows idle behavior to resume.
   */
  public exitBatchMode(): void {
    this.humanBehavior?.exitBatchMode();
  }

  /**
   * Vision-based 360 look around for situational awareness
   * Returns detailed analysis of surroundings for decision-making
   * Called proactively for human-like curiosity, and when stuck
   */
  public async visionAnalysisLookAround(): Promise<{
    blocksVisible: Map<string, number>;
    canSeeSky: boolean;
    pathsAvailable: { direction: string; yaw: number; clear: boolean; distance: number }[];
    recommendation: string;
  }> {
    if (!this.bot) {
      return {
        blocksVisible: new Map(),
        canSeeSky: false,
        pathsAvailable: [],
        recommendation: 'Bot not initialized'
      };
    }

    logger.info('[VISION-ANALYSIS] Starting slow 360° analysis with vision');

    const originalYaw = this.bot.entity.yaw;
    const originalPitch = this.bot.entity.pitch;
    const blocksVisible = new Map<string, number>();
    const pathsAvailable: { direction: string; yaw: number; clear: boolean; distance: number }[] = [];

    // Check 16 directions (every 22.5 degrees) SLOWLY
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    for (let i = 0; i < 16; i++) {
      const yaw = (i * (Math.PI / 8)); // 22.5 degrees each
      const direction = directions[i];

      // SLOW turn - 300ms per direction for smooth movement
      await this.bot.look(yaw, 0, true);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check multiple distances
      let clearPath = true;
      let maxClearDistance = 0;
      let hasWaterInPath = false;
      let hasLavaInPath = false;

      for (let dist = 1; dist <= 10; dist++) {
        const block = this.bot.blockAtCursor(dist);
        if (block) {
          // Count block types
          const count = blocksVisible.get(block.name) || 0;
          blocksVisible.set(block.name, count + 1);

          // Check for water/lava hazards
          if (block.name === 'water' || block.name === 'flowing_water') {
            hasWaterInPath = true;
          }
          if (block.name === 'lava' || block.name === 'flowing_lava') {
            hasLavaInPath = true;
            clearPath = false; // Lava is NEVER clear
            maxClearDistance = dist - 1;
            break;
          }

          if (block.name !== 'air' && block.name !== 'water') {
            clearPath = false;
            maxClearDistance = dist - 1;
            logger.debug(`[VISION-${direction}] Blocked at ${dist}m by ${block.name}`);
            break;
          } else {
            maxClearDistance = dist;
          }
        }
      }

      pathsAvailable.push({
        direction,
        yaw,
        clear: clearPath && !hasWaterInPath, // Water paths are not "clear" for safe navigation
        distance: maxClearDistance,
        hasWater: hasWaterInPath,
        hasLava: hasLavaInPath
      } as any);

      logger.debug(`[VISION-${direction}] ${clearPath ? '✓ CLEAR' : '✗ BLOCKED'} (${maxClearDistance}m)`);
    }

    // Check upward for sky
    await this.bot.look(originalYaw, -Math.PI / 2, true); // Look straight up
    await new Promise(resolve => setTimeout(resolve, 300));

    let canSeeSky = false;
    for (let dist = 1; dist <= 20; dist++) {
      const blockAbove = this.bot.blockAtCursor(dist);
      if (!blockAbove || blockAbove.name === 'air') {
        canSeeSky = true;
      } else {
        canSeeSky = false;
        logger.debug(`[VISION-UP] Sky blocked at ${dist}m by ${blockAbove.name}`);
        break;
      }
    }

    // Reset view
    await this.bot.look(originalYaw, originalPitch, true);

    // Generate observation summary (factual, non-prescriptive)
    const safePaths = pathsAvailable.filter(p => p.clear && !(p as any).hasWater && !(p as any).hasLava);
    const waterPaths = pathsAvailable.filter(p => (p as any).hasWater && !(p as any).hasLava);
    const lavaPaths = pathsAvailable.filter(p => (p as any).hasLava);
    const yLevel = this.bot.entity.position.y;

    // Simple factual summary - let LLM decide what to do
    const summaryParts: string[] = [];
    if (safePaths.length > 0) {
      summaryParts.push(`clear: ${safePaths.map(p => `${p.direction}(${p.distance}m)`).join(', ')}`);
    }
    if (waterPaths.length > 0) {
      summaryParts.push(`water: ${waterPaths.map(p => p.direction).join(', ')}`);
    }
    if (lavaPaths.length > 0) {
      summaryParts.push(`lava: ${lavaPaths.map(p => p.direction).join(', ')}`);
    }
    summaryParts.push(`sky: ${canSeeSky ? 'visible' : 'not visible'}`);
    summaryParts.push(`Y: ${yLevel.toFixed(0)}`);

    const recommendation = summaryParts.join(' | ');

    logger.info('[VISION-ANALYSIS] Complete', {
      blocksFound: blocksVisible.size,
      safePaths: safePaths.length,
      waterPaths: waterPaths.length,
      lavaPaths: lavaPaths.length,
      canSeeSky,
      recommendation
    });

    return { blocksVisible, canSeeSky, pathsAvailable, recommendation };
  }

  /**
   * Smart stuck recovery using vision and brain decision-making
   * PUBLIC: Called by main decision loop when consecutive failures detected
   */
  public async intelligentStuckRecovery(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    logger.warn('[STUCK-RECOVERY] Bot appears stuck - analyzing situation with vision');

    // Update position history
    this.positionHistory.push(this.bot.entity.position.clone());
    if (this.positionHistory.length > 10) {
      this.positionHistory.shift();
    }

    // Analyze stuck situation using brain
    const stuckAnalysis = analyzeStuckSituation(this.bot, this.positionHistory);

    if (!stuckAnalysis.isStuck) {
      return 'Not actually stuck';
    }

    logger.warn('[STUCK-RECOVERY] Stuck type:', { type: stuckAnalysis.stuckType });

    // Do vision analysis
    const vision = await this.visionAnalysisLookAround();

    // Get current game state for brain
    const gameState = getCurrentGameState(this.bot);

    // Make intelligent decision
    const decision = stuckAnalysis.recommendedAction || makeDecision(gameState);

    logger.info('[STUCK-RECOVERY] Decision:', {
      action: decision.action,
      priority: decision.priority,
      reason: decision.reason,
      visionRecommendation: vision.recommendation
    });

    // Execute decision
    switch (decision.action) {
      case 'dig_up_escape':
        return await this.digUpToSurface();

      case 'look_around':
        // Already did vision analysis
        return `Looked around: ${vision.recommendation}`;

      case 'dig':
        // Dig through obstacle ahead
        const blockAhead = this.bot.blockAtCursor(3);
        if (blockAhead && blockAhead.name !== 'air') {
          return await this.mine(blockAhead.name);
        }
        return 'No block to dig';

      case 'flee':
        // Emergency - back away
        const backYaw = this.normalizeAngle(this.bot.entity.yaw + Math.PI);
        this.bot.setControlState('forward', true);
        await this.bot.look(backYaw, 0, true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.bot.clearControlStates();
        return 'Backed away from danger';

      default:
        return `Decision: ${decision.reason}`;
    }
  }

  /**
   * ==========================================================================
   * VISION-BASED STUCK RECOVERY - AI Screenshot Analysis
   * ==========================================================================
   * 
   * Captures 4 directional screenshots from prismarine-viewer and sends them
   * to the vision AI for detailed analysis and escape recommendations.
   * 
   * Rate limited to prevent excessive API calls (min 30 seconds between calls).
   * Used only when truly stuck and normal recovery fails.
   */
  public async captureAndAnalyzeWithVision(): Promise<{
    success: boolean;
    analysis: string;
    recommendation: string;
    directions: { dir: string; screenshot?: string; description: string }[];
  }> {
    if (!this.bot) {
      return {
        success: false,
        analysis: 'Bot not initialized',
        recommendation: 'Wait for bot to connect',
        directions: []
      };
    }

    // Rate limiting - max once every 30 seconds
    const now = Date.now();
    if (now - this.lastVisionAnalysis < 30000) {
      const waitTime = Math.ceil((30000 - (now - this.lastVisionAnalysis)) / 1000);
      logger.info(`[VISION-CAPTURE] Rate limited, please wait ${waitTime}s`);
      return {
        success: false,
        analysis: `Rate limited - wait ${waitTime}s`,
        recommendation: 'Try text-based analysis instead',
        directions: []
      };
    }
    this.lastVisionAnalysis = now;

    logger.info('[VISION-CAPTURE] Starting 4-direction screenshot analysis');

    // Create screenshots directory if needed
    const screenshotDir = path.join(process.cwd(), 'data', 'vision-screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      logger.info(`[VISION-CAPTURE] Created screenshot directory: ${screenshotDir}`);
    }
    const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const directions = [
      { name: 'NORTH', yaw: Math.PI },       // -Z direction
      { name: 'EAST', yaw: -Math.PI / 2 },   // +X direction
      { name: 'SOUTH', yaw: 0 },             // +Z direction
      { name: 'WEST', yaw: Math.PI / 2 },    // -X direction
    ];

    const results: { dir: string; screenshot?: string; description: string }[] = [];
    const originalYaw = this.bot.entity.yaw;
    const originalPitch = this.bot.entity.pitch;

    try {
      // Initialize browser if needed
      if (!this.visionBrowser) {
        logger.info('[VISION-CAPTURE] Launching headless browser...');
        this.visionBrowser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      if (!this.visionPage) {
        this.visionPage = await this.visionBrowser.newPage();
        await this.visionPage.setViewport({ width: 800, height: 600 });
      }

      // Navigate to prismarine viewer
      await this.visionPage.goto('http://localhost:3007', { 
        waitUntil: 'networkidle0',
        timeout: 5000 
      });

      // Wait for viewer to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Capture 4 directions
      for (const dir of directions) {
        // Turn bot to face direction
        await this.bot.look(dir.yaw, 0, true);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for render

        // Capture screenshot
        const screenshot = await this.visionPage.screenshot({ 
          encoding: 'base64',
          type: 'jpeg',
          quality: 70
        });

        // Save screenshot to file for viewing
        const screenshotPath = path.join(screenshotDir, `${sessionTimestamp}_${dir.name}.jpg`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot as string, 'base64'));
        logger.info(`[VISION-CAPTURE] Saved: ${screenshotPath}`);

        // Get block-based description for this direction
        const blocks: string[] = [];
        for (let dist = 1; dist <= 8; dist++) {
          const block = this.bot.blockAtCursor(dist);
          if (block && block.name !== 'air') {
            blocks.push(`${dist}m: ${block.name}`);
            break;
          }
        }

        results.push({
          dir: dir.name,
          screenshot: `data:image/jpeg;base64,${screenshot}`,
          description: blocks.length > 0 ? blocks.join(', ') : 'Clear path (8+ blocks)'
        });

        logger.debug(`[VISION-CAPTURE] Captured ${dir.name}: ${blocks.length > 0 ? blocks[0] : 'clear'}`);
      }

      // Return to original orientation
      await this.bot.look(originalYaw, originalPitch, true);

      // Build analysis prompt
      const blockDescriptions = results.map(r => `${r.dir}: ${r.description}`).join('\n');
      
      // Get current game state for context
      const pos = this.bot.entity.position;
      const health = Math.floor(this.bot.health);
      const food = Math.floor(this.bot.food);
      const inventory = this.bot.inventory.items().map(i => `${i.name}:${i.count}`).join(', ');

      const analysisPrompt = `
You are a Minecraft AI bot that is STUCK and needs help escaping.

Current state:
- Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})
- Health: ${health}/20
- Food: ${food}/20
- Inventory: ${inventory || 'empty'}

What I see in each direction (from ray-casting):
${blockDescriptions}

I'm sending you 4 screenshots (North, East, South, West views).

ANALYZE the screenshots and tell me:
1. What's blocking me in each direction?
2. Is there a clear escape path?
3. What specific action should I take to get unstuck?

Be specific: Should I mine (what block?), move (which direction?), jump, dig up, etc.

Reply with a JSON object: {"analysis": "what you see", "action": "mine/move/jump/dig_up", "target": "direction or block", "reason": "why"}
`;

      // Send screenshots to Vision AI for real analysis
      logger.info('[VISION-CAPTURE] Sending 4 screenshots to Vision AI...');
      
      let aiAnalysis: string;
      let aiRecommendation: string;
      
      try {
        const visionImages = results
          .filter(r => r.screenshot)
          .map(r => ({
            label: r.dir,
            dataUrl: r.screenshot!
          }));

        const visionResult = await openRouterClient.analyzeMultipleImages(
          visionImages,
          analysisPrompt,
          800 // Shorter response for stuck recovery
        );

        aiAnalysis = visionResult.description;
        
        // Try to parse JSON response for structured recommendation
        try {
          const jsonMatch = aiAnalysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            aiRecommendation = `${parsed.action} ${parsed.target}: ${parsed.reason}`;
          } else {
            aiRecommendation = aiAnalysis.slice(0, 200); // Fallback to first 200 chars
          }
        } catch {
          aiRecommendation = aiAnalysis.slice(0, 200);
        }

        logger.info('[VISION-AI] Analysis received', {
          recommendation: aiRecommendation.slice(0, 100)
        });

      } catch (visionError) {
        // Fallback to text-based analysis if vision fails
        logger.warn('[VISION-AI] API failed, using text-based fallback', { error: visionError });
        aiRecommendation = this.generateEscapeRecommendation(results);
        aiAnalysis = `Vision API unavailable. Text analysis: ${blockDescriptions}`;
      }

      logger.info('[VISION-CAPTURE] Analysis complete', {
        directions: results.map(r => `${r.dir}: ${r.description}`),
        aiRecommendation: aiRecommendation.slice(0, 100)
      });

      // Save analysis summary to file
      const summaryPath = path.join(screenshotDir, `${sessionTimestamp}_ANALYSIS.txt`);
      const summaryContent = `Vision Stuck Recovery Analysis
=============================
Time: ${new Date().toISOString()}
Position: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})
Health: ${health}/20 | Food: ${food}/20
Inventory: ${inventory || 'empty'}

DIRECTIONS:
${results.map(r => `  ${r.dir}: ${r.description}`).join('\n')}

AI RECOMMENDATION:
${aiRecommendation}

FULL AI ANALYSIS:
${aiAnalysis}
`;
      fs.writeFileSync(summaryPath, summaryContent);
      logger.info(`[VISION-CAPTURE] Saved analysis: ${summaryPath}`);

      return {
        success: true,
        analysis: aiAnalysis,
        recommendation: aiRecommendation,
        directions: results
      };

    } catch (error) {
      logger.error('[VISION-CAPTURE] Failed', { error });
      
      // Clean up on error
      if (this.visionPage) {
        await this.visionPage.close().catch(() => {});
        this.visionPage = null;
      }
      if (this.visionBrowser) {
        await this.visionBrowser.close().catch(() => {});
        this.visionBrowser = null;
      }

      // Return to original orientation
      await this.bot.look(originalYaw, originalPitch, true).catch(() => {});

      return {
        success: false,
        analysis: `Vision capture failed: ${error}`,
        recommendation: 'Use text-based stuck recovery instead',
        directions: []
      };
    }
  }

  /**
   * Generate escape recommendation based on direction analysis
   */
  private generateEscapeRecommendation(
    results: { dir: string; description: string }[]
  ): string {
    // Find the clearest path
    const clearPaths = results.filter(r => r.description.includes('Clear path'));
    if (clearPaths.length > 0) {
      return `Move ${clearPaths[0].dir.toLowerCase()} - path is clear for 8+ blocks`;
    }

    // Find shortest distance to obstacle (implies most space before it)
    let bestDir = results[0];
    let bestDistance = 0;
    
    for (const r of results) {
      const match = r.description.match(/(\d+)m:/);
      if (match) {
        const dist = parseInt(match[1]);
        if (dist > bestDistance) {
          bestDistance = dist;
          bestDir = r;
        }
      }
    }

    if (bestDistance >= 4) {
      return `Move ${bestDir.dir.toLowerCase()} - most open space (${bestDistance}m before obstacle)`;
    }

    // Check for breakable blocks
    const breakableBlocks = ['leaves', 'grass', 'fern', 'vine', 'dead_bush'];
    for (const r of results) {
      if (breakableBlocks.some(b => r.description.toLowerCase().includes(b))) {
        return `Mine through ${r.dir.toLowerCase()} - vegetation blocking (${r.description})`;
      }
    }

    // Worst case - dig up
    if (bestDistance <= 2) {
      return 'Dig up - surrounded on all sides, need to escape vertically';
    }

    return `Move ${bestDir.dir.toLowerCase()} - best available path`;
  }

  /**
   * Dig straight up to escape underground
   * Uses proper staircase technique (45 degree angle)
   * PUBLIC: Called by main decision loop when bot is stuck underground
   */
  public async digUpToSurface(): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const startY = this.bot.entity.position.y;
    logger.info(`[DIG-UP] Starting escape from Y=${startY.toFixed(0)} to surface`);

    if (startY >= 60) {
      return 'Already near surface';
    }

    const targetY = 70; // Safe surface level
    const digDirection = calculateEscapeDigDirection(this.bot.entity.position, targetY);

    logger.info('[DIG-UP] Digging staircase up', {
      angle: '45 degrees',
      currentY: startY.toFixed(0),
      targetY,
      reason: digDirection.reason
    });

    // Look at 45-degree angle up
    await this.bot.look(digDirection.yaw, digDirection.pitch, true);

    let digCount = 0;
    const maxDigs = 50; // Safety limit

    while (this.bot.entity.position.y < targetY && digCount < maxDigs) {
      // Check block ahead and above
      const blockAhead = this.bot.blockAtCursor(3);

      if (blockAhead && blockAhead.name !== 'air') {
        // Check if we should dig this block
        const currentTool = this.bot.heldItem?.name || null;
        const digDecision = shouldDigBlock(blockAhead.name, currentTool);

        if (!digDecision.shouldDig) {
          logger.warn('[DIG-UP] Cannot dig block', {
            block: blockAhead.name,
            reason: digDecision.reason,
            recommendedTool: digDecision.recommendedTool
          });

          if (blockAhead.name === 'bedrock') {
            return 'Hit bedrock - cannot dig further (you are at bottom of world)';
          }

          // Try to get correct tool
          if (digDecision.recommendedTool) {
            return `Need ${digDecision.recommendedTool} to dig ${blockAhead.name}`;
          }
        }

        logger.info(`[DIG-UP] Digging ${blockAhead.name} (${digCount + 1}/${maxDigs})`);
        await this.digWithAnimation(blockAhead);
        digCount++;

        // Move forward into the space
        this.bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 500));
        this.bot.clearControlStates();

        const currentY = this.bot.entity.position.y;
        logger.debug(`[DIG-UP] Progress: Y=${currentY.toFixed(1)} (${((currentY - startY) / (targetY - startY) * 100).toFixed(0)}%)`);
      } else {
        // Clear ahead, just move forward and up
        this.bot.setControlState('forward', true);
        this.bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 300));
        this.bot.clearControlStates();
      }

      // Maintain upward angle
      await this.bot.look(digDirection.yaw, digDirection.pitch, true);
    }

    this.bot.clearControlStates();

    const finalY = this.bot.entity.position.y;
    const climbedDistance = finalY - startY;

    if (finalY >= 60) {
      logger.info('[DIG-UP] ✓ SUCCESS - Reached surface', {
        startY: startY.toFixed(0),
        finalY: finalY.toFixed(0),
        climbed: climbedDistance.toFixed(0),
        blocksDigged: digCount
      });
      return `Escaped to surface! Climbed ${climbedDistance.toFixed(0)} blocks (digged ${digCount} blocks)`;
    } else {
      logger.warn('[DIG-UP] Incomplete escape', {
        startY: startY.toFixed(0),
        finalY: finalY.toFixed(0),
        climbed: climbedDistance.toFixed(0),
        blocksDigged: digCount
      });
      return `Partially escaped - climbed ${climbedDistance.toFixed(0)} blocks but still underground at Y=${finalY.toFixed(0)}`;
    }
  }

  /**
   * Smart tool selection - equips best tool for mining a specific block
   * Uses the brain's shouldDigBlock logic to determine efficiency
   */
  private async equipBestToolForBlock(blockName: string): Promise<{
    equipped: boolean;
    toolName: string | null;
    reason: string;
    warning?: string;
  }> {
    if (!this.bot) {
      return { equipped: false, toolName: null, reason: 'Bot not initialized' };
    }

    const inventory = this.bot.inventory.items();

    // Tool priority rankings for different block types (all material tiers, best to worst)
    const toolPriorities = {
      // Stone/ores need pickaxe
      stone: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      cobblestone: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],
      ore: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'],

      // Wood needs axe
      log: ['netherite_axe', 'diamond_axe', 'iron_axe', 'golden_axe', 'stone_axe', 'wooden_axe'],
      wood: ['netherite_axe', 'diamond_axe', 'iron_axe', 'golden_axe', 'stone_axe', 'wooden_axe'],
      planks: ['netherite_axe', 'diamond_axe', 'iron_axe', 'golden_axe', 'stone_axe', 'wooden_axe'],

      // Dirt/sand/gravel need shovel
      dirt: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'golden_shovel', 'stone_shovel', 'wooden_shovel'],
      grass_block: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'golden_shovel', 'stone_shovel', 'wooden_shovel'],
      sand: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'golden_shovel', 'stone_shovel', 'wooden_shovel'],
      gravel: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'golden_shovel', 'stone_shovel', 'wooden_shovel'],
    };

    // Determine block category
    let toolCategory: string[] | null = null;
    const blockLower = blockName.toLowerCase();

    if (blockLower.includes('ore') || blockLower.includes('stone') || blockLower.includes('cobblestone')) {
      toolCategory = toolPriorities.stone;
    } else if (blockLower.includes('log') || blockLower.includes('wood') || blockLower.includes('plank')) {
      toolCategory = toolPriorities.log;
    } else if (blockLower.includes('dirt') || blockLower.includes('grass') || blockLower.includes('sand') || blockLower.includes('gravel')) {
      toolCategory = toolPriorities.dirt;
    }

    // Find best available tool in inventory
    if (toolCategory) {
      // First pass: look for exact matches from priority list
      for (const toolName of toolCategory) {
        const tool = inventory.find(item => item.name === toolName);
        if (tool) {
          // Check if already equipped
          if (this.bot.heldItem?.name === toolName) {
            return {
              equipped: true,
              toolName,
              reason: 'Already equipped'
            };
          }

          // Equip the tool
          try {
            await this.bot.equip(tool, 'hand');
            return {
              equipped: true,
              toolName,
              reason: 'Equipped optimal tool'
            };
          } catch (error) {
            logger.error('[TOOL-SELECT] Failed to equip tool', { toolName, error });
          }
        }
      }

      // Second pass: fallback - look for ANY tool of the right type
      // This catches tool variants not in the priority list
      const toolType = toolCategory[0]?.split('_').pop() || ''; // 'axe', 'pickaxe', 'shovel'
      if (toolType) {
        const anyTool = inventory.find(item => item.name.endsWith(`_${toolType}`));
        if (anyTool) {
          // Check if already equipped
          if (this.bot.heldItem?.name === anyTool.name) {
            return {
              equipped: true,
              toolName: anyTool.name,
              reason: 'Already equipped (fallback)'
            };
          }

          try {
            await this.bot.equip(anyTool, 'hand');
            logger.info('[TOOL-SELECT] Equipped tool via fallback search', { 
              tool: anyTool.name, 
              toolType 
            });
            return {
              equipped: true,
              toolName: anyTool.name,
              reason: 'Equipped tool (fallback match)'
            };
          } catch (error) {
            logger.error('[TOOL-SELECT] Failed to equip fallback tool', { tool: anyTool.name, error });
          }
        }
      }

      // No optimal tool found - TRY TO CRAFT ONE
      // Reuse toolType from fallback pass above (or recalculate if needed)
      const neededToolType = toolType || toolCategory[0]?.split('_').pop() || '';
      
      if (neededToolType) {
        const craftResult = await this.tryCraftTool(neededToolType);
        if (craftResult.success && craftResult.toolName) {
          // Successfully crafted - now equip it
          const craftedTool = this.bot.inventory.items().find(item => item.name === craftResult.toolName);
          if (craftedTool) {
            try {
              await this.bot.equip(craftedTool, 'hand');
              logger.info('[TOOL-SELECT] Crafted and equipped missing tool', {
                tool: craftResult.toolName,
                block: blockName
              });
              return {
                equipped: true,
                toolName: craftResult.toolName,
                reason: `Crafted ${craftResult.toolName} for ${blockName}`
              };
            } catch (error) {
              logger.error('[TOOL-SELECT] Failed to equip crafted tool', { tool: craftResult.toolName, error });
            }
          }
        } else {
          logger.debug('[TOOL-SELECT] Could not craft tool', { 
            toolType: neededToolType, 
            reason: craftResult.reason 
          });
        }
      }

      // Still no tool - warn but continue with hand
      const currentTool = this.bot.heldItem?.name || null;
      const digDecision = shouldDigBlock(blockName, currentTool);

      return {
        equipped: false,
        toolName: currentTool,
        reason: 'No optimal tool in inventory and could not craft',
        warning: digDecision.shouldDig
          ? `Mining ${blockName} with ${currentTool || 'hand'} - will be slow`
          : digDecision.reason
      };
    }

    // Unknown block type - use current tool
    return {
      equipped: false,
      toolName: this.bot.heldItem?.name || null,
      reason: 'Unknown block type - using current tool'
    };
  }

  /**
   * Try to craft a tool of the specified type
   * Will craft the best available (stone > wooden) based on materials
   */
  private async tryCraftTool(toolType: 'axe' | 'pickaxe' | 'shovel' | 'hoe' | 'sword' | string): Promise<{
    success: boolean;
    toolName: string | null;
    reason: string;
  }> {
    if (!this.bot) {
      return { success: false, toolName: null, reason: 'Bot not initialized' };
    }

    const inventory = this.bot.inventory.items();
    
    // Count materials
    const stickCount = inventory.filter(i => i.name === 'stick').reduce((sum, i) => sum + i.count, 0);
    const planksCount = inventory.filter(i => i.name.includes('planks')).reduce((sum, i) => sum + i.count, 0);
    const cobbleCount = inventory.filter(i => i.name === 'cobblestone').reduce((sum, i) => sum + i.count, 0);
    const ironCount = inventory.filter(i => i.name === 'iron_ingot').reduce((sum, i) => sum + i.count, 0);
    const diamondCount = inventory.filter(i => i.name === 'diamond').reduce((sum, i) => sum + i.count, 0);
    const logCount = inventory.filter(i => i.name.includes('log')).reduce((sum, i) => sum + i.count, 0);

    // Materials needed per tool type
    const toolMaterials: Record<string, number> = {
      'axe': 3,      // 3 material + 2 sticks
      'pickaxe': 3,  // 3 material + 2 sticks
      'shovel': 1,   // 1 material + 2 sticks
      'hoe': 2,      // 2 material + 2 sticks
      'sword': 2,    // 2 material + 1 stick
    };

    const materialNeeded = toolMaterials[toolType] || 3;
    const sticksNeeded = toolType === 'sword' ? 1 : 2;

    logger.info('[TOOL-CRAFT] Checking materials for tool', {
      toolType,
      materialNeeded,
      sticksNeeded,
      have: { sticks: stickCount, planks: planksCount, cobble: cobbleCount, iron: ironCount, logs: logCount }
    });

    // Helper to craft sticks if needed
    const ensureSticks = async (needed: number): Promise<boolean> => {
      if (stickCount >= needed) return true;
      
      const sticksToMake = needed - stickCount;
      const planksNeededForSticks = Math.ceil(sticksToMake / 4) * 2; // 2 planks = 4 sticks
      
      // Check if we need to make planks first
      let currentPlanks = inventory.filter(i => i.name.includes('planks')).reduce((sum, i) => sum + i.count, 0);
      
      if (currentPlanks < planksNeededForSticks) {
        // Try to make planks from logs
        const logsAvailable = inventory.filter(i => i.name.includes('log')).reduce((sum, i) => sum + i.count, 0);
        const logsNeeded = Math.ceil((planksNeededForSticks - currentPlanks) / 4);
        
        if (logsAvailable >= logsNeeded) {
          logger.info('[TOOL-CRAFT] Crafting planks from logs', { logsNeeded });
          const result = await this.craft('oak_planks');
          if (!result.includes('Crafted')) {
            logger.warn('[TOOL-CRAFT] Failed to craft planks', { result });
            return false;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          return false; // Not enough materials
        }
      }
      
      // Now craft sticks
      logger.info('[TOOL-CRAFT] Crafting sticks');
      const result = await this.craft('stick');
      if (!result.includes('Crafted')) {
        logger.warn('[TOOL-CRAFT] Failed to craft sticks', { result });
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    };

    // Try crafting in order: diamond > iron > stone > wooden
    
    // Diamond tool
    if (diamondCount >= materialNeeded) {
      if (await ensureSticks(sticksNeeded)) {
        const toolName = `diamond_${toolType}`;
        const result = await this.craft(toolName);
        if (result.includes('Crafted')) {
          return { success: true, toolName, reason: 'Crafted diamond tool' };
        }
      }
    }

    // Iron tool
    if (ironCount >= materialNeeded) {
      if (await ensureSticks(sticksNeeded)) {
        const toolName = `iron_${toolType}`;
        const result = await this.craft(toolName);
        if (result.includes('Crafted')) {
          return { success: true, toolName, reason: 'Crafted iron tool' };
        }
      }
    }

    // Stone tool
    if (cobbleCount >= materialNeeded) {
      if (await ensureSticks(sticksNeeded)) {
        const toolName = `stone_${toolType}`;
        const result = await this.craft(toolName);
        if (result.includes('Crafted')) {
          return { success: true, toolName, reason: 'Crafted stone tool' };
        }
      }
    }

    // Wooden tool (last resort)
    // Need planks for the tool head
    const totalPlanksNeeded = materialNeeded + (stickCount < sticksNeeded ? Math.ceil((sticksNeeded - stickCount) / 4) * 2 : 0);
    
    if (planksCount >= materialNeeded || logCount >= 1) {
      // Ensure we have planks
      if (planksCount < materialNeeded && logCount >= 1) {
        logger.info('[TOOL-CRAFT] Crafting planks for wooden tool');
        const result = await this.craft('oak_planks');
        if (!result.includes('Crafted')) {
          return { success: false, toolName: null, reason: 'Failed to craft planks' };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (await ensureSticks(sticksNeeded)) {
        const toolName = `wooden_${toolType}`;
        const result = await this.craft(toolName);
        if (result.includes('Crafted')) {
          return { success: true, toolName, reason: 'Crafted wooden tool' };
        }
      }
    }

    return { 
      success: false, 
      toolName: null, 
      reason: `Not enough materials for ${toolType}. Need: ${materialNeeded} material + ${sticksNeeded} sticks` 
    };
  }

  /**
   * Normalize item names - fix common AI mistakes
   * Maps plural forms and common variations to correct Minecraft item IDs
   */
  private normalizeItemName(name: string): string {
    const normalized = name.toLowerCase().trim();
    
    // Common AI mistakes: plural → singular
    const pluralToSingular: Record<string, string> = {
      'sticks': 'stick',
      'planks': 'oak_planks',  // AI often says just "planks"
      'logs': 'oak_log',
      'stones': 'stone',
      'coals': 'coal',
      'irons': 'iron_ingot',
      'diamonds': 'diamond',
      'torches': 'torch',
      'swords': 'stone_sword',
      'pickaxes': 'stone_pickaxe',
      'axes': 'stone_axe',
      'shovels': 'stone_shovel',
      'hoes': 'stone_hoe',
      'apples': 'apple',
      'breads': 'bread',
      'bowls': 'bowl',
      'buckets': 'bucket',
      'beds': 'red_bed',
      'chests': 'chest',
      'furnaces': 'furnace',
    };
    
    // Common shorthand → full name
    const shorthandToFull: Record<string, string> = {
      'wood': 'oak_log',
      'log': 'oak_log',
      'plank': 'oak_planks',
      'table': 'crafting_table',
      'workbench': 'crafting_table',
      'bench': 'crafting_table',
      'pick': 'wooden_pickaxe',
      'sword': 'wooden_sword',
      'axe': 'wooden_axe',
      'shovel': 'wooden_shovel',
    };
    
    // Check plural forms first
    if (pluralToSingular[normalized]) {
      return pluralToSingular[normalized];
    }
    
    // Check shorthand
    if (shorthandToFull[normalized]) {
      return shorthandToFull[normalized];
    }
    
    // Return as-is if no normalization needed
    return normalized;
  }

  /**
   * Get inventory items
   */
  private getInventory(): MinecraftItem[] {
    if (!this.bot) return [];

    return this.bot.inventory.items().map(item => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));
  }

  /**
   * Get nearby blocks
   */
  private getNearbyBlocks(): string[] {
    if (!this.bot) return [];

    const blocks = new Set<string>();
    const pos = this.bot.entity.position;

    for (let x = -5; x <= 5; x++) {
      for (let y = -2; y <= 2; y++) {
        for (let z = -5; z <= 5; z++) {
          const block = this.bot.blockAt(pos.offset(x, y, z));
          if (block && block.name !== 'air') {
            blocks.add(block.name);
          }
        }
      }
    }

    return Array.from(blocks);
  }

  /**
   * Get spatial observation - 3x3x3 grid around bot with semantic understanding
   * Based on GITM research: structured 3D representation for embodied AI
   */
  getSpatialObservation(): SpatialObservation {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw; // Bot's facing direction

    // Helper to convert mineflayer block to our Block type
    const toBlock = (x: number, y: number, z: number): Block | null => {
      const block = this.bot!.blockAt(pos.offset(x, y, z));
      if (!block) return null;

      const blockPos: Vec3Type = {
        x: Math.floor(pos.x + x),
        y: Math.floor(pos.y + y),
        z: Math.floor(pos.z + z)
      };

      return {
        name: block.name,
        position: blockPos,
        distance: Math.sqrt(x*x + y*y + z*z)
      };
    };

    // Build 3x3x3 grid (relative to bot's position)
    // NW = northwest, N = north, NE = northeast, etc.
    const grid = {
      above: {
        nw: toBlock(-1, 2, -1), n: toBlock(0, 2, -1), ne: toBlock(1, 2, -1),
        w: toBlock(-1, 2, 0), center: toBlock(0, 2, 0), e: toBlock(1, 2, 0),
        sw: toBlock(-1, 2, 1), s: toBlock(0, 2, 1), se: toBlock(1, 2, 1),
      },
      current: {
        nw: toBlock(-1, 1, -1), n: toBlock(0, 1, -1), ne: toBlock(1, 1, -1),
        w: toBlock(-1, 1, 0), center: toBlock(0, 1, 0), e: toBlock(1, 1, 0),
        sw: toBlock(-1, 1, 1), s: toBlock(0, 1, 1), se: toBlock(1, 1, 1),
      },
      below: {
        nw: toBlock(-1, 0, -1), n: toBlock(0, 0, -1), ne: toBlock(1, 0, -1),
        w: toBlock(-1, 0, 0), center: toBlock(0, 0, 0), e: toBlock(1, 0, 0),
        sw: toBlock(-1, 0, 1), s: toBlock(0, 0, 1), se: toBlock(1, 0, 1),
      }
    };

    // Directional scans (5 blocks in each direction based on facing)
    const scan = {
      front: [toBlock(0, 1, -1), toBlock(0, 1, -2), toBlock(0, 1, -3), toBlock(0, 1, -4), toBlock(0, 1, -5)].filter(b => b !== null) as Block[],
      back: [toBlock(0, 1, 1), toBlock(0, 1, 2), toBlock(0, 1, 3), toBlock(0, 1, 4), toBlock(0, 1, 5)].filter(b => b !== null) as Block[],
      left: [toBlock(-1, 1, 0), toBlock(-2, 1, 0), toBlock(-3, 1, 0), toBlock(-4, 1, 0), toBlock(-5, 1, 0)].filter(b => b !== null) as Block[],
      right: [toBlock(1, 1, 0), toBlock(2, 1, 0), toBlock(3, 1, 0), toBlock(4, 1, 0), toBlock(5, 1, 0)].filter(b => b !== null) as Block[],
      up: [toBlock(0, 2, 0), toBlock(0, 3, 0), toBlock(0, 4, 0), toBlock(0, 5, 0), toBlock(0, 6, 0)].filter(b => b !== null) as Block[],
      down: [toBlock(0, -1, 0), toBlock(0, -2, 0), toBlock(0, -3, 0), toBlock(0, -4, 0), toBlock(0, -5, 0)].filter(b => b !== null) as Block[],
    };

    // Find nearest resources
    const nearestTree = this.findNearestBlockType(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']);
    const nearestOre = this.findNearestBlockType(['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore']);

    // Find nearest VISIBLE mob (must be in FOV and have line of sight)
    const visibleMobs = Object.values(this.bot.entities)
      .filter(e => {
        if (e.type !== 'mob' || !e.position) return false;
        const dist = e.position.distanceTo(pos);
        if (dist >= 32 || dist < 0.5) return false;
        
        // HUMAN-LIKE: Must be in field of view
        if (!this.isInFieldOfView(e.position)) return false;
        
        // HUMAN-LIKE: Must have line of sight (can't see through walls)
        const entityCenter = { 
          x: e.position.x, 
          y: e.position.y + (e.height || 1) * 0.5, 
          z: e.position.z 
        };
        if (!this.hasLineOfSight(entityCenter)) return false;
        
        return true;
      })
      .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos));

    const nearestMob = visibleMobs.length > 0 ? {
      position: { x: Math.floor(visibleMobs[0].position.x), y: Math.floor(visibleMobs[0].position.y), z: Math.floor(visibleMobs[0].position.z) } as Vec3Type,
      distance: visibleMobs[0].position.distanceTo(pos),
      type: visibleMobs[0].name || 'unknown',
      hostile: ['zombie', 'skeleton', 'creeper', 'spider', 'enderman'].includes(visibleMobs[0].name || '')
    } : undefined;

    // Environment assessment
    const currentY = Math.floor(pos.y);
    const isUnderground = currentY < 60;
    const blockAboveHead = this.bot.blockAt(pos.offset(0, 3, 0));
    const canSeeSky = blockAboveHead?.skyLight === 15;

    // Check if in cave (surrounded by stone-like blocks)
    const surroundingBlocks = [
      grid.current.n, grid.current.s, grid.current.e, grid.current.w,
      grid.above.center, grid.below.center
    ].filter(b => b !== null);
    const stoneBlocks = surroundingBlocks.filter(b =>
      b && ['stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate'].includes(b.name)
    );
    const inCave = stoneBlocks.length >= 4;

    // Check if bot is in water by examining current block
    const currentBlock = this.bot.blockAt(pos);
    const inWater = currentBlock?.name === 'water' || false;

    // Analyze escape path if underground
    let escapePath = undefined;
    if (isUnderground && !canSeeSky) {
      // Check which direction has clearest path up
      const upScan = scan.up;
      const airBlocksAbove = upScan.filter(b => b.name === 'air').length;
      const solidBlocksAbove = upScan.filter(b => b.name !== 'air').length;
      const obstacles = upScan.filter(b => b.name !== 'air').map(b => b.name);

      // CRITICAL: Check if air is too high to reach by jumping
      // If first 2 blocks above head are air, bot is in tall shaft and needs to build
      const immediatelyAbove = grid.above.center;
      const twoBlocksUp = upScan[1]; // Second block in up scan
      const needsToBuild = immediatelyAbove?.name === 'air' && twoBlocksUp?.name === 'air';

      escapePath = {
        direction: 'up' as const,
        blocksToSurface: Math.max(0, 62 - currentY),
        pathClear: solidBlocksAbove === 0 && !needsToBuild, // NOT clear if need to build
        obstacles: needsToBuild ? ['air (too high - need to build up)'] : obstacles.slice(0, 3)
      };
    }

    // Identify threats (only visible mobs we can actually see)
    const threats = visibleMobs
      .filter((e: { name?: string }) => ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch'].includes(e.name || ''))
      .map((e: { name?: string; position: Vec3; }) => ({
        type: e.name || 'unknown',
        distance: e.position.distanceTo(pos),
        position: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) } as Vec3Type,
        severity: (e.position.distanceTo(pos) < 5 ? 'critical' :
                  e.position.distanceTo(pos) < 10 ? 'high' :
                  e.position.distanceTo(pos) < 20 ? 'medium' : 'low') as 'low' | 'medium' | 'high' | 'critical'
      }));

    // Light-based exit detection - scan in all directions to find brightest (likely exit)
    // CRITICAL: Also check for water obstacles in the path to avoid recommending water traps
    let brightestDirection: { direction: string; lightLevel: number; distance: number; position: Vec3Type; hasWaterInPath?: boolean } | undefined = undefined;
    if (isUnderground || inCave) {
      const directions = [
        { name: 'north', dx: 0, dz: -1 },
        { name: 'south', dx: 0, dz: 1 },
        { name: 'east', dx: 1, dz: 0 },
        { name: 'west', dx: -1, dz: 0 },
        { name: 'northeast', dx: 1, dz: -1 },
        { name: 'northwest', dx: -1, dz: -1 },
        { name: 'southeast', dx: 1, dz: 1 },
        { name: 'southwest', dx: -1, dz: 1 },
      ];

      // Helper function to check for water in path
      const checkWaterInPath = (dx: number, dz: number, maxDist: number): boolean => {
        if (!this.bot) return false;
        for (let d = 1; d <= maxDist; d++) {
          const checkX = Math.floor(pos.x) + dx * d;
          const checkZ = Math.floor(pos.z) + dz * d;
          // Check at feet level and below (where water pools would be)
          for (let yOff = -2; yOff <= 1; yOff++) {
            const checkY = Math.floor(pos.y) + yOff;
            const block = this.bot.blockAt(new Vec3(checkX, checkY, checkZ));
            if (block && (block.name === 'water' || block.name === 'flowing_water' || block.name === 'lava' || block.name === 'flowing_lava')) {
              return true;
            }
          }
        }
        return false;
      };

      type BrightDirection = { direction: string; lightLevel: number; distance: number; position: Vec3Type; hasWaterInPath: boolean };
      let bestSafeDirection: BrightDirection | undefined = undefined;
      let bestUnsafeDirection: BrightDirection | undefined = undefined;

      for (const dir of directions) {
        // First check if this direction has water in the path
        const hasWater = checkWaterInPath(dir.dx, dir.dz, 8); // Check first 8 blocks for water

        // Scan up to 16 blocks in each direction at eye level and slightly above
        for (let dist = 1; dist <= 16; dist++) {
          for (let yOffset = 0; yOffset <= 2; yOffset++) {
            const checkX = Math.floor(pos.x) + dir.dx * dist;
            const checkY = Math.floor(pos.y) + 1 + yOffset;
            const checkZ = Math.floor(pos.z) + dir.dz * dist;
            const block = this.bot.blockAt(new Vec3(checkX, checkY, checkZ));

            if (block) {
              // skyLight ranges 0-15, with 15 being full daylight
              const light = block.skyLight || 0;
              if (light >= 10) { // Only consider bright sources (10+)
                const candidate = {
                  direction: dir.name,
                  lightLevel: light,
                  distance: dist,
                  position: { x: checkX, y: checkY, z: checkZ },
                  hasWaterInPath: hasWater
                };

                // Prefer safe (no water) directions
                if (!hasWater && light > (bestSafeDirection?.lightLevel || 0)) {
                  bestSafeDirection = candidate;
                } else if (hasWater && light > (bestUnsafeDirection?.lightLevel || 0)) {
                  bestUnsafeDirection = candidate;
                }
              }
            }
          }
        }
      }

      // Prefer safe direction, only use unsafe if no safe option exists
      if (bestSafeDirection) {
        brightestDirection = bestSafeDirection;
      } else if (bestUnsafeDirection) {
        // Mark it clearly as dangerous
        brightestDirection = bestUnsafeDirection;
        logger.warn('[CAVE-EXIT] Only exit found has water/lava in path!', {
          direction: bestUnsafeDirection.direction,
          lightLevel: bestUnsafeDirection.lightLevel
        });
      }
    }

    const semantic = {
      nearestTree,
      nearestOre,
      nearestMob,
      isUnderground,
      canSeeSky,
      inCave,
      inWater,
      escapePath,
      threats,
      brightestDirection
    };

    return {
      grid,
      scan,
      semantic,
      timestamp: Date.now()
    };
  }

  /**
   * Check if a log block is accessible (not completely surrounded by leaves/canopy)
   * A log is accessible if it has at least one adjacent air block at a reachable position
   */
  private isLogAccessible(blockPos: Vec3): boolean {
    if (!this.bot) return false;

    // Check all 4 horizontal directions for an accessible approach
    const directions = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 }
    ];

    const leafBlocks = ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves', 'mangrove_leaves', 'cherry_leaves'];

    for (const dir of directions) {
      // Check block at same Y level as log
      const adjacentPos = blockPos.offset(dir.x, 0, dir.z);
      const adjacentBlock = this.bot.blockAt(adjacentPos);

      if (!adjacentBlock) continue;

      // If adjacent block is air, check if player can stand there
      if (adjacentBlock.name === 'air') {
        // Check if there's ground below to stand on
        const groundBelow = this.bot.blockAt(adjacentPos.offset(0, -1, 0));
        if (groundBelow && groundBelow.name !== 'air' && !leafBlocks.includes(groundBelow.name)) {
          return true; // Can approach from this direction
        }
        // Also check one block down - player could stand at feet level
        const feetLevel = this.bot.blockAt(adjacentPos.offset(0, -1, 0));
        const chestLevel = this.bot.blockAt(adjacentPos);
        if (feetLevel && feetLevel.name === 'air' && chestLevel && chestLevel.name === 'air') {
          const groundLevel = this.bot.blockAt(adjacentPos.offset(0, -2, 0));
          if (groundLevel && groundLevel.name !== 'air' && !leafBlocks.includes(groundLevel.name)) {
            return true; // Can approach from below
          }
        }
      }

      // If adjacent is NOT a leaf block, there might be a path
      if (!leafBlocks.includes(adjacentBlock.name) && adjacentBlock.name !== 'air') {
        // Could potentially climb/navigate to this log
        // Check if the adjacent non-leaf block is walkable (solid ground)
        if (adjacentBlock.boundingBox === 'block') {
          return true;
        }
      }
    }

    // Also check if log is reachable from below (trunk base scenario)
    const belowBlock = this.bot.blockAt(blockPos.offset(0, -1, 0));
    if (belowBlock) {
      // If there's another log below, this log is part of trunk and accessible
      if (belowBlock.name.includes('log')) {
        return true;
      }
      // If there's solid ground below (not leaves), trunk base is accessible
      if (belowBlock.name !== 'air' && !leafBlocks.includes(belowBlock.name)) {
        return true;
      }
    }

    // Log is surrounded by leaves/canopy - inaccessible
    return false;
  }

  /**
   * Find nearest block of given types using SAME scoring as mine()
   * This ensures tree detection reports the exact block that mine() will target
   */
  private findNearestBlockType(blockNames: string[]): { position: Vec3Type; distance: number; type: string } | undefined {
    if (!this.bot) return undefined;

    const pos = this.bot.entity.position;
    const playerY = Math.floor(pos.y);
    let best: { position: Vec3Type; distance: number; type: string; score: number } | undefined = undefined;

    for (const name of blockNames) {
      const blockType = this.mcData.blocksByName[name];
      if (!blockType) continue;

      // Use findBlocks (plural) to get multiple candidates - same as mine()
      const blockPositions = this.bot.findBlocks({
        matching: blockType.id,
        maxDistance: 32,
        count: 10,
      });

      // Check if this is a log block (for Y-level scoring)
      const isLogBlock = name.toLowerCase().includes('log');

      for (const blockPos of blockPositions) {
        // For logs, skip inaccessible blocks (inside tree canopy)
        if (isLogBlock && !this.isLogAccessible(blockPos)) {
          continue;
        }

        const dist = pos.distanceTo(blockPos);
        
        // HUMAN-LIKE: Check if block is within field of view AND has line of sight
        // Only apply to blocks within 20 blocks (beyond that, we might have "remembered" it)
        if (dist < 20) {
          const blockCenter = { x: blockPos.x + 0.5, y: blockPos.y + 0.5, z: blockPos.z + 0.5 };
          
          // Must be in front of us (FOV check)
          if (!this.isInFieldOfView(blockCenter)) {
            continue; // Block is behind us
          }
          
          // Must have clear line of sight (can't see through walls)
          if (!this.hasLineOfSight(blockCenter)) {
            continue; // Block is behind a wall
          }
        }

        const yDiff = Math.abs(blockPos.y - playerY);
        // Apply same scoring as mine() - prefer blocks at player Y level for logs
        const yPenalty = isLogBlock ? yDiff * 2 : 0;
        const score = dist + yPenalty;

        if (!best || score < best.score) {
          best = {
            position: { x: blockPos.x, y: blockPos.y, z: blockPos.z },
            distance: dist,
            type: name,
            score: score
          };
        }
      }
    }

    return best ? { position: best.position, distance: best.distance, type: best.type } : undefined;
  }

  /**
   * Check if an entity position is within the bot's field of view
   * Returns true if the bot can "see" that position
   */
  private isInFieldOfView(targetPos: { x: number; y: number; z: number }, fovHalfRadians: number = Math.PI * 0.39): boolean {
    if (!this.bot) return false;
    
    const botPos = this.bot.entity.position;
    const botYaw = this.bot.entity.yaw;
    
    // Calculate angle from bot to target
    const dx = targetPos.x - botPos.x;
    const dz = targetPos.z - botPos.z;
    const angleToTarget = Math.atan2(-dx, -dz);
    
    // Calculate angular difference
    let angleDiff = angleToTarget - botYaw;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    return Math.abs(angleDiff) < fovHalfRadians;
  }

  /**
   * Check if there's a clear line of sight to a target position
   * Uses ray-casting to detect solid blocks between bot and target
   * A human can't see through walls!
   */
  private hasLineOfSight(targetPos: { x: number; y: number; z: number }): boolean {
    if (!this.bot) return false;

    // Start from bot's eye level
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    
    const dx = targetPos.x - eyePos.x;
    const dy = targetPos.y - eyePos.y;
    const dz = targetPos.z - eyePos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (distance < 1) return true; // Very close, definitely visible
    
    // Normalize direction
    const stepX = dx / distance;
    const stepY = dy / distance;
    const stepZ = dz / distance;
    
    // Ray-cast from bot to target, checking for solid blocks
    // Step size of 0.5 blocks for reasonable accuracy without being too slow
    const stepSize = 0.5;
    const steps = Math.floor(distance / stepSize);
    
    // Blocks that don't block vision
    const transparentBlocks = new Set([
      'air', 'water', 'flowing_water', 'lava', 'flowing_lava',
      'glass', 'glass_pane', 'white_stained_glass', 'orange_stained_glass',
      'magenta_stained_glass', 'light_blue_stained_glass', 'yellow_stained_glass',
      'lime_stained_glass', 'pink_stained_glass', 'gray_stained_glass',
      'light_gray_stained_glass', 'cyan_stained_glass', 'purple_stained_glass',
      'blue_stained_glass', 'brown_stained_glass', 'green_stained_glass',
      'red_stained_glass', 'black_stained_glass',
      'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
      'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
      'tall_grass', 'grass', 'fern', 'dead_bush', 'seagrass', 'tall_seagrass',
      'torch', 'wall_torch', 'lantern', 'soul_lantern',
      'iron_bars', 'chain', 'ladder', 'vine',
      'oak_fence', 'spruce_fence', 'birch_fence', 'jungle_fence',
      'acacia_fence', 'dark_oak_fence', 'nether_brick_fence',
      // Flowers and small plants
      'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
      'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
      'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower',
      'lilac', 'rose_bush', 'peony', 'sweet_berry_bush',
    ]);
    
    for (let i = 1; i < steps; i++) {
      const checkX = eyePos.x + stepX * stepSize * i;
      const checkY = eyePos.y + stepY * stepSize * i;
      const checkZ = eyePos.z + stepZ * stepSize * i;
      
      const block = this.bot.blockAt(new Vec3(checkX, checkY, checkZ));
      if (block && !transparentBlocks.has(block.name)) {
        // Solid block is blocking the view
        return false;
      }
    }
    
    return true; // No solid blocks in the way
  }

  /**
   * Get nearby entities - ONLY those within the bot's field of view AND visible (not behind walls)
   * A human player can only see what's in front of them AND not obscured by blocks!
   */
  private getNearbyEntities(): string[] {
    if (!this.bot) return [];

    const botPos = this.bot.entity.position;
    const botYaw = this.bot.entity.yaw;
    
    // Minecraft-like FOV: ~70 degrees on each side = 140 degree total FOV
    const FOV_HALF_RADIANS = Math.PI * 0.39; // ~70 degrees in radians

    const entities = Object.values(this.bot.entities)
      .filter(e => {
        if (!e.position || !e.name || e.type === 'object') return false;
        
        const dist = e.position.distanceTo(botPos);
        if (dist > 16 || dist < 0.5) return false; // Too far or too close (self)
        
        // Calculate angle from bot to entity
        const dx = e.position.x - botPos.x;
        const dz = e.position.z - botPos.z;
        const angleToEntity = Math.atan2(-dx, -dz); // Same convention as mineflayer yaw
        
        // Calculate angular difference
        let angleDiff = angleToEntity - botYaw;
        // Normalize to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Check if within FOV
        if (Math.abs(angleDiff) >= FOV_HALF_RADIANS) {
          return false; // Outside field of view
        }
        
        // Check line of sight - can't see through walls!
        const entityCenter = { 
          x: e.position.x, 
          y: e.position.y + (e.height || 1) * 0.5,  // Aim at entity center
          z: e.position.z 
        };
        if (!this.hasLineOfSight(entityCenter)) {
          return false; // Blocked by solid blocks
        }
        
        return true;
      })
      .map(e => e.name!)
      .filter((name, index, self) => self.indexOf(name) === index);

    return entities;
  }

  /**
   * Get time of day
   */
  public getTimeOfDay(): string {
    if (!this.bot) return 'unknown';

    const time = this.bot.time.timeOfDay;
    if (time < 6000) return 'morning';
    if (time < 12000) return 'day';
    if (time < 18000) return 'evening';
    return 'night';
  }

  /**
   * Eat food from inventory
   */
  private async eat(foodName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    // Food items that can be eaten
    const edibleItems = [
      'apple', 'baked_potato', 'beef', 'beetroot', 'beetroot_soup', 'bread',
      'carrot', 'chicken', 'chorus_fruit', 'cooked_beef', 'cooked_chicken',
      'cooked_cod', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit',
      'cooked_salmon', 'cookie', 'dried_kelp', 'enchanted_golden_apple',
      'golden_apple', 'golden_carrot', 'honey_bottle', 'melon_slice',
      'mushroom_stew', 'mutton', 'porkchop', 'potato', 'pufferfish',
      'pumpkin_pie', 'rabbit', 'rabbit_stew', 'raw_beef', 'raw_chicken',
      'raw_cod', 'raw_mutton', 'raw_porkchop', 'raw_rabbit', 'raw_salmon',
      'rotten_flesh', 'salmon', 'spider_eye', 'steak', 'suspicious_stew',
      'sweet_berries', 'tropical_fish', 'glow_berries'
    ];

    const inventory = this.bot.inventory.items();

    // Find food to eat - specific item or any food
    let foodItem;
    if (foodName && foodName.trim()) {
      foodItem = inventory.find(i => i.name.toLowerCase().includes(foodName.toLowerCase()));
    }

    // If no specific food found, find any edible item
    if (!foodItem) {
      foodItem = inventory.find(i => edibleItems.some(f => i.name.includes(f)));
    }

    if (!foodItem) {
      return 'No food in inventory';
    }

    // Check if already full
    if (this.bot.food >= 20) {
      return 'Already full (20/20 hunger)';
    }

    try {
      // Equip food to hand
      await this.bot.equip(foodItem, 'hand');

      // Look slightly down while eating (natural pose)
      await this.bot.look(this.bot.entity.yaw, 0.3);

      // Swing arm to show eating action
      this.bot.swingArm('right');

      // Consume the food
      await this.bot.consume();

      // Swing arm again after eating
      this.bot.swingArm('right');

      return `Ate ${foodItem.name}`;
    } catch (error: any) {
      logger.error('[EAT] Failed to eat', { error: error.message, food: foodItem.name });
      return `Failed to eat ${foodItem.name}: ${error.message}`;
    }
  }

  /**
   * Equip item (tool, weapon, armor)
   */
  private async equip(itemName: string): Promise<string> {
    if (!this.bot) return 'Bot not initialized';

    const inventory = this.bot.inventory.items();
    const item = inventory.find(i => i.name.toLowerCase().includes(itemName.toLowerCase()));

    if (!item) {
      return `No ${itemName} in inventory`;
    }

    // Determine slot based on item type
    let destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet' = 'hand';

    if (item.name.includes('helmet') || item.name.includes('cap')) {
      destination = 'head';
    } else if (item.name.includes('chestplate') || item.name.includes('tunic')) {
      destination = 'torso';
    } else if (item.name.includes('leggings') || item.name.includes('pants')) {
      destination = 'legs';
    } else if (item.name.includes('boots')) {
      destination = 'feet';
    } else if (item.name.includes('shield')) {
      destination = 'off-hand';
    }

    try {
      await this.bot.equip(item, destination);

      // Swing arm to show equip action
      this.bot.swingArm('right');

      // If equipping to hand, do a second swing (like inspecting the item)
      if (destination === 'hand') {
        await new Promise(resolve => setTimeout(resolve, 200));
        this.bot.swingArm('right');
      }

      return `Equipped ${item.name} to ${destination}`;
    } catch (error: any) {
      logger.error('[EQUIP] Failed to equip', { error: error.message, item: item.name });
      return `Failed to equip ${item.name}: ${error.message}`;
    }
  }

  /**
   * Equip best weapon for combat
   * Priority: Sword > Axe > Pickaxe > Shovel > Fists
   */
  private async equipBestWeapon(): Promise<void> {
    if (!this.bot) return;

    const inventory = this.bot.inventory.items();
    
    // Weapon priority tiers (higher = better)
    const weaponPriority: Record<string, number> = {
      // Swords - best for combat
      'netherite_sword': 100,
      'diamond_sword': 90,
      'iron_sword': 80,
      'golden_sword': 75,
      'stone_sword': 70,
      'wooden_sword': 60,
      // Axes - second best (high damage but slower)
      'netherite_axe': 55,
      'diamond_axe': 50,
      'iron_axe': 45,
      'golden_axe': 43,
      'stone_axe': 40,
      'wooden_axe': 35,
      // Pickaxes - emergency weapon
      'netherite_pickaxe': 30,
      'diamond_pickaxe': 28,
      'iron_pickaxe': 26,
      'golden_pickaxe': 25,
      'stone_pickaxe': 24,
      'wooden_pickaxe': 22,
      // Shovels - last resort
      'netherite_shovel': 20,
      'diamond_shovel': 18,
      'iron_shovel': 16,
      'golden_shovel': 15,
      'stone_shovel': 14,
      'wooden_shovel': 12,
    };

    // Find best weapon in inventory
    let bestWeapon: { name: string; priority: number; item: any } | null = null;
    
    for (const item of inventory) {
      const priority = weaponPriority[item.name];
      if (priority !== undefined) {
        if (!bestWeapon || priority > bestWeapon.priority) {
          bestWeapon = { name: item.name, priority, item };
        }
      }
    }

    // If we have a weapon and it's not already equipped
    if (bestWeapon) {
      const currentHeld = this.bot.heldItem;
      if (!currentHeld || currentHeld.name !== bestWeapon.name) {
        logger.info(`[COMBAT] Equipping ${bestWeapon.name} (priority: ${bestWeapon.priority})`);
        try {
          await this.bot.equip(bestWeapon.item, 'hand');
          // Brief pause for equip animation
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.warn(`[COMBAT] Failed to equip weapon`, { error, weapon: bestWeapon.name });
        }
      }
    } else {
      logger.debug('[COMBAT] No weapons in inventory, fighting bare-handed');
    }
  }

  /**
   * Get the currently held item info for UI display
   */
  getHeldItem(): { name: string | null; displayName: string | null } {
    if (!this.bot) {
      return { name: null, displayName: null };
    }

    const heldItem = this.bot.heldItem;
    if (!heldItem) {
      return { name: null, displayName: null };
    }

    return {
      name: heldItem.name,
      displayName: heldItem.displayName || heldItem.name.replace(/_/g, ' '),
    };
  }

  /**
   * Register a callback for item pickups (for UI notifications)
   */
  onItemPickup(callback: (itemName: string, displayName: string, count: number) => void): void {
    this.onItemPickupCallback = callback;
  }

  /**
   * Register a callback for item crafts (for UI notifications)
   */
  onItemCraft(callback: (itemName: string, displayName: string, count: number) => void): void {
    this.onItemCraftCallback = callback;
  }

  /**
   * Register a callback for when the bot dies
   */
  onDeath(callback: () => void): void {
    this.onDeathCallback = callback;
  }

  /**
   * Register a callback for when the bot respawns
   */
  onRespawn(callback: () => void): void {
    this.onRespawnCallback = callback;
  }

  /**
   * Register a callback for when bot is under attack (taking rapid damage)
   * This should trigger immediate survival response in the AI
   */
  onUnderAttack(callback: (damage: number, health: number, attacker?: string) => void): void {
    this.onUnderAttackCallback = callback;
  }

  /**
   * Register a callback for state changes (health, inventory) for immediate UI updates
   */
  onStateChange(callback: () => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Trigger state change callback (call this when important state changes)
   */
  private notifyStateChange(): void {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }

  /**
   * Calculate total damage taken in the last N milliseconds
   */
  private calculateRecentDamage(windowMs: number): number {
    const now = Date.now();
    const recentEntries = this.healthHistory.filter(h => now - h.time <= windowMs);
    if (recentEntries.length < 2) return 0;
    
    const oldest = recentEntries[0];
    const newest = recentEntries[recentEntries.length - 1];
    return Math.max(0, oldest.health - newest.health);
  }

  /**
   * Get nearby hostile mobs with distance info
   */
  private getNearbyHostileMobs(maxDistance: number = 10): { name: string; distance: number; position: Vec3 }[] {
    if (!this.bot) return [];
    
    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 
                         'phantom', 'drowned', 'husk', 'stray', 'pillager', 'vindicator',
                         'ravager', 'evoker', 'vex', 'blaze', 'ghast', 'wither_skeleton'];
    
    const hostiles: { name: string; distance: number; position: Vec3 }[] = [];
    
    Object.values(this.bot.entities).forEach(entity => {
      if (entity.type === 'mob' && entity.name && entity.position) {
        const nameLower = entity.name.toLowerCase();
        if (hostileMobs.some(h => nameLower.includes(h))) {
          const dist = this.bot!.entity.position.distanceTo(entity.position);
          if (dist <= maxDistance) {
            hostiles.push({
              name: entity.name,
              distance: dist,
              position: entity.position.clone(),
            });
          }
        }
      }
    });
    
    // Sort by distance (closest first)
    return hostiles.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Check if bot is currently under attack
   */
  isCurrentlyUnderAttack(): boolean {
    return this.isUnderAttack;
  }

  /**
   * Check if emergency flee was requested due to health danger
   */
  shouldEmergencyFlee(): boolean {
    return this.emergencyFleeRequested;
  }

  /**
   * Clear emergency flee flag after responding to it
   */
  clearEmergencyFlee(): void {
    this.emergencyFleeRequested = false;
  }

  /**
   * Get current attacker name if known
   */
  getAttackerName(): string | null {
    return this.attackerName;
  }

  /**
   * Get health alert info for AI context
   */
  getHealthAlertInfo(): { 
    isUnderAttack: boolean; 
    recentDamage: number; 
    currentHealth: number;
    attacker: string | null;
    emergencyFlee: boolean;
    nearbyHostiles: { name: string; distance: number }[];
    isEnvironmentalDamage: boolean;
    damageSource: string;
  } {
    return {
      isUnderAttack: this.isUnderAttack,
      recentDamage: this.calculateRecentDamage(5000),
      currentHealth: this.bot?.health ?? 20,
      attacker: this.attackerName,
      emergencyFlee: this.emergencyFleeRequested,
      nearbyHostiles: this.getNearbyHostileMobs(10).map(h => ({ name: h.name, distance: h.distance })),
      isEnvironmentalDamage: this.isEnvironmentalDamage,
      damageSource: this.damageSource,
    };
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.flushMemory(); // Save memory before disconnect
    decisionLogger.shutdown(); // Save decision patterns before disconnect

    if (this.bot) {
      this.bot.quit();
      this.bot = null;
      this.isConnected = false;
      logger.info('Disconnected from Minecraft server');
    }
  }

  /**
   * Navigation-aware yaw smoother
   * - During navigation: FAST smoothing (300°/sec) - quick enough to turn, but not instant
   * - During idle: SLOW smoothing (90°/sec) - natural human-like head movement
   * This prevents jarring camera jumps while still allowing pathfinder to work
   */
  private startNavigationAwareYawSmoother(): void {
    if (!this.bot || this.yawSmootherInterval) return;

    this.targetYaw = this.bot.entity.yaw;
    this.targetPitch = this.bot.entity.pitch;

    // Store original look function
    const originalLook = this.bot.look.bind(this.bot);

    // Override bot.look to set target instead of instant
    this.bot.look = (yaw: number, pitch: number, force?: boolean) => {
      // Normalize incoming yaw to [-π, π]
      while (yaw > Math.PI) yaw -= 2 * Math.PI;
      while (yaw < -Math.PI) yaw += 2 * Math.PI;

      this.targetYaw = yaw;
      this.targetPitch = pitch;
      return Promise.resolve();
    };

    // Run interpolation at 60fps
    this.yawSmootherInterval = setInterval(() => {
      if (!this.bot) return;

      // Get current angles
      let currentYaw = this.bot.entity.yaw;
      let currentPitch = this.bot.entity.pitch;

      // Normalize current yaw to [-π, π]
      while (currentYaw > Math.PI) currentYaw -= 2 * Math.PI;
      while (currentYaw < -Math.PI) currentYaw += 2 * Math.PI;

      // Calculate yaw difference (shortest path)
      let yawDiff = this.targetYaw - currentYaw;
      while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
      while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

      // Calculate pitch difference
      const pitchDiff = this.targetPitch - currentPitch;

      // If close enough, snap to target
      if (Math.abs(yawDiff) < 0.01 && Math.abs(pitchDiff) < 0.01) {
        originalLook(this.targetYaw, this.targetPitch, false);
        return;
      }

      // Choose velocity based on navigation state
      // Navigation: 300°/sec = 5.24 rad/s = 0.084 rad per 16ms frame
      // Idle: 90°/sec = 1.57 rad/s = 0.025 rad per 16ms frame
      const maxYawPerFrame = this.isNavigating ? 0.084 : 0.025;
      const maxPitchPerFrame = this.isNavigating ? 0.084 : 0.025;

      // Calculate interpolation (15% per frame for responsiveness)
      const interpolationSpeed = this.isNavigating ? 0.20 : 0.08;

      let yawChange = yawDiff * interpolationSpeed;
      let pitchChange = pitchDiff * interpolationSpeed;

      // Cap to max velocity
      if (Math.abs(yawChange) > maxYawPerFrame) {
        yawChange = Math.sign(yawChange) * maxYawPerFrame;
      }
      if (Math.abs(pitchChange) > maxPitchPerFrame) {
        pitchChange = Math.sign(pitchChange) * maxPitchPerFrame;
      }

      // Apply changes
      let newYaw = currentYaw + yawChange;
      let newPitch = currentPitch + pitchChange;

      // Normalize new yaw
      while (newYaw > Math.PI) newYaw -= 2 * Math.PI;
      while (newYaw < -Math.PI) newYaw += 2 * Math.PI;

      // Clamp pitch to valid range
      newPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newPitch));

      originalLook(newYaw, newPitch, false);
    }, 16); // 60fps

    logger.debug('[YAW-SMOOTHER] Navigation-aware smoother started');
  }

  /**
   * Get connection status
   */
  isActive(): boolean {
    return this.isConnected && this.bot !== null;
  }
}

// Singleton instance
export const minecraftGame = new MinecraftGame();
