import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from '@tau/shared';
import { movementLogger } from '../utils/movement-logger.js';

const logger = new Logger('HumanBehavior');

export interface HumanBehaviorConfig {
  enabled: boolean;
  curiosity: number;      // 0-1: How often to look at interesting things
  caution: number;        // 0-1: How often to check surroundings
  focus: number;          // 0-1: How easily distracted (inverse)
  lookFrequency: number;  // Milliseconds between idle looks
  debugLogging: boolean;
}

/**
 * REDESIGNED Human Behavior Manager - V2
 *
 * Core Principles:
 * 1. NEVER interfere with task execution (mining, placing, combat, navigation)
 * 2. Only act during IDLE periods when bot is doing nothing
 * 3. All movements are smooth and gradual (no sudden snaps)
 * 4. Behavior is context-aware and purposeful
 *
 * Architecture:
 * - Passive observer: Runs in background, only acts when bot is idle
 * - Task-aware: Knows when bot is busy and stays silent
 * - Smooth transitions: All camera movements use easing
 */
export class HumanBehaviorManager {
  private bot: Bot;
  private config: HumanBehaviorConfig;
  private isActive: boolean = false;
  private currentTask: string | null = null;
  private lastIdleLook: number = 0;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(bot: Bot, config: Partial<HumanBehaviorConfig> = {}) {
    this.bot = bot;
    this.config = {
      enabled: config.enabled ?? true,
      curiosity: config.curiosity ?? 0.7,
      caution: config.caution ?? 0.8,
      focus: config.focus ?? 0.5,
      lookFrequency: config.lookFrequency ?? 8000, // 8 seconds between looks
      debugLogging: config.debugLogging ?? false,
    };

    if (this.config.debugLogging) {
      logger.info('HumanBehaviorManager initialized (V2 - Idle-only)', {
        curiosity: this.config.curiosity,
        caution: this.config.caution,
        focus: this.config.focus,
        lookFrequency: this.config.lookFrequency,
      });
    }
  }

  /**
   * Start the passive behavior loop
   * Only acts when bot is completely idle
   */
  startPassiveBehavior(): void {
    if (!this.config.enabled) {
      logger.info('Human behavior disabled');
      return;
    }

    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    logger.info('Starting passive idle behavior loop');

    // Check every 2 seconds if we should do an idle look
    this.idleCheckInterval = setInterval(() => {
      this.checkAndPerformIdleBehavior().catch((err) => {
        if (this.config.debugLogging) {
          logger.debug('Idle behavior error (non-critical)', { error: err.message });
        }
      });
    }, 2000);
  }

  /**
   * Stop the passive behavior loop
   */
  stop(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    logger.info('Passive behavior loop stopped');
  }

  // Batch mode flag - prevents idle behavior between batch operations
  private batchModeActive: boolean = false;
  private batchModeTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Signal that bot is starting a task (mining, placing, navigating, etc.)
   * This prevents human behavior from interfering
   */
  notifyTaskStart(taskName: string): void {
    this.currentTask = taskName;
    if (this.config.debugLogging) {
      logger.debug('Task started, pausing idle behavior', { task: taskName });
    }
  }

  /**
   * Signal that bot has finished a task
   */
  notifyTaskEnd(): void {
    if (this.config.debugLogging && this.currentTask) {
      logger.debug('Task ended, resuming idle behavior', { task: this.currentTask });
    }
    this.currentTask = null;
  }

  /**
   * Enable batch mode - prevents idle behavior for a period even between individual tasks.
   * Used during batch mining/placing where we want to stay focused between operations.
   * @param durationMs How long to stay in batch mode (default: 25 seconds to cover decision cycle)
   */
  enterBatchMode(durationMs: number = 25000): void {
    this.batchModeActive = true;
    // Clear any existing timeout
    if (this.batchModeTimeout) {
      clearTimeout(this.batchModeTimeout);
    }
    // Auto-exit batch mode after duration
    this.batchModeTimeout = setTimeout(() => {
      this.exitBatchMode();
    }, durationMs);
    logger.debug('[HumanBehavior] Entered batch mode, idle behavior suppressed');
  }

