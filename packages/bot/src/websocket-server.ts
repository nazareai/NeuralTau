import { WebSocketServer, WebSocket } from 'ws';
import { Logger } from '@tau/shared';
import type { GameState, GameAction, Decision, EmotionalState } from '@tau/shared';

const logger = new Logger('WebSocket');

export interface BroadcastEvent {
  type: 'gameState' | 'decision' | 'action' | 'result' | 'stats' | 'thinking' | 'emotion' | 'activity' | 'config' | 'heldItem' | 'itemPickup' | 'streamerMessage' | 'viewerChat' | 'donationAlert' | 'damage' | 'miningProgress' | 'craftingProgress';
  timestamp: Date;
  data: any;
}

export interface ViewerChatMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  platform: 'twitch' | 'x';
  badges: {
    subscriber?: boolean;
    moderator?: boolean;
    vip?: boolean;
    verified?: boolean;
  };
  bits?: number;
  subTier?: string;
  subMonths?: number;
  isBot?: boolean;
}

export interface DonationAlert {
  type: 'subscription' | 'bits' | 'raid' | 'follow' | 'gift';
  username: string;
  displayName: string;
  amount?: number;          // bits amount or sub tier (1000/2000/3000)
  message?: string;         // custom message if any
  months?: number;          // for subs
  giftCount?: number;       // for gift subs
  viewerCount?: number;     // for raids
}

