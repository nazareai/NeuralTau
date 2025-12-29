import { Logger, delay, TIMING } from '@tau/shared';
import { aiBrain } from './ai/brain.js';
import { elevenLabsClient } from './voice/elevenlabs.js';
import { gameManager } from './games/game-manager.js';
import { minecraftGame } from './games/minecraft.js';
import { config } from './config.js';
import { TauWebSocketServer } from './websocket-server.js';
import { emotionManager } from './ai/emotion-manager.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TauBot');

// Log files to clear on startup
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILES_TO_CLEAR = ['learning.log', 'prompts.log'];

/**
 * Clear log files on startup for fresh session
 */
function clearLogsOnStartup() {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    for (const logFile of LOG_FILES_TO_CLEAR) {
      const logPath = path.join(LOGS_DIR, logFile);
      fs.writeFileSync(logPath, '');
      logger.debug(`Cleared log file: ${logFile}`);
    }
    logger.info('Log files cleared for new session');
  } catch (err) {
    logger.warn('Failed to clear log files', { error: err });
  }
}

// Autonomous mode - when enabled, don't force interventions
const AUTONOMOUS_MODE = process.env.AUTONOMOUS_MODE === 'true';

class TauBot {
  private isRunning: boolean = false;
  private decisionLoopInterval: NodeJS.Timeout | null = null;
  private wsServer: TauWebSocketServer;
  private decisionInFlight: boolean = false;
  // Human-like observation tracking
  private decisionCycleCount: number = 0;
  private lastObservationCycle: number = 0;
  private lastKnownPosition: { x: number; y: number; z: number } | null = null;
  private readonly OBSERVE_EVERY_N_CYCLES = 5; // Observe every ~5 cycles (human-like curiosity)
  private readonly POSITION_CHANGE_THRESHOLD = 10; // Observe if moved more than 10 blocks

  // Batch action tracking - continue same action without re-asking AI
  private batchAction: { type: string; target: string; remaining: number } | null = null;
  private readonly BATCH_LIMITS: Record<string, number> = {
    mine: 5,      // Mine up to 5 of same block type before re-asking
    craft: 3,     // Craft up to 3 of same item
    move: 1,      // Don't batch movement
    place: 2,     // Place up to 2 blocks
  };

  constructor() {
    logger.info('NeuralTau Bot initializing...', {
      personality: config.personality.name,
      goal: config.personality.goal,
    });

    // Start WebSocket server for dashboard
    this.wsServer = new TauWebSocketServer(3002);
  }

  /**
   * Start the bot
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    this.isRunning = true;

    // Clear logs for fresh session
    clearLogsOnStartup();

    logger.info('🚀 NeuralTau Bot starting up!');
    logger.info(`Goal: ${config.personality.goal}`);
    logger.info(`AI Model: ${config.ai.defaultModel}`);
    logger.info(`Vision Model: ${config.ai.visionModel}`);
    logger.info(`Game Mode: ${config.game.mode}`);

    // Initialize game
    try {
      await gameManager.initialize();
      logger.info('Game initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize game', { error });
      throw error;
    }

    // Display initial game state
    await this.displayGameState();

    // Wait for dashboard to connect before starting (if enabled)
    const waitForDashboard = process.env.WAIT_FOR_DASHBOARD === 'true';
    if (waitForDashboard) {
      logger.info('⏳ Waiting for dashboard to connect...');
      const connected = await this.wsServer.waitForClient(120000); // 2 minute timeout
      if (connected) {
        logger.info('✅ Dashboard connected! Starting AI decisions...');
        // Small delay to ensure dashboard is fully loaded
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        logger.warn('⚠️ No dashboard connected after timeout, starting anyway');
      }
    }

    // Start the main decision loop
    this.startDecisionLoop();

    // Test TTS if configured
    if (elevenLabsClient.isConfigured()) {
      await this.testTTS();
    } else {
      logger.warn('TTS not configured - voice output disabled');
    }

    logger.info('✅ NeuralTau Bot is now running!');
  }

  /**
   * Stop the bot
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    logger.info('Stopping NeuralTau Bot...');

    this.isRunning = false;

    if (this.decisionLoopInterval) {
      clearInterval(this.decisionLoopInterval);
      this.decisionLoopInterval = null;
    }

    // Close WebSocket server
    this.wsServer.close();

    // Shutdown game
    await gameManager.shutdown();

    logger.info('✅ NeuralTau Bot stopped');
  }

  /**
   * Main decision loop - AI makes decisions about what to do
   */
  private startDecisionLoop() {
    logger.info('Starting AI decision loop', {
      intervalMs: TIMING.AI_DECISION_INTERVAL,
    });

    // Make first decision immediately
    this.makeDecision();

    // Then continue on interval
    this.decisionLoopInterval = setInterval(() => {
      this.makeDecision();
    }, TIMING.AI_DECISION_INTERVAL);
  }