  /**
   * Exit batch mode - allows idle behavior to resume
   */
  exitBatchMode(): void {
    this.batchModeActive = false;
    if (this.batchModeTimeout) {
      clearTimeout(this.batchModeTimeout);
      this.batchModeTimeout = null;
    }
    logger.debug('[HumanBehavior] Exited batch mode');
  }

  /**
   * Check if bot is truly idle and perform subtle looking behavior
   */
  private async checkAndPerformIdleBehavior(): Promise<void> {
    if (!this.config.enabled) return;

    // Don't act if bot is doing a task
    if (this.currentTask !== null) return;

    // Don't act if in batch mode (prevents looks between batch operations)
    if (this.batchModeActive) return;

    // Don't act if we're already performing a behavior
    if (this.isActive) return;

    // Check if enough time has passed since last idle look
    const now = Date.now();
    const timeSinceLastLook = now - this.lastIdleLook;
    if (timeSinceLastLook < this.config.lookFrequency) return;

    // Check if bot is moving (if moving, it's not idle)
    const velocity = this.bot.entity.velocity;
    const isMoving = Math.abs(velocity.x) > 0.01 || Math.abs(velocity.z) > 0.01;
    if (isMoving) return;

    // Bot is truly idle - perform subtle behavior
    this.lastIdleLook = now;
    await this.performIdleLook();
  }

  /**
   * Perform a subtle, natural-looking camera movement while idle
   * Prefers looking at meaningful targets (trees, animals, mobs) for connected feel
   */
  private async performIdleLook(): Promise<void> {
    this.isActive = true;

    try {
      const currentYaw = this.bot.entity.yaw;
      const currentPitch = this.bot.entity.pitch;

      // 60% chance: Try to look at something meaningful
      if (Math.random() < 0.6) {
        const target = this.findNearbyInterestingTarget();
        if (target) {
          await this.lookAtTargetSmoothly(target);
          return;
        }
      }

      // Fallback: Random idle behavior
      const behaviorType = Math.random();

      if (behaviorType < 0.4) {
        // 40% chance: Slight horizontal head drift (like looking around casually)
        await this.subtleHorizontalDrift(currentYaw, currentPitch);
      } else if (behaviorType < 0.7) {
        // 30% chance: Brief upward glance (like checking surroundings)
        await this.briefUpwardGlance(currentYaw, currentPitch);
      } else {
        // 30% chance: Slow pan left or right (like scanning environment)
        await this.slowEnvironmentScan(currentYaw, currentPitch);
      }

    } finally {
      this.isActive = false;
    }
  }

  /**
   * Simple line of sight check for idle behavior
   * Returns true if path from bot to target has no solid blocks
   */
  private hasLineOfSight(targetPos: Vec3): boolean {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    const dx = targetPos.x - eyePos.x;
    const dy = targetPos.y - eyePos.y;
    const dz = targetPos.z - eyePos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (distance < 1) return true;
    
    const stepX = dx / distance;
    const stepY = dy / distance;
    const stepZ = dz / distance;
    
    // Blocks that don't block vision
    const transparent = ['air', 'water', 'glass', 'leaves', 'tall_grass', 'grass', 'torch', 'fence'];
    
    for (let i = 1; i < distance; i += 0.5) {
      const checkPos = eyePos.offset(stepX * i, stepY * i, stepZ * i);
      const block = this.bot.blockAt(checkPos);
      if (block && !transparent.some(t => block.name.includes(t))) {
        return false; // Solid block in the way
      }
    }
    return true;
  }

