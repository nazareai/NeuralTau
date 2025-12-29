import { WebSocketServer, WebSocket } from 'ws';
import { Logger } from '@tau/shared';
import type { GameState, GameAction, Decision, EmotionalState } from '@tau/shared';

const logger = new Logger('WebSocket');

export interface BroadcastEvent {
  type: 'gameState' | 'decision' | 'action' | 'result' | 'stats' | 'thinking' | 'emotion' | 'activity' | 'config' | 'heldItem';
  timestamp: Date;
  data: any;
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
   * Broadcast activity status (crafting, smelting, etc.)
   * Used to show visual indicators in the UI
   */
  broadcastActivity(activity: {
    type: 'crafting' | 'smelting' | 'mining' | 'idle';
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
    action: 'idle' | 'mining' | 'attacking' | 'eating' | 'placing';
  }) {
    this.broadcast({
      type: 'heldItem',
      timestamp: new Date(),
      data: heldItem,
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