  /**
   * Make a single decision
   */
  private async makeDecision() {
    if (!this.isRunning) return;
    // Prevent overlapping decision cycles (these can fight over movement controls)
    if (this.decisionInFlight) {
      logger.warn('Decision cycle skipped (previous cycle still in progress)');
      return;
    }
    this.decisionInFlight = true;

    try {
      this.decisionCycleCount++;
      logger.info('--- AI Decision Cycle Starting ---', { cycle: this.decisionCycleCount });

      // Get current game state
      const gameState = await gameManager.getState();

      logger.debug('Current game state', {
        room: gameState.metadata.roomName,
        items: gameState.metadata.itemsInRoom,
        score: gameState.metadata.score,
      });

      // Broadcast game state to dashboard
      this.wsServer.broadcastGameState(gameState);

      // Broadcast held item for hand overlay (every cycle so it stays visible)
      if (gameState.name === 'minecraft') {
        const currentHeldItem = minecraftGame.getHeldItem();
        this.wsServer.broadcastHeldItem({
          name: currentHeldItem.name,
          displayName: currentHeldItem.displayName,
          action: 'idle',
        });
      }

      // === HUMAN-LIKE PROACTIVE OBSERVATION ===
      // Check if we should do a proactive observation (like a human looking around)
      const currentPos = (gameState.metadata as any)?.position;
      let shouldObserve = false;
      let observeReason = '';

      // Condition 1: Periodic observation (every N cycles)
      if (this.decisionCycleCount - this.lastObservationCycle >= this.OBSERVE_EVERY_N_CYCLES) {
        shouldObserve = true;
        observeReason = 'periodic curiosity';
      }

      // Condition 2: Entered new area (position changed significantly)
      if (currentPos && this.lastKnownPosition) {
        const dx = currentPos.x - this.lastKnownPosition.x;
        const dy = currentPos.y - this.lastKnownPosition.y;
        const dz = currentPos.z - this.lastKnownPosition.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance >= this.POSITION_CHANGE_THRESHOLD) {
          shouldObserve = true;
          observeReason = `moved ${distance.toFixed(1)} blocks to new area`;
        }
      }

      // Condition 3: Recent failures (2+ consecutive) - need to look around for alternatives
      // SKIP in autonomous mode - let LLM decide when to look around
      if (!AUTONOMOUS_MODE) {
        const recentFailures = aiBrain.getConsecutiveFailures();
        if (recentFailures >= 2 && this.decisionCycleCount - this.lastObservationCycle >= 2) {
          shouldObserve = true;
          observeReason = `${recentFailures} consecutive failures - looking for alternatives`;
        }
      }

      // Condition 4: In water (detected from game state) - need situational awareness
      // SKIP in autonomous mode - let LLM decide
      if (!AUTONOMOUS_MODE) {
        const inWater = (gameState.metadata as any)?.spatialObservation?.semantic?.inWater;
        if (inWater && this.decisionCycleCount - this.lastObservationCycle >= 2) {
          shouldObserve = true;
          observeReason = 'in water - need escape route';
        }
      }

      // Condition 5: Underground (Y < 55) - need to find escape path
      // ALWAYS trigger in ALL modes when underground (critical for survival)
      if (currentPos && currentPos.y < 55) {
        // Check every 3 cycles when underground to find escape paths
        if (this.decisionCycleCount - this.lastObservationCycle >= 3) {
          shouldObserve = true;
          observeReason = `underground at Y=${Math.floor(currentPos.y)} - looking for escape routes`;
        }
      }

      // Update last known position
      if (currentPos) {
        this.lastKnownPosition = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
      }

      // Trigger proactive observation (for Minecraft)
      if (shouldObserve && gameState.name === 'minecraft') {
        logger.info(`[OBSERVE] Proactive observation: ${observeReason}`);
        this.lastObservationCycle = this.decisionCycleCount;
        try {
          // Quick 360° look around (human-like awareness)
          const obsResult = await minecraftGame.visionAnalysisLookAround();

          // Store observation in AI brain for context
          aiBrain.setObservation(obsResult);

          // Log what we observed
          const blockList = Array.from(obsResult.blocksVisible.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => `${name}:${count}`)
            .join(', ');
          const clearPaths = obsResult.pathsAvailable.filter(p => p.clear).map(p => p.direction);
          logger.info(`[OBSERVE] Saw: ${blockList || 'nothing special'}`);
          logger.info(`[OBSERVE] Clear paths: ${clearPaths.join(', ') || 'none'}`);
          logger.info(`[OBSERVE] Can see sky: ${obsResult.canSeeSky ? 'YES' : 'NO'}`);
          if (obsResult.recommendation) {
            logger.info(`[OBSERVE] Recommendation: ${obsResult.recommendation}`);
          }
        } catch (obsErr) {
          logger.warn('[OBSERVE] Observation failed', { error: obsErr });
        }
      }

      // Determine thinking mode based on consecutive failures
      // Lower threshold: 4+ failures triggers advanced mode (was 6)
      const consecutiveFailures = aiBrain.getConsecutiveFailures();
      const thinkingMode = consecutiveFailures >= 4 ? 'advanced' : 'fast';

      // Check if we have a pending batch action to continue
      let action: import('@tau/shared').GameAction;
      if (this.batchAction && this.batchAction.remaining > 0) {
        // Continue the batch action without asking AI
        action = {
          type: this.batchAction.type as import('@tau/shared').GameAction['type'],
          target: this.batchAction.target,
          reasoning: `Continuing batch: ${this.batchAction.remaining} more ${this.batchAction.target}`,
        };
        this.batchAction.remaining--;
        logger.info('[BATCH] Continuing batch action', {
          type: action.type,
          target: action.target,
          remaining: this.batchAction.remaining,
        });
      } else {
        // No batch action - ask AI for decision
        // Broadcast thinking status BEFORE making decision
        this.wsServer.broadcastThinking(true, thinkingMode);

        // AI makes a decision
        action = await aiBrain.makeGameDecision(gameState, []);

        // Broadcast thinking complete
        this.wsServer.broadcastThinking(false, thinkingMode);

        // Clear any old batch action and exit batch mode
        if (this.batchAction) {
          gameManager.exitBatchMode();
        }
        this.batchAction = null;
      }

      logger.info('AI decided to act', {
        action: action.type,
        target: action.target,
        reasoning: action.reasoning,
      });

      // Broadcast decision to dashboard
      this.wsServer.broadcastDecision({
        reasoning: action.reasoning,
        action,
        gameState,
      });

      // Execute the action with timeout to prevent blocking the decision loop
      // Adaptive timeouts based on action type - movement needs more time for pathfinding
      const ACTION_TIMEOUTS: Record<string, number> = {
        place: 3000,      // Placing should be instant
        move: 15000,      // Movement needs time for pathfinding (was 5s, too short)
        mine: 15000,      // Mining can take time
        craft: 5000,      // Crafting may need to find/use table
        dig_up: 20000,    // Underground escape takes time
        wait: 2000,       // Wait is quick
        speak: 2000,      // Chat is instant
        analyze: 5000,    // Vision analysis moderate
        interact: 3000,   // Interactions quick
        attack: 8000,     // Combat moderate
      };

      const ACTION_TIMEOUT_MS = ACTION_TIMEOUTS[action.type] || 10000; // Default 10s fallback
      const actionStartTime = Date.now();

      // Broadcast activity start for visual feedback
      if (action.type === 'craft') {
        this.wsServer.broadcastActivity({ type: 'crafting', item: action.target, active: true });
      } else if (action.type === 'mine') {
        this.wsServer.broadcastActivity({ type: 'mining', item: action.target, active: true });
      }

      // Broadcast held item with action state for hand overlay
      const heldItem = minecraftGame.getHeldItem();
      let itemAction: 'idle' | 'mining' | 'attacking' | 'eating' | 'placing' = 'idle';
      if (action.type === 'mine' || action.type === 'dig_up') itemAction = 'mining';
      else if (action.type === 'attack') itemAction = 'attacking';
      else if (action.type === 'eat') itemAction = 'eating';
      else if (action.type === 'place') itemAction = 'placing';

      this.wsServer.broadcastHeldItem({
        name: heldItem.name,
        displayName: heldItem.displayName,
        action: itemAction,
      });

      // Use a cancellable timeout to avoid "timed out" warnings when action completes first
      let timeoutId: NodeJS.Timeout | null = null;
      let actionCompleted = false;

      const result = await Promise.race([
        gameManager.executeAction(action).then(res => {
          actionCompleted = true;
          if (timeoutId) clearTimeout(timeoutId);
          return res;
        }),
        new Promise<string>((resolve) => {
          timeoutId = setTimeout(() => {
            if (actionCompleted) return; // Don't log timeout if action already completed
            const duration = Date.now() - actionStartTime;
            logger.warn(`Action timed out after ${duration}ms`, {
              action: action.type,
              target: action.target,
            });
            resolve(`Action timed out after ${duration}ms - continuing to next cycle (action may still be running)`);
          }, ACTION_TIMEOUT_MS);
        }),
      ]);

      const actionDuration = Date.now() - actionStartTime;
      logger.info('Action result', { result, duration: `${actionDuration}ms` });

      // Broadcast activity end
      if (action.type === 'craft' || action.type === 'mine') {
        this.wsServer.broadcastActivity({ type: 'idle', active: false });
      }

      // Broadcast held item back to idle state
      const heldItemAfter = minecraftGame.getHeldItem();
      this.wsServer.broadcastHeldItem({
        name: heldItemAfter.name,
        displayName: heldItemAfter.displayName,
        action: 'idle',
      });

      // Record the action result for AI memory/learning
      aiBrain.recordActionResult(action, result);

      // Start batch action if this was successful and batchable
      // Extended failure keywords to catch all failure cases
      const failureKeywordsForBatch = [
        'failed', 'cannot', 'blocked', 'stuck', 'error', 'timeout', 'unable',
        'no recipe', 'missing', 'not found', 'could not', 'no path',
        'unknown item', 'unknown', 'invalid'  // Added: catch unknown items
      ];
      const actionSucceeded = !failureKeywordsForBatch.some(kw => result.toLowerCase().includes(kw));
      const batchLimit = this.BATCH_LIMITS[action.type] || 0;

      if (actionSucceeded && batchLimit > 1 && action.target && !this.batchAction) {
        // Start a new batch for this action type
        this.batchAction = {
          type: action.type,
          target: action.target,
          remaining: batchLimit - 1, // -1 because we just did one
        };
        // Enter batch mode to suppress idle looks between batch operations
        // Duration: (remaining * 25s) to cover all cycles with buffer
        gameManager.enterBatchMode((batchLimit - 1) * 25000);
        logger.info('[BATCH] Starting batch action', {
          type: action.type,
          target: action.target,
          batchSize: batchLimit,
        });
      } else if (!actionSucceeded && this.batchAction) {
        // Failed during batch - clear it and exit batch mode
        logger.info('[BATCH] Batch action failed, clearing', {
          type: this.batchAction.type,
          target: this.batchAction.target,
        });
        this.batchAction = null;
        gameManager.exitBatchMode();
      }

      // Trigger emotions based on action result
      emotionManager.trackAction(action.type);
      const resultLower = result.toLowerCase();
      const failureKeywords = ['failed', 'cannot', 'blocked', 'stuck', 'error', 'could not', "couldn't", "didn't work", 'unable', 'timeout', 'not collected'];
      const successKeywords = ['mined', 'crafted', 'reached', 'placed', 'walked', 'success'];

      const isFailure = failureKeywords.some(kw => resultLower.includes(kw));
      const isSuccess = !isFailure && successKeywords.some(kw => resultLower.includes(kw));

      if (isSuccess) {
        // Check for special achievements
        if (resultLower.includes('diamond')) {
          emotionManager.trigger({ type: 'discovery', intensity: 90, source: 'Found diamonds!' });
        } else if (resultLower.includes('crafted') && (resultLower.includes('pickaxe') || resultLower.includes('sword'))) {
          emotionManager.trigger({ type: 'achievement', intensity: 70, source: `Crafted ${action.target}` });
        } else {
          emotionManager.trigger({ type: 'success', intensity: 50, source: result });
        }
      } else if (isFailure) {
        emotionManager.trigger({ type: 'failure', intensity: 60, source: result });
      }

      // Check for danger conditions from game state
      const meta = gameState.metadata as any;
      if (meta?.health !== undefined && meta.health < 8) {
        emotionManager.trigger({ type: 'danger', intensity: 70, source: 'Low health!' });
      }
      if (meta?.nearbyEntities?.some((e: string) => ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.toLowerCase()))) {
        emotionManager.trigger({ type: 'danger', intensity: 50, source: 'Hostile mob nearby!' });
      }