  /**
   * Find a nearby interesting target to look at (tree, animal, mob)
   * HUMAN-LIKE: Must have line of sight (can't look at things behind walls)
   */
  private findNearbyInterestingTarget(): Vec3 | null {
    const pos = this.bot.entity.position;

    // Priority 1: Look at nearby hostile mobs (awareness)
    const hostileMobs = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman'];
    for (const entity of Object.values(this.bot.entities)) {
      if (entity.name && hostileMobs.includes(entity.name)) {
        const dist = entity.position.distanceTo(pos);
        if (dist < 16 && dist > 3) { // Nearby but not too close
          const targetPos = entity.position.offset(0, entity.height * 0.5, 0);
          // HUMAN-LIKE: Check line of sight (can't see through walls)
          if (this.hasLineOfSight(targetPos)) {
            return targetPos;
          }
        }
      }
    }

    // Priority 2: Look at nearby passive mobs (animals - they're interesting)
    const passiveMobs = ['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'llama', 'fox', 'wolf', 'cat'];
    for (const entity of Object.values(this.bot.entities)) {
      if (entity.name && passiveMobs.includes(entity.name)) {
        const dist = entity.position.distanceTo(pos);
        if (dist < 12 && dist > 2) {
          const targetPos = entity.position.offset(0, entity.height * 0.5, 0);
          // HUMAN-LIKE: Check line of sight
          if (this.hasLineOfSight(targetPos)) {
            return targetPos;
          }
        }
      }
    }

    // Priority 3: Look at nearby trees (wood logs)
    // Only look at logs that are roughly at eye level (avoid looking straight up/down)
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
    for (let dx = -8; dx <= 8; dx += 4) {
      for (let dz = -8; dz <= 8; dz += 4) {
        // Skip if directly above/below (would cause extreme pitch)
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        if (horizontalDist < 2) continue; // Too close horizontally = extreme pitch angle

        for (let dy = -1; dy <= 3; dy++) { // Only look at blocks near eye level
          const blockPos = pos.offset(dx, dy, dz);
          const block = this.bot.blockAt(blockPos);
          if (block && logTypes.includes(block.name)) {
            // HUMAN-LIKE: Check line of sight to tree
            if (this.hasLineOfSight(blockPos)) {
              return blockPos;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Smoothly look at a target position
   */
  private async lookAtTargetSmoothly(target: Vec3): Promise<void> {
    const pos = this.bot.entity.position;
    const dx = target.x - pos.x;
    const dy = target.y - (pos.y + 1.62); // Eye height
    const dz = target.z - pos.z;

    // Calculate target yaw and pitch (using correct Minecraft formula)
    const targetYaw = Math.atan2(-dx, -dz);
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    let targetPitch = Math.atan2(-dy, horizontalDist);

    // LIMIT YAW: Don't turn more than ~35 degrees during idle (looks unnatural to suddenly spin)
    // Humans glance at things in their peripheral vision, not turn head drastically
    const currentYaw = this.bot.entity.yaw;
    let yawDelta = targetYaw - currentYaw;
    // Normalize to [-π, π]
    while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
    while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;

    if (Math.abs(yawDelta) > 0.61) { // > 35 degrees - much more restrictive
      if (this.config.debugLogging) {
        logger.debug('Idle: Skipping target - yaw delta too large', {
          yawDelta: `${(yawDelta * 180 / Math.PI).toFixed(1)}°`
        });
      }
      return; // Skip this target, will fall back to random idle behavior
    }

    // LIMIT PITCH: Don't look too far up or down during idle (causes jarring transitions)
    // Max ~30 degrees up (-0.52 rad) or ~20 degrees down (0.35 rad)
    targetPitch = Math.max(-0.52, Math.min(0.35, targetPitch));

    if (this.config.debugLogging) {
      logger.debug('Idle: Looking at target', {
        targetPos: `${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}`,
        distance: horizontalDist.toFixed(1),
        yawDelta: `${(yawDelta * 180 / Math.PI).toFixed(1)}°`
      });
    }

    // Smooth transition to look at target
    await this.smoothCameraTransition(targetYaw, targetPitch, 600);

    // Brief pause looking at target (like actually observing it)
    await this.sleep(200 + Math.random() * 300);
  }

  /**
   * Subtle horizontal drift - very small yaw change
   * Like when you're standing still and just move your head slightly
   */
  private async subtleHorizontalDrift(startYaw: number, startPitch: number): Promise<void> {
    const driftAmount = (Math.random() - 0.5) * 0.15; // ±4.3 degrees max (reduced)
    const targetYaw = startYaw + driftAmount;
    const pitchVariation = (Math.random() - 0.5) * 0.05; // ±1.4 degrees vertical (reduced)
    const targetPitch = Math.max(-0.2, Math.min(0.2, startPitch + pitchVariation)); // Keep pitch reasonable

    if (this.config.debugLogging) {
      logger.debug('Idle: Subtle horizontal drift', {
        yawChange: `${(driftAmount * 180 / Math.PI).toFixed(1)}°`,
        duration: '1200ms'
      });
    }

    // Smooth transition over 1200ms (slower, more natural)
    await this.smoothCameraTransition(targetYaw, targetPitch, 1200);
  }

  /**
   * Brief upward glance - look up slightly then return
   * Like checking the sky or ceiling briefly
   */
  private async briefUpwardGlance(startYaw: number, startPitch: number): Promise<void> {
    // Look up slightly (negative pitch = up) - reduced movement
    const upwardPitch = Math.max(-0.3, startPitch - 0.12); // Look up ~7 degrees (reduced)

    if (this.config.debugLogging) {
      logger.debug('Idle: Brief upward glance', {
        pitchChange: `${((startPitch - upwardPitch) * 180 / Math.PI).toFixed(1)}° up`,
      });
    }

    // Look up (slower transition)
    await this.smoothCameraTransition(startYaw, upwardPitch, 800);

    // Hold for a moment
    await this.sleep(400 + Math.random() * 400);

    // Return to original (or close to it)
    const returnPitch = startPitch + (Math.random() - 0.5) * 0.03;
    await this.smoothCameraTransition(startYaw, returnPitch, 800);
  }

  /**
   * Slow environment scan - pan camera slowly left or right
   * Like when you're looking around casually
   */
  private async slowEnvironmentScan(startYaw: number, startPitch: number): Promise<void> {
    const scanDirection = Math.random() > 0.5 ? 1 : -1;
    const scanAmount = scanDirection * (0.15 + Math.random() * 0.2); // 8-20 degrees (reduced)
    const targetYaw = startYaw + scanAmount;

    if (this.config.debugLogging) {
      logger.debug('Idle: Slow environment scan', {
        direction: scanDirection > 0 ? 'right' : 'left',
        amount: `${(Math.abs(scanAmount) * 180 / Math.PI).toFixed(1)}°`,
      });
    }

    // Log scan start
    movementLogger.logLookChange('idle-scan-start', startYaw, startPitch);

    // Pan slowly at 60fps for smooth motion
    const totalDuration = 2000; // Longer duration for smoother feel
    const steps = Math.floor(totalDuration / 16); // 60fps
    const stepDuration = totalDuration / steps;

    for (let i = 1; i <= steps; i++) {
      // CRITICAL: Abort immediately if a task (navigation, mining, etc.) has started
      if (this.currentTask !== null) {
        movementLogger.logLookChange('idle-scan-aborted', this.bot.entity.yaw, this.bot.entity.pitch, startYaw, startPitch);
        return;
      }

      const progress = i / steps;
      // Ease in-out for smooth motion
      const easedProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const currentYaw = startYaw + (scanAmount * easedProgress);
      await this.bot.look(currentYaw, startPitch, false);
      await this.sleep(stepDuration);
    }

    // Log scan end
    movementLogger.logLookChange('idle-scan-end', targetYaw, startPitch, startYaw, startPitch);
  }

  /**
   * Smooth camera transition with easing at 60fps
   */
  private async smoothCameraTransition(
    targetYaw: number,
    targetPitch: number,
    durationMs: number
  ): Promise<void> {
    const startYaw = this.bot.entity.yaw;
    const startPitch = this.bot.entity.pitch;

    // Log look change start
    movementLogger.logLookChange('idle-look-start', startYaw, startPitch);

    // 60fps = 16ms per frame for smooth motion
    const steps = Math.max(10, Math.floor(durationMs / 16));
    const stepDuration = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      // CRITICAL: Abort immediately if a task (navigation, mining, etc.) has started
      // This prevents race conditions where idle look fights with pathfinder for control
      if (this.currentTask !== null) {
        movementLogger.logLookChange('idle-look-aborted', this.bot.entity.yaw, this.bot.entity.pitch, startYaw, startPitch);
        return;
      }

      const progress = i / steps;
      // Ease in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const yaw = startYaw + (targetYaw - startYaw) * eased;
      const pitch = startPitch + (targetPitch - startPitch) * eased;

      await this.bot.look(yaw, pitch, false);
      await this.sleep(stepDuration);
    }

    // Log look change end
    movementLogger.logLookChange('idle-look-end', targetYaw, targetPitch, startYaw, startPitch);
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<HumanBehaviorConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.config.debugLogging) {
      logger.info('Configuration updated', { config: this.config });
    }
  }
}
