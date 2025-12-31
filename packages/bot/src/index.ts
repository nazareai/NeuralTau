import { Logger, delay, TIMING } from '@tau/shared';
import { aiBrain } from './ai/brain.js';
import { elevenLabsClient } from './voice/elevenlabs.js';
import { openRouterClient } from './ai/openrouter.js';
import { gameManager } from './games/game-manager.js';
import { minecraftGame } from './games/minecraft.js';
import { config, streamingConfig } from './config.js';
import { TauWebSocketServer } from './websocket-server.js';
import { emotionManager } from './ai/emotion-manager.js';
import { initializeStreaming, shutdownStreaming, TwitchClient, XClient, ChatManager, ChatResponder } from './streaming/index.js';
import * as fs from 'fs';
import * as path from 'path';

// Entertainment systems
import commentary, { markVoiceStart, markVoiceEnd, generateActionCommentary, generateReaction } from './commentary.js';
import entertainment, { shouldTriggerEntertainment, generateEntertainmentSuggestion, maybeOverrideAction } from './entertainment-mode.js';
import { viewerMemory } from './viewer-memory.js';
import { personality, randomChoice, getChatQuestion } from './personality.js';

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

  // Streamer message tracking
  private lastStreamerMessage: number = 0;
  private streamerMessageCooldown: number = 20000; // 20 seconds between messages (was 12)
  private messagesSinceLastQuestion: number = 0;
  private lastMessageText: string = '';
  private idleMessageInterval: NodeJS.Timeout | null = null;
  private lastIdleMessage: number = 0;
  
  // Recent gameplay events for contextual idle messages
  private recentEvents: {
    lastMinedItem?: { name: string; count: number; time: number };
    lastCraftedItem?: { name: string; count: number; time: number };
    lastDeath?: number;
    blocksMinedSession: number;
    itemsCraftedSession: number;
  } = { blocksMinedSession: 0, itemsCraftedSession: 0 };
  
  // Global voice cooldown - prevents rapid-fire voice messages
  private lastVoiceMessage: number = 0;
  private voiceMessageCooldown: number = 25000; // 25 seconds between ANY voice messages

  // Twitch chat rate limiting (separate from dashboard)
  private lastTwitchMessage: number = 0;
  private twitchMessageCooldown: number = 45000; // 45 seconds between Twitch messages (much slower!)
  private twitchMessageCount: number = 0;

  // Streaming integration (Twitch/X chat)
  private twitchClient: TwitchClient | null = null;
  private xClient: XClient | null = null;
  private chatManager: ChatManager | null = null;
  private chatResponder: ChatResponder | null = null;

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

    // Register item pickup callback for visual notifications
    if (config.game.mode === 'minecraft') {
      minecraftGame.onItemPickup((itemName, displayName, count) => {
        this.wsServer.broadcastItemPickup({
          itemName,
          displayName,
          count,
        });
        
        // Track for contextual idle messages
        this.recentEvents.lastMinedItem = { name: displayName, count, time: Date.now() };
        this.recentEvents.blocksMinedSession += count;
      });

      // Register craft callback for visual notifications
      minecraftGame.onItemCraft((itemName, displayName, count) => {
        logger.info('[CRAFT-NOTIFY] Broadcasting craft notification', { itemName, displayName, count });
        this.wsServer.broadcastItemCraft({
          itemName,
          displayName,
          count,
        });
        
        // Track for contextual idle messages
        this.recentEvents.lastCraftedItem = { name: displayName, count, time: Date.now() };
        this.recentEvents.itemsCraftedSession += count;
        
        // Generate streamer message for exciting crafts
        const excitingItems = ['diamond', 'iron', 'gold', 'netherite', 'pickaxe', 'sword', 'axe'];
        if (excitingItems.some(e => itemName.includes(e))) {
          this.generateStreamerMessage({
            event: 'success',
            details: `Just crafted ${count}x ${displayName}!`,
            emotion: 'excitement',
          });
        }
      });

      // Register death callback - RESET AI state on death
      minecraftGame.onDeath(() => {
        logger.warn('[DEATH] Bot died! Resetting AI brain state...');
        aiBrain.resetHistory();
        
        // CRITICAL: Clear batch action - can't continue old actions after death!
        if (this.batchAction) {
          logger.warn('[DEATH] Clearing batch action', { type: this.batchAction.type, target: this.batchAction.target });
          this.batchAction = null;
          gameManager.exitBatchMode();
        }
        
        // Track for contextual idle messages
        this.recentEvents.lastDeath = Date.now();
        
        // Broadcast death event to frontend for stats + celebration
        this.wsServer.broadcastDeath();
        
        // Generate frustrated streamer message
        this.generateStreamerMessage({
          event: 'failure',
          details: 'I just died! Lost all my stuff. Starting over.',
          emotion: 'frustration',
        });
      });

      // Register respawn callback - fresh start message
      minecraftGame.onRespawn(() => {
        logger.info('[RESPAWN] Bot respawned - fresh start!');
        
        // Broadcast respawn to clear death state on frontend
        this.wsServer.broadcastRespawn();
        
        // Generate determined message about starting fresh
        this.generateStreamerMessage({
          event: 'milestone',
          details: 'Respawned! Time to get back on the grind. Need wood, tools, everything.',
          emotion: 'determination',
        });
      });

      // Register state change callback - immediate UI updates for health/inventory
      minecraftGame.onStateChange(async () => {
        try {
          const gameState = gameManager.getState();
          const health = (gameState.metadata as any)?.health;
          logger.info(`[STATE-CHANGE] Broadcasting state update health=${health}`);
          this.wsServer.broadcastGameState(gameState);
          
          // Also broadcast held item
          const currentHeldItem = minecraftGame.getHeldItem();
          this.wsServer.broadcastHeldItem({
            name: currentHeldItem.name,
            displayName: currentHeldItem.displayName,
            action: 'idle',
          });
        } catch (error: any) {
          logger.error('[STATE-CHANGE] Failed to broadcast', { error: error.message });
        }
      });

      // Register UNDER ATTACK callback - immediate survival response
      minecraftGame.onUnderAttack((damage, health, attacker) => {
        logger.warn(`[UNDER-ATTACK] Taking damage! damage=${damage.toFixed(1)} health=${health.toFixed(1)} attacker=${attacker}`);
        
        // Clear any batch action - survival trumps everything
        if (this.batchAction) {
          logger.warn('[UNDER-ATTACK] Interrupting batch action for survival!');
          this.batchAction = null;
          gameManager.exitBatchMode();
        }
        
        // Generate panicked streamer message
        this.speakText(`${attacker ? attacker + ' attacking!' : 'Taking damage!'} Need to run!`);
        
        // Broadcast danger emotion
        emotionManager.trigger({ type: 'danger', intensity: 90, source: `Under attack by ${attacker}` });
        this.wsServer.broadcastEmotion(emotionManager.getState());
      });
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

    // Send greeting to viewers
    setTimeout(() => {
      this.generateStreamerMessage({
        event: 'milestone',
        details: 'Just connected to the Minecraft server! Starting a new session.',
        emotion: 'excitement',
      });
    }, 3000); // Small delay to let everything settle

    // Start idle message loop to keep stream engaging
    this.startIdleMessageLoop();
    logger.info('[STREAMER] Idle message loop started');

    // Initialize streaming integrations (Twitch/X chat)
    if (streamingConfig.enabled) {
      try {
        const streaming = await initializeStreaming(streamingConfig, this.wsServer);
        this.twitchClient = streaming.twitchClient;
        this.xClient = streaming.xClient;
        this.chatManager = streaming.chatManager;
        this.chatResponder = streaming.chatResponder;
        
        logger.info('📺 Streaming integrations initialized', {
          twitch: !!this.twitchClient,
          x: !!this.xClient,
        });
      } catch (error) {
        logger.error('Failed to initialize streaming integrations', { error });
        // Continue without streaming - not fatal
      }
    } else {
      logger.info('Streaming integrations disabled (set CHAT_INTEGRATION_ENABLED=true to enable)');
    }
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

    if (this.idleMessageInterval) {
      clearInterval(this.idleMessageInterval);
      this.idleMessageInterval = null;
    }

    // Shutdown streaming integrations
    if (this.twitchClient || this.xClient) {
      shutdownStreaming(this.twitchClient, this.xClient);
    }

    // Save viewer memory
    viewerMemory.shutdown();

    // Close WebSocket server
    this.wsServer.close();

    // Shutdown game
    await gameManager.shutdown();
  }

  /**
   * Generate an AI-powered streamer message
   * Uses the chat model to create engaging, dynamic messages
   */
  private async generateStreamerMessage(context: {
    event: 'decision' | 'success' | 'failure' | 'pickup' | 'danger' | 'milestone' | 'idle';
    details: string;
    emotion?: string;
    askQuestion?: boolean;
  }): Promise<void> {
    // Check cooldown
    const now = Date.now();
    if (now - this.lastStreamerMessage < this.streamerMessageCooldown) {
      return;
    }

    // Periodically ask viewers for advice
    this.messagesSinceLastQuestion++;
    const shouldAskQuestion = context.askQuestion || this.messagesSinceLastQuestion >= 8;
    if (shouldAskQuestion) {
      this.messagesSinceLastQuestion = 0;
    }

    const prompt = `You are NeuralTau, an AI streamer playing Minecraft live. Generate a SHORT, engaging message (1-2 sentences max) for your viewers.

PERSONALITY: Energetic like Speed/xQc, genuine reactions, sometimes asks chat for advice, celebrates wins, gets frustrated at failures but stays entertaining.

CURRENT EVENT: ${context.event}
DETAILS: ${context.details}
${context.emotion ? `FEELING: ${context.emotion}` : ''}
${shouldAskQuestion ? 'ASK VIEWERS: Include a question asking for their opinion or advice!' : ''}
${this.lastMessageText ? `PREVIOUS MESSAGE (DO NOT repeat similar phrasing): "${this.lastMessageText}"` : ''}

CRITICAL RULES:
- Be concise and punchy (under 100 characters ideal)
- VARY your sentence openers - NEVER repeat the same opener twice in a row
- DO NOT start with "Boom" or similar catchphrases repeatedly
- Use diverse expressions: "Yo", "Okay so", "Wait", "Alright", "Dude", "Oh", "Finally", "Nah", etc.
- Sound natural, like a real streamer with personality
- React genuinely to what happened
- NO emojis in the text
- NO em dashes (—), only use regular dashes (-) if needed
- If asking a question, make it specific to the situation

Respond with ONLY the message, nothing else.`;

    try {
      const response = await openRouterClient.chat([
        { role: 'user', content: prompt }
      ], { model: config.ai.chatModel, maxTokens: 100 });

      if (response?.content) {
        const messageText = response.content.trim().replace(/—/g, '-'); // Replace em dashes
        this.wsServer.broadcastStreamerMessage({
          text: messageText,
          type: this.getMessageType(context.event),
          context: context.details,
        });
        this.lastStreamerMessage = now;
        this.lastMessageText = messageText;

        // Send to Twitch chat if connected (rate limited - not every message!)
        if (this.twitchClient?.getIsConnected() && this.canSendToTwitch()) {
          this.twitchClient.sendMessage(messageText);
          this.lastTwitchMessage = Date.now();
          this.twitchMessageCount++;
          logger.debug('[TWITCH] Sent streamer message to chat');
        }

        // Generate voice if enabled - USE SAME TEXT for consistency (no separate generation)
        if (config.voice.streamerVoiceEnabled && elevenLabsClient.isConfigured()) {
          await this.speakText(messageText);
        }
      }
    } catch (error) {
      logger.debug('Failed to generate streamer message', { error });
    }
  }

  /**
   * Check if we can send a message to Twitch (rate limited)
   * Only allows 1 message every 45 seconds to avoid spam
   */
  private canSendToTwitch(): boolean {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastTwitchMessage;
    return timeSinceLastMessage >= this.twitchMessageCooldown;
  }

  private getMessageType(event: string): 'thought' | 'reaction' | 'question' | 'excitement' | 'frustration' | 'greeting' {
    switch (event) {
      case 'success':
      case 'milestone':
      case 'pickup':
        return 'excitement';
      case 'failure':
      case 'danger':
        return 'frustration';
      case 'decision':
        return 'thought';
      default:
        return 'reaction';
    }
  }

  /**
   * Unified voice output - respects global cooldown for consistency
   * Uses the SAME text as chat for coherent messaging
   * Includes collision markers for commentary system
   * Now supports emotion-based voice modulation!
   */
  private async speakText(text: string): Promise<void> {
    const now = Date.now();
    
    // Check global voice cooldown - prevents rapid-fire conflicting messages
    if (now - this.lastVoiceMessage < this.voiceMessageCooldown) {
      logger.debug('[VOICE] Skipping - voice cooldown active', {
        timeSinceLastVoice: Math.round((now - this.lastVoiceMessage) / 1000) + 's',
        cooldown: Math.round(this.voiceMessageCooldown / 1000) + 's'
      });
      return;
    }

    try {
      // Mark voice as starting for commentary collision prevention
      markVoiceStart();
      
      // Get current emotional state for voice modulation
      const emotionalState = emotionManager.getState();
      const emotion = emotionalState.dominant as any;
      const intensity = emotionalState.dominantIntensity;
      
      // Generate speech with emotion modulation
      const audioBuffer = await elevenLabsClient.textToSpeech(text, {
        emotion,
        intensity,
      });
      
      const audioBase64 = audioBuffer.toString('base64');
      this.wsServer.broadcastAudio(audioBase64);
      this.lastVoiceMessage = now;
      logger.info('[VOICE] Broadcast', { 
        text: text.substring(0, 50),
        emotion,
        intensity: Math.round(intensity),
      });
      
      // Estimate voice duration (rough: 100ms per character) and mark end
      const estimatedDuration = Math.min(text.length * 100, 10000);
      setTimeout(() => markVoiceEnd(), estimatedDuration);
    } catch (error) {
      markVoiceEnd();
      logger.debug('[VOICE] Failed to generate speech', { error });
    }
  }

  /**
   * Start the idle message loop - keeps the stream alive with chatter
   */
  private startIdleMessageLoop(): void {
    // Generate idle messages every 35-45 seconds when nothing is happening
    this.idleMessageInterval = setInterval(async () => {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastStreamerMessage;
      
      // Only generate if no message in last 30 seconds
      if (timeSinceLastMessage < 30000) return;
      
      // Get current game state for context
      const gameState = await gameManager.getState();
      
      await this.generateIdleMessage(gameState);
    }, 40000); // Check every 40 seconds (was 25)
  }

  /**
   * Generate random idle/filler messages to keep stream engaging
   */
  private async generateIdleMessage(gameState: any): Promise<void> {
    const now = Date.now();
    
    // Check BOTH cooldowns to prevent overlapping with streamer messages
    if (now - this.lastIdleMessage < 30000) return; // 30s minimum between idle messages
    if (now - this.lastStreamerMessage < 25000) return; // Don't idle if recent streamer message
    if (now - this.lastVoiceMessage < this.voiceMessageCooldown) return; // Respect voice cooldown
    
    // Get actual time and weather from metadata
    const meta = gameState.metadata || {};
    const timeOfDay = meta.time || 'day';
    const weather = meta.weather || 'clear';
    
    // Build gameplay context for more natural messages
    const recentMined = this.recentEvents.lastMinedItem;
    const recentCrafted = this.recentEvents.lastCraftedItem;
    const recentDeath = this.recentEvents.lastDeath;
    const timeSinceMined = recentMined ? Math.floor((now - recentMined.time) / 1000) : null;
    const timeSinceCrafted = recentCrafted ? Math.floor((now - recentCrafted.time) / 1000) : null;
    const timeSinceDeath = recentDeath ? Math.floor((now - recentDeath) / 1000) : null;
    
    // Get inventory highlights
    const inventory = meta.inventory || [];
    const hasPickaxe = inventory.some((i: any) => i.name?.includes('pickaxe'));
    const hasSword = inventory.some((i: any) => i.name?.includes('sword'));
    const logCount = inventory.filter((i: any) => i.name?.includes('log')).reduce((sum: number, i: any) => sum + (i.count || 0), 0);
    
    // Randomly decide message style - 40% gameplay aware, 60% random streamer talk
    const useGameplayContext = Math.random() < 0.4 && (timeSinceMined || timeSinceCrafted || timeSinceDeath);
    
    const idlePrompt = `You are NeuralTau, an AI streamer playing Minecraft. Generate a casual message for viewers.

PERSONALITY: Like Speed or PewDiePie - energetic, random, genuine. Mix gameplay awareness with random life talk.
TIME: ${timeOfDay} | WEATHER: ${weather}

${useGameplayContext ? `
=== GAMEPLAY CONTEXT MODE ===
Recent events to maybe reference:
${timeSinceMined && timeSinceMined < 120 ? `- Just got ${recentMined!.count}x ${recentMined!.name}` : ''}
${timeSinceCrafted && timeSinceCrafted < 180 ? `- Just crafted ${recentCrafted!.name}` : ''}
${timeSinceDeath && timeSinceDeath < 300 ? `- Died recently, still salty` : ''}

IDEAS: "that craft was clean", "finally got some wood", "what should I name this?", comment on progress
` : `
=== RANDOM STREAMER TALK MODE ===
Talk about ANYTHING except the game:
- CHAT QUESTIONS (use often!): "${getChatQuestion()}", "what's the move chat?", "you guys seeing this?"
- Random life question: "yo chat, you ever think about..."
- Food: "what y'all eating right now?", "I'm hungry af"
- Music: "what song should we play?", "this beat goes hard"
- Viewers: "appreciate y'all being here fr", "lurkers say hi"
- Random thoughts: "bro I just realized...", "okay but hear me out"
- Hype: "we locked in today", "this is the one"
- Engagement: "type 1 if you're vibing", "W or L chat?", "rate my gameplay"
- Weather/vibe: "${timeOfDay === 'night' ? 'night streams hit different' : 'good vibes today'}"
`}

RULES:
- Keep it SHORT (under 50 chars)
- Sound natural, like a real streamer
- Be random and unpredictable
- NO em dashes, only regular dashes
- You can swear naturally

${this.lastMessageText ? `PREVIOUS (don't repeat): "${this.lastMessageText}"` : ''}

Respond with ONLY the message.`;

    try {
      const response = await openRouterClient.chat([
        { role: 'user', content: idlePrompt }
      ], { model: config.ai.chatModel, maxTokens: 60 });

      if (response?.content) {
        const messageText = response.content.trim().replace(/—/g, '-').replace(/"/g, '');
        
        this.lastStreamerMessage = now;
        this.lastIdleMessage = now;
        this.lastMessageText = messageText;
        
        // Send idle messages to Twitch chat (rate limited)
        if (this.twitchClient?.checkConnected() && this.canSendToTwitch()) {
          this.twitchClient.sendMessage(messageText);
          this.lastTwitchMessage = Date.now();
          this.twitchMessageCount++;
          logger.debug('[TWITCH] Sent idle message to chat');
        }

        // Also broadcast to dashboard
        this.wsServer.broadcastStreamerMessage({
          text: messageText,
          type: 'thought',
          context: 'idle chatter',
        });
        
        // Voice if enabled - uses unified speakText for cooldown coordination
        if (config.voice.streamerVoiceEnabled && elevenLabsClient.isConfigured()) {
          await this.speakText(messageText);
        }
      }
    } catch (error) {
      logger.debug('[STREAMER] Failed to generate idle message', { error });
    }
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

      // === EMERGENCY HEALTH CHECK ===
      // Check if we need to emergency flee BEFORE any other logic
      const healthAlert = minecraftGame.getHealthAlertInfo();
      
      // Skip forced flee for environmental damage (drowning, lava, fire, suffocation)
      // The bot's emergencyEscape() already handles these correctly (swim up, etc.)
      const shouldForceFlee = (healthAlert.emergencyFlee || healthAlert.isUnderAttack) && 
                              !healthAlert.isEnvironmentalDamage;
      
      if (shouldForceFlee) {
        logger.warn('[EMERGENCY] Health alert detected!', {
          isUnderAttack: healthAlert.isUnderAttack,
          recentDamage: healthAlert.recentDamage.toFixed(1),
          currentHealth: healthAlert.currentHealth.toFixed(1),
          attacker: healthAlert.attacker,
          nearbyHostiles: healthAlert.nearbyHostiles.length,
          damageSource: healthAlert.damageSource,
        });
        
        // Clear batch action - survival is priority
        if (this.batchAction) {
          logger.warn('[EMERGENCY] Clearing batch action for survival');
          this.batchAction = null;
          gameManager.exitBatchMode();
        }
        
        // Clear the emergency flag so we only respond once
        minecraftGame.clearEmergencyFlee();
        
        // Force flee action - don't even ask AI, just run!
        const fleeAction: import('@tau/shared').GameAction = {
          type: 'move',
          target: 'away_from_danger',
          reasoning: `EMERGENCY FLEE: Under attack by ${healthAlert.attacker || 'unknown'}, HP=${healthAlert.currentHealth.toFixed(0)}`,
        };
        
        logger.warn('[EMERGENCY] Forcing flee action', { action: fleeAction });
        
        // Execute flee
        try {
          const result = await gameManager.executeAction(fleeAction);
          logger.info('[EMERGENCY] Flee result', { result });
          
          // Speak about the danger
          this.speakText(`Oh no, ${healthAlert.attacker || 'something'} is attacking me! Running!`);
        } catch (error) {
          logger.error('[EMERGENCY] Flee failed', { error });
        }
        
        // End this cycle early - survival first
        this.decisionInFlight = false;
        return;
      }
      
      // For environmental damage, just log and let emergencyEscape() handle it
      if (healthAlert.isEnvironmentalDamage && healthAlert.emergencyFlee) {
        logger.warn('[EMERGENCY] Environmental damage detected - emergencyEscape() handling it', {
          damageSource: healthAlert.damageSource,
          currentHealth: healthAlert.currentHealth.toFixed(1),
        });
        minecraftGame.clearEmergencyFlee();
        // Don't return - continue the decision cycle, the bot is already swimming/escaping
      }

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

      // Entertainment mode: occasionally override actions for fun/engagement
      const entertainmentOverride = maybeOverrideAction(
        { type: action.type, target: action.target },
        {
          health: (gameState.metadata as any)?.health,
          time: minecraftGame.getTimeOfDay(),
          nearbyEntities: (gameState.metadata as any)?.nearbyEntities,
        }
      );
      
      if (entertainmentOverride) {
        logger.info('[ENTERTAINMENT] Overriding action for engagement', {
          original: action.type,
          new: entertainmentOverride.action.type,
        });
        action = {
          type: entertainmentOverride.action.type as import('@tau/shared').GameAction['type'],
          target: entertainmentOverride.action.target,
          reasoning: entertainmentOverride.action.reasoning,
        };
        // Speak the entertainment commentary
        this.speakText(entertainmentOverride.commentary);
        if (this.twitchClient?.checkConnected()) {
          this.twitchClient.sendMessage(entertainmentOverride.commentary);
        }
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
      } else if (action.type === 'attack') {
        this.wsServer.broadcastActivity({ type: 'attacking', item: action.target, active: true });
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
      if (action.type === 'craft' || action.type === 'mine' || action.type === 'attack') {
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

      // Generate action commentary (with voice collision prevention)
      const commentaryPhase = isSuccess ? 'success' : isFailure ? 'fail' : 'start';
      const actionCommentary = generateActionCommentary(
        action.type,
        action.target,
        commentaryPhase,
        {
          health: meta?.health,
          time: minecraftGame.getTimeOfDay(),
          emotion: emotionalState.dominant,
          consecutiveFailures: aiBrain.getConsecutiveFailures?.() || 0,
        }
      );
      
      // If we have commentary and no voice collision, speak it
      if (actionCommentary) {
        logger.info('[COMMENTARY] Action commentary', { commentary: actionCommentary });
        this.speakText(actionCommentary);
        
        // Also send to Twitch chat if connected
        if (this.twitchClient?.checkConnected()) {
          this.twitchClient.sendMessage(actionCommentary);
        }
      }

      // Generate AI streamer message based on what happened
      const wasSuccessful = !result.toLowerCase().includes('failed') && 
                            !result.toLowerCase().includes("couldn't") &&
                            !result.toLowerCase().includes('cannot');
      const isDanger = emotionalState.dominant === 'fear' || 
                      meta?.health < 8 ||
                      meta?.nearbyEntities?.some((e: string) => ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.toLowerCase()));
      
      // Generate message for significant events (not every action)
      if (emotionalState.dominantIntensity > 50 || isDanger || (!wasSuccessful && consecutiveFailures >= 2)) {
        this.generateStreamerMessage({
          event: isDanger ? 'danger' : wasSuccessful ? 'success' : 'failure',
          details: `${action.type} ${action.target || ''}: ${result.substring(0, 80)}`,
          emotion: emotionalState.dominant,
          askQuestion: consecutiveFailures >= 3, // Ask chat for help when stuck
        });
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
