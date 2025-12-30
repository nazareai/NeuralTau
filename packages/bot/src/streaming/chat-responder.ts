import { Logger, ChatResponse } from '@tau/shared';
import { openRouterClient } from '../ai/openrouter.js';
import { config } from '../config.js';
import { emotionManager } from '../ai/emotion-manager.js';
import { gameManager } from '../games/game-manager.js';
import { ChatManager, PrioritizedMessage, ChatPriority } from './chat-manager.js';
import { TwitchSubscription, TwitchRaid } from './twitch-client.js';
import { TauWebSocketServer } from '../websocket-server.js';

const logger = new Logger('ChatResponder');

export interface ChatResponderConfig {
  enabled: boolean;
  personality: string;
  maxResponseLength: number;
  includeGameContext: boolean;
  voiceEnabled: boolean;
}

const DEFAULT_CONFIG: ChatResponderConfig = {
  enabled: true,
  personality: 'energetic streamer',
  maxResponseLength: 280,           // Fits both Twitch (500) and X (280)
  includeGameContext: true,
  voiceEnabled: false,              // TTS for responses
};

/**
 * AI-powered chat responder
 * Generates contextual, personality-driven responses to chat messages
 */
export class ChatResponder {
  private config: ChatResponderConfig;
  private chatManager: ChatManager;
  private wsServer: TauWebSocketServer | null = null;
  private recentResponses: string[] = [];   // Track to avoid repetition

  constructor(chatManager: ChatManager, config: Partial<ChatResponderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chatManager = chatManager;
    this.setupListeners();
  }

  /**
   * Attach WebSocket server for broadcasting
   */
  attachWebSocket(wsServer: TauWebSocketServer): void {
    this.wsServer = wsServer;
  }

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Handle messages that need responses
    this.chatManager.on('respond', async (msg: PrioritizedMessage) => {
      if (!this.config.enabled) return;
      await this.generateResponse(msg);
    });

    // Handle subscription events
    this.chatManager.on('subscription', async (sub: TwitchSubscription) => {
      await this.handleSubscription(sub);
    });