      // Broadcast emotional state
      const emotionalState = emotionManager.getState();
      this.wsServer.broadcastEmotion(emotionalState);

      // Log emotional expression if there is one
      if (emotionalState.expression && emotionalState.dominantIntensity > 40) {
        logger.info(`[EMOTION] ${emotionalState.dominant.toUpperCase()}: "${emotionalState.expression}"`);
      }

      // Check for consecutive failures and force recovery
      // SKIP in autonomous mode - let LLM reason through stuck situations
      if (!AUTONOMOUS_MODE) {
        const repeatingAction = aiBrain.isRepeatingFailedAction();

        // Force recovery at 4+ failures (human-like - don't repeat mistakes many times)
        if (consecutiveFailures >= 4) {
          logger.warn('[STUCK-OVERRIDE] Consecutive failures detected - forcing recovery', {
            consecutiveFailures,
            repeatingAction: repeatingAction.isRepeating ? repeatingAction.actionType : null,
          });

          // Force intelligent stuck recovery for Minecraft
          if (gameState.name === 'minecraft') {
            try {
              if (repeatingAction.isRepeating) {
                logger.error(`[STUCK-OVERRIDE] Bot is repeating "${repeatingAction.actionType}" - FORCING VISION ANALYSIS`, {
                  count: repeatingAction.count
                });
              }

              // Use vision capture for severe stuck situations (6+ failures)
              // This captures 4 directional screenshots and analyzes them
              if (consecutiveFailures >= 6) {
                logger.warn('[STUCK-OVERRIDE] Severe stuck (6+ failures) - capturing vision screenshots');
                try {
                  const visionResult = await minecraftGame.captureAndAnalyzeWithVision();
                  if (visionResult.success) {
                    logger.info('[VISION-STUCK] Analysis complete', {
                      recommendation: visionResult.recommendation,
                      directions: visionResult.directions.map(d => `${d.dir}: ${d.description}`)
                    });
                    // The recommendation can be used to guide the next action
                  }
                } catch (visionError) {
                  logger.error('[VISION-STUCK] Vision capture failed', { error: visionError });
                }
              }

              logger.info('[STUCK-OVERRIDE] Calling intelligentStuckRecovery()...');
              await minecraftGame.intelligentStuckRecovery();

              const currentState = await gameManager.getState();
              const yPos = (currentState.metadata as any)?.position?.y;

              if (yPos !== undefined && yPos < 60) {
                logger.warn('[STUCK-OVERRIDE] Bot is underground - forcing digUpToSurface()', { yPos });
                await minecraftGame.digUpToSurface();
              }

            } catch (recoveryError) {
              logger.error('[STUCK-OVERRIDE] Recovery failed', { error: recoveryError });
            }
          }
        }
      } else if (consecutiveFailures >= 4) {
        // In autonomous mode, just log the situation - LLM will handle it
        logger.info('[AUTONOMOUS] Bot has consecutive failures, letting LLM reason', { consecutiveFailures });
        
        // Even in autonomous mode, use vision capture at 6+ failures as a learning opportunity
        if (consecutiveFailures >= 6 && gameState.name === 'minecraft') {
          logger.info('[AUTONOMOUS-VISION] Capturing vision for learning opportunity');
          try {
            const visionResult = await minecraftGame.captureAndAnalyzeWithVision();
            if (visionResult.success) {
              logger.info('[AUTONOMOUS-VISION] Analysis', {
                recommendation: visionResult.recommendation
              });
            }
          } catch (e) {
            // Silently fail - this is optional learning
          }
        }
      }