export class TauWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private port: number;

  constructor(port: number = 3002) {
    this.port = port;
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('New client connected', {
        totalClients: this.clients.size + 1,
      });

      this.clients.add(ws);

      // Send welcome message with config
      const spectatorEnabled = process.env.SPECTATOR_BOT_ENABLED === 'true';
      const viewerPort = spectatorEnabled
        ? parseInt(process.env.SPECTATOR_BOT_VIEWER_PORT || '3008')
        : 3007;

      this.sendToClient(ws, {
        type: 'connected',
        message: 'Connected to NeuralTau Bot',
        config: {
          viewerPort,
          spectatorEnabled,
        },
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('Client disconnected', {
          totalClients: this.clients.size,
        });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error: error.message });
        this.clients.delete(ws);
      });
    });

    logger.info('WebSocket server started', { port: this.port });
  }

  /**
   * Broadcast game state update
   */
  broadcastGameState(gameState: GameState) {
    this.broadcast({
      type: 'gameState',
      timestamp: new Date(),
      data: gameState,
    });
  }

  /**
   * Broadcast AI decision
   */
  broadcastDecision(decision: {
    reasoning: string;
    action: GameAction;
    gameState: GameState;
  }) {
    this.broadcast({
      type: 'decision',
      timestamp: new Date(),
      data: decision,
    });
  }

  /**
   * Broadcast action result
   */
  broadcastResult(result: {
    action: GameAction;
    outcome: string;
    newState: GameState;
  }) {
    this.broadcast({
      type: 'result',
      timestamp: new Date(),
      data: result,
    });
  }

  /**
   * Broadcast stats update
   */
  broadcastStats(stats: {
    score: number;
    moves: number;
    inventory: string[];
    currentRoom: string;
  }) {
    this.broadcast({
      type: 'stats',
      timestamp: new Date(),
      data: stats,
    });
  }

  /**
   * Broadcast thinking status (when AI is using deep thinking mode)
   */
  broadcastThinking(isThinking: boolean, mode?: 'fast' | 'advanced') {
    this.broadcast({
      type: 'thinking',
      timestamp: new Date(),
      data: {
        isThinking,
        mode,
      },
    });
  }

  /**
   * Broadcast emotional state update
   */
  broadcastEmotion(emotionalState: EmotionalState) {
    this.broadcast({
      type: 'emotion',
      timestamp: new Date(),
      data: emotionalState,
    });
  }

  /**
   * Broadcast activity status (crafting, smelting, attacking, etc.)
   * Used to show visual indicators in the UI - keeps viewers engaged!
   */
  broadcastActivity(activity: {
    type: 'crafting' | 'smelting' | 'mining' | 'attacking' | 'idle' |
          'shooting' | 'fishing' | 'enchanting' | 'breeding' | 'harvesting' |
          'planting' | 'farming' | 'trading' | 'building portal' | 'building' |
          'defending' | 'branch mining' | 'sleeping' | 'organizing' | 'getting items';
    item?: string;
    active: boolean;
  }) {
    this.broadcast({
      type: 'activity',
      timestamp: new Date(),
      data: activity,
    });
  }

  /**
   * Broadcast held item for hand overlay display
   * Shows what item the bot is currently holding with action state
   */
  broadcastHeldItem(heldItem: {
    name: string | null;
    displayName: string | null;
    action: 'idle' | 'mining' | 'attacking' | 'eating' | 'placing' | 'crafting';
  }) {
    this.broadcast({
      type: 'heldItem',
      timestamp: new Date(),
      data: heldItem,
    });
  }

  /**
   * Broadcast item pickup notification for visual feedback
   * Shows floating "+X item" text on the frontend
   */
  broadcastItemPickup(pickup: {
    itemName: string;
    displayName: string;
    count: number;
  }) {
    this.broadcast({
      type: 'itemPickup',
      timestamp: new Date(),
      data: pickup,
    });
  }

  /**
   * Broadcast item craft notification for visual feedback
   * Shows crafting animation on the frontend
   */
  broadcastItemCraft(craft: {
    itemName: string;
    displayName: string;
    count: number;
  }) {
    this.broadcast({
      type: 'itemCraft',
      timestamp: new Date(),
      data: craft,
    });
  }

  /**
   * Broadcast streamer message for the chat panel
   * These are engaging messages from NeuralTau to viewers
   */
  broadcastStreamerMessage(message: {
    text: string;
    type: 'thought' | 'reaction' | 'question' | 'excitement' | 'frustration' | 'greeting';
    context?: string;
  }) {
    this.broadcast({
      type: 'streamerMessage',
      timestamp: new Date(),
      data: message,
    });
  }

  /**
   * Broadcast audio data for voice playback
   * Sends base64-encoded audio to frontend for playback
   */
  broadcastAudio(audioBase64: string) {
    this.broadcast({
      type: 'audio',
      timestamp: new Date(),
      data: { audio: audioBase64 },
    });
  }

  /**
   * Broadcast milestone celebration
   */
  broadcastMilestone(text: string, type: 'tool' | 'achievement' | 'death' = 'achievement') {
    this.broadcast({
      type: 'milestone',
      timestamp: new Date(),
      data: { text, type },
    });
  }

  /**
   * Broadcast damage event - triggers damage flash animation on frontend
   * Shows red screen flash and damage indicator
   */
  broadcastDamage(damage: {
    amount: number;
    source: string;
    currentHealth: number;
    maxHealth: number;
    isCritical: boolean;  // health < 6
  }) {
    this.broadcast({
      type: 'damage',
      timestamp: new Date(),
      data: damage,
    });
  }

  /**
   * Broadcast mining progress - shows mining progress bar on frontend
   */
  broadcastMiningProgress(progress: {
    blockName: string;
    displayName: string;
    progress: number;  // 0-100
    position: { x: number; y: number; z: number };
    isComplete: boolean;
  }) {
    this.broadcast({
      type: 'miningProgress',
      timestamp: new Date(),
      data: progress,
    });
  }

  /**
   * Broadcast crafting progress - shows crafting animation on frontend
   */
  broadcastCraftingProgress(crafting: {
    itemName: string;
    displayName: string;
    stage: 'start' | 'progress' | 'complete' | 'failed';
    ingredients?: string[];
  }) {
    this.broadcast({
      type: 'craftingProgress',
      timestamp: new Date(),
      data: crafting,
    });
  }

  /**
   * Broadcast death event - triggers dead avatar on frontend
   */
  broadcastDeath() {
    this.broadcast({
      type: 'death',
      timestamp: new Date(),
      data: { isDead: true },
    });
  }

  /**
   * Broadcast respawn event - clears dead state on frontend
   */
  broadcastRespawn() {
    this.broadcast({
      type: 'respawn',
      timestamp: new Date(),
      data: { isDead: false },
    });
  }

  /**
   * Broadcast viewer chat message
   * Shows what viewers are saying in Twitch/X chat
   */
  broadcastViewerChat(message: ViewerChatMessage) {
    this.broadcast({
      type: 'viewerChat',
      timestamp: new Date(),
      data: message,
    });
  }

  /**
   * Broadcast donation/sub/raid alert
   * Big flashy celebration for supporter events
   */
  broadcastDonationAlert(alert: DonationAlert) {
    this.broadcast({
      type: 'donationAlert',
      timestamp: new Date(),
      data: alert,
    });
  }

  /**
   * Broadcast to all connected clients
   */
  private broadcast(event: any) {
    const message = JSON.stringify(event);

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    logger.debug('Broadcasted event', {
      type: event.type,
      clients: this.clients.size,
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocket, data: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Wait for at least one client to connect
   * @param timeoutMs Maximum time to wait (default 60 seconds)
   * @returns true if client connected, false if timed out
   */
  waitForClient(timeoutMs: number = 60000): Promise<boolean> {
    return new Promise((resolve) => {
      // Already have a client
      if (this.clients.size > 0) {
        resolve(true);
        return;
      }

      const startTime = Date.now();

      // Check periodically for client connection
      const checkInterval = setInterval(() => {
        if (this.clients.size > 0) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

        // Check for timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }
      }, 100);
    });
  }

  /**
   * Close the WebSocket server
   */
  close() {
    this.clients.forEach((client) => {
      client.close();
    });

    this.wss.close(() => {
      logger.info('WebSocket server closed');
    });
  }
}