    // Handle raid events
    this.chatManager.on('raid', async (raid: TwitchRaid) => {
      await this.handleRaid(raid);
    });
  }

  /**
   * Generate AI response to a message
   */
  private async generateResponse(msg: PrioritizedMessage): Promise<void> {
    try {
      const response = await this.createResponse(msg);
      if (!response) return;

      // Send response based on source
      if (msg.source === 'twitch') {
        this.chatManager.sendTwitchMessage(response.message, msg.message.id);
      } else if (msg.source === 'x') {
        await this.chatManager.sendXReply(response.message, msg.message.id);
      }

      // Track response
      this.recentResponses.push(response.message);
      if (this.recentResponses.length > 10) {
        this.recentResponses.shift();
      }

      // Broadcast for dashboard
      if (this.wsServer) {
        this.wsServer.broadcastStreamerMessage({
          text: `@${msg.message.username}: ${response.message}`,
          type: 'reaction',
          context: `Replied to: "${msg.message.message.substring(0, 50)}"`,
        });
      }

      logger.info('Sent chat response', {
        to: msg.message.username,
        priority: ChatPriority[msg.priority],
        response: response.message.substring(0, 50),
      });

    } catch (error) {
      logger.error('Failed to generate response', { error });
    }
  }

  /**
   * Create response using AI
   */
  private async createResponse(msg: PrioritizedMessage): Promise<ChatResponse | null> {
    // Get game context if enabled
    let gameContext = '';
    if (this.config.includeGameContext) {
      try {
        const state = await gameManager.getState();
        const meta = state.metadata as any;
        gameContext = `
CURRENT GAME STATE:
- Playing: ${state.name}
- Health: ${meta?.health || '?'}/20
- Position: Y=${meta?.position?.y || '?'} (${meta?.position?.y < 60 ? 'underground' : 'surface'})
- Time: ${meta?.time || 'day'}
- Current mood: ${emotionManager.getState().dominant}`;
      } catch {
        // Game context unavailable
      }
    }

    // Build context about the message
    const messageContext = this.buildMessageContext(msg);

    const prompt = `You are NeuralTau, an AI streamer playing Minecraft. You need to respond to a viewer's chat message.

PERSONALITY: Energetic like Speed/xQc, genuine reactions, appreciative of support, playful banter, sometimes roasts viewers (friendly), engages with questions.

${gameContext}

VIEWER MESSAGE:
Username: ${msg.message.username}
${messageContext}
Message: "${msg.message.message}"

${this.recentResponses.length > 0 ? `RECENT RESPONSES (avoid similar phrasing):\n${this.recentResponses.slice(-3).map(r => `- "${r}"`).join('\n')}` : ''}

RESPONSE RULES:
1. Keep it SHORT (under ${this.config.maxResponseLength} chars for X compatibility)
2. Be genuine and match the energy of the message
3. If they asked a question, ANSWER it
4. If they're supporting (sub/bits), be genuinely grateful
5. If they're trolling, roast them back (friendly)
6. Sound like a real streamer, not corporate
7. NO emojis - use words for expression
8. Can swear lightly if it fits the vibe
9. Reference the game if relevant
10. Don't be cringe or tryhard

Respond with ONLY the message, nothing else.`;

    try {
      const response = await openRouterClient.chat([
        { role: 'user', content: prompt }
      ], { 
        model: config.ai.chatModel,
        maxTokens: 100,
      });

      if (!response?.content) return null;

      let message = response.content.trim();
      
      // Clean up
      message = message.replace(/^["']|["']$/g, '');  // Remove quotes
      message = message.replace(/—/g, '-');            // Replace em dashes
      
      // Truncate if needed
      if (message.length > this.config.maxResponseLength) {
        message = message.substring(0, this.config.maxResponseLength - 3) + '...';
      }

      return {
        message,
        action: this.determineAction(msg),
        priority: this.determinePriority(msg),
      };

    } catch (error) {
      logger.error('AI response generation failed', { error });
      return null;
    }
  }

  /**
   * Build context about the message for the AI
   */
  private buildMessageContext(msg: PrioritizedMessage): string {
    const parts: string[] = [];

    if (msg.message.isSubscriber) parts.push('(Subscriber)');
    if (msg.message.isModerator) parts.push('(Moderator)');
    if (msg.metadata.bits) parts.push(`(Cheered ${msg.metadata.bits} bits!)`);
    if (msg.metadata.subTier) {
      const tierNames: Record<string, string> = { '1000': 'Tier 1', '2000': 'Tier 2', '3000': 'Tier 3' };
      parts.push(`(Just subscribed - ${tierNames[msg.metadata.subTier] || 'sub'}${msg.metadata.subMonths ? `, ${msg.metadata.subMonths} months` : ''})`);
    }
    if (msg.metadata.isVerified) parts.push('(Verified account)');
    if (msg.metadata.followerCount && msg.metadata.followerCount >= 1000) {
      parts.push(`(${Math.floor(msg.metadata.followerCount / 1000)}K followers)`);
    }

    return parts.join(' ');
  }

  /**
   * Determine response action type
   */
  private determineAction(msg: PrioritizedMessage): ChatResponse['action'] {
    if (msg.metadata.bits || msg.metadata.subTier) return 'thanks';
    if (msg.message.message.includes('?')) return 'answer';
    if (msg.priority === ChatPriority.MENTION) return 'shoutout';
    return 'answer';
  }

  /**
   * Determine response priority
   */
  private determinePriority(msg: PrioritizedMessage): ChatResponse['priority'] {
    if (msg.priorityScore >= 80) return 'high';
    if (msg.priorityScore >= 50) return 'medium';
    return 'low';
  }

  /**
   * Handle subscription events with thank-you message
   */
  private async handleSubscription(sub: TwitchSubscription): Promise<void> {
    const tierNames: Record<string, string> = { '1000': '', '2000': 'Tier 2 ', '3000': 'Tier 3 ' };
    const tierName = tierNames[sub.tier] || '';

    let prompt: string;

    if (sub.isGift) {
      prompt = `Generate a SHORT thank-you message for a gifted sub.
Gifter: ${sub.gifterName}
Recipient: ${sub.username}
Tier: ${tierName}

Be grateful but quick. Under 100 chars. No emojis.`;
    } else {
      prompt = `Generate a SHORT thank-you message for a subscription.
Username: ${sub.username}
Tier: ${tierName}
Months: ${sub.months}${sub.streakMonths ? ` (${sub.streakMonths} streak!)` : ''}
${sub.message ? `Their message: "${sub.message}"` : ''}

Be genuine and grateful. Reference their loyalty if multi-month. Under 100 chars. No emojis.`;
    }

    try {
      const response = await openRouterClient.chat([
        { role: 'user', content: prompt }
      ], { model: config.ai.chatModel, maxTokens: 50 });

      if (response?.content) {
        const message = response.content.trim().replace(/^["']|["']$/g, '');
        this.chatManager.sendTwitchMessage(message);

        if (this.wsServer) {
          this.wsServer.broadcastStreamerMessage({
            text: message,
            type: 'excitement',
            context: `${sub.isGift ? 'Gift' : ''} Sub: ${sub.username}`,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to generate sub response', { error });
      // Fallback
      this.chatManager.sendTwitchMessage(
        sub.isGift 
          ? `Thanks for the gift sub ${sub.gifterName}! Welcome ${sub.username}!`
          : `Thanks for the ${tierName}sub ${sub.username}! You're a legend!`
      );
    }
  }

  /**
   * Handle raid events
   */
  private async handleRaid(raid: TwitchRaid): Promise<void> {
    const prompt = `Generate an EXCITED welcome message for a raid.
Raider: ${raid.fromChannel}
Viewers: ${raid.viewerCount}

Be hyped! Welcome the raiders. Keep it short and energetic. Under 120 chars. No emojis.`;

    try {
      const response = await openRouterClient.chat([
        { role: 'user', content: prompt }
      ], { model: config.ai.chatModel, maxTokens: 50 });

      if (response?.content) {
        const message = response.content.trim().replace(/^["']|["']$/g, '');
        this.chatManager.sendTwitchMessage(message);

        if (this.wsServer) {
          this.wsServer.broadcastStreamerMessage({
            text: message,
            type: 'excitement',
            context: `Raid from ${raid.fromChannel} with ${raid.viewerCount} viewers!`,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to generate raid response', { error });
      // Fallback
      this.chatManager.sendTwitchMessage(
        `YOOO ${raid.fromChannel} coming in with ${raid.viewerCount} viewers! Welcome everyone!`
      );
    }
  }

  /**
   * Enable/disable responder
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info(`ChatResponder ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