      // Get new state after action
      const newState = await gameManager.getState();

      // Track position changes after moves to detect water/trap directions
      if (action.type === 'move' && action.target) {
        const newY = (newState.metadata as any)?.position?.y;
        if (newY !== undefined) {
          // Normalize direction (e.g., "-124 50 45" becomes the cardinal direction or "coordinates")
          const direction = action.target.toLowerCase();
          const cardinalDirs = ['north', 'south', 'east', 'west', 'up', 'down'];
          const dirKey = cardinalDirs.includes(direction) ? direction :
                         direction.match(/^-?\d/) ? 'coordinates' : direction;
          aiBrain.recordPositionAfterMove(dirKey, newY);
        }
      }

      // Broadcast result to dashboard
      this.wsServer.broadcastResult({
        action,
        outcome: result,
        newState,
      });

      // Broadcast updated stats
      this.wsServer.broadcastStats({
        score: newState.metadata.score as number,
        moves: newState.metadata.moves as number,
        inventory: newState.metadata.inventory as string[],
        currentRoom: newState.metadata.roomName as string,
      });

      // Speak the reasoning and result
      console.log('\n🤖 NeuralTau:', action.reasoning);
      console.log('📝 Result:', result);
      console.log('');

      // Generate TTS for AI reasoning (disabled - hit character limit)
      // if (elevenLabsClient.isConfigured() && action.reasoning) {
      //   await this.speak(action.reasoning);
      // }

    } catch (error) {
      logger.error('Error in decision cycle', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.decisionInFlight = false;
    }
  }

  /**
   * Display current game state
   */
  private async displayGameState() {
    const gameState = gameManager.getState();
    const summary = gameManager.getSummary();

    const gameTitle = config.game.mode === 'minecraft' ? 'MINECRAFT' :
                      config.game.mode === 'pokemon' ? 'POKEMON' :
                      'TEXT ADVENTURE';

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║                  NeuralTau - ${gameTitle.padEnd(32)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(summary);
    console.log('');
  }

  /**
   * Test TTS functionality
   */
  private async testTTS() {
    try {
      logger.info('Testing TTS...');

      const testMessage = `Hello! I'm ${config.personality.name}, and I'm ready to start my journey!`;

      console.log(`\n🔊 Testing voice: "${testMessage}"\n`);

      // Note: Uncomment to actually test TTS (will use API credits)
      // const audioBuffer = await elevenLabsClient.textToSpeech(testMessage);
      // logger.info('TTS test successful', { audioSize: audioBuffer.length });

      logger.info('TTS configured and ready (test skipped to save credits)');
    } catch (error) {
      logger.error('TTS test failed', { error });
    }
  }

  /**
   * Speak text using TTS
   */
  private async speak(text: string) {
    if (!elevenLabsClient.isConfigured()) {
      return;
    }

    try {
      logger.debug('Speaking', { textLength: text.length });

      // Note: In production, this would play the audio
      // For now, just generate it to test the API
      const audioBuffer = await elevenLabsClient.textToSpeech(text);

      logger.info('TTS generated', { audioSize: audioBuffer.length });

      // TODO: Play audio through OBS or audio output
    } catch (error) {
      logger.error('Failed to speak', { error });
    }
  }
}

// Main execution
async function main() {
  logger.info('Starting NeuralTau - Autonomous AI Streamer');

  const bot = new TauBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\nReceived SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\nReceived SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // Start the bot
  await bot.start();
}

// Run if this is the main module
main().catch((error) => {
  // Log detailed error info since Error objects don't serialize well
  const errorInfo = {
    message: error?.message || String(error),
    name: error?.name || 'Unknown',
    stack: error?.stack?.split('\n').slice(0, 5).join('\n') || 'No stack',
  };
  logger.error('Fatal error', { error: errorInfo.message });
  console.error('Fatal error details:', errorInfo);
  process.exit(1);
});
