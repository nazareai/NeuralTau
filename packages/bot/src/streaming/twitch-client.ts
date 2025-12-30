import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { Logger, ChatMessage, Donation } from '@tau/shared';

const logger = new Logger('TwitchClient');

export interface TwitchConfig {
  accessToken: string;        // OAuth token
  refreshToken?: string;      // For token refresh
  clientId: string;           // Twitch app client ID
  clientSecret?: string;      // For token refresh
  channelName: string;        // Channel to join (e.g., 'neuraltau')
  botUsername: string;        // Bot's Twitch username
}

export interface TwitchEvent {
  type: 'chat' | 'subscription' | 'bits' | 'raid' | 'follow' | 'redemption';
  data: any;
}

export interface TwitchChatMessage extends ChatMessage {
  bits?: number;              // Bits attached to message
  isFirst?: boolean;          // First message ever in channel
  replyTo?: string;           // ID of message being replied to
  emotes?: string[];          // Emotes used
  color?: string;             // User's chat color
}

export interface TwitchSubscription {
  userId: string;
  username: string;
  tier: '1000' | '2000' | '3000'; // Prime/T1, T2, T3
  isGift: boolean;
  gifterName?: string;
  months: number;             // Total months
  streakMonths?: number;      // Consecutive months
  message?: string;
}

export interface TwitchBits {
  userId: string;
  username: string;
  bits: number;
  message: string;
  isAnonymous: boolean;
}

export interface TwitchRaid {
  fromChannel: string;
  viewerCount: number;
}

/**
 * Twitch IRC + EventSub client for chat and events
 * Uses tmi.js-style IRC for chat, EventSub WebSocket for events
 */
export class TwitchClient extends EventEmitter {
  private config: TwitchConfig;
  private ircWs: WebSocket | null = null;
  private eventSubWs: WebSocket | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private pingInterval: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;

  constructor(config: TwitchConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to Twitch IRC and EventSub
   */
  async connect(): Promise<void> {
    await Promise.all([
      this.connectIRC(),
      this.connectEventSub(),
    ]);
    this.isConnected = true;
    logger.info('Twitch client connected', { channel: this.config.channelName });
  }

  /**
   * Connect to Twitch IRC for chat
   */
  private async connectIRC(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ircWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

      this.ircWs.on('open', () => {
        logger.info('IRC WebSocket connected');
        
        // Authenticate
        this.ircWs!.send(`CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands`);
        this.ircWs!.send(`PASS oauth:${this.config.accessToken}`);
        this.ircWs!.send(`NICK ${this.config.botUsername}`);
        this.ircWs!.send(`JOIN #${this.config.channelName}`);

        // Start ping/pong to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ircWs?.readyState === WebSocket.OPEN) {
            this.ircWs.send('PING :tmi.twitch.tv');
          }
        }, 60000);

        resolve();
      });

      this.ircWs.on('message', (data) => {
        this.handleIRCMessage(data.toString());
      });

      this.ircWs.on('error', (error) => {
        logger.error('IRC WebSocket error', { error: error.message });
        reject(error);
      });

      this.ircWs.on('close', () => {
        logger.warn('IRC WebSocket closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
        this.handleReconnect('irc');
      });
    });
  }

  /**
   * Connect to Twitch EventSub for subscriptions, bits, etc.
   */
  private async connectEventSub(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.eventSubWs = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

      this.eventSubWs.on('open', () => {
        logger.info('EventSub WebSocket connected');
      });

      this.eventSubWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleEventSubMessage(message);
          
          // Resolve once we get the welcome message with session_id
          if (message.metadata?.message_type === 'session_welcome') {
            resolve();
          }
        } catch (error) {
          logger.error('EventSub parse error', { error });
        }
      });

      this.eventSubWs.on('error', (error) => {
        logger.error('EventSub WebSocket error', { error: error.message });
        reject(error);
      });

      this.eventSubWs.on('close', () => {
        logger.warn('EventSub WebSocket closed');
        this.handleReconnect('eventsub');
      });

      // Timeout if we don't connect
      setTimeout(() => reject(new Error('EventSub connection timeout')), 30000);
    });
  }

  /**
   * Parse and handle IRC messages
   */
  private handleIRCMessage(raw: string): void {
    const lines = raw.split('\r\n').filter(line => line.length > 0);

    for (const line of lines) {
      // Respond to PING
      if (line.startsWith('PING')) {
        this.ircWs?.send('PONG :tmi.twitch.tv');
        continue;
      }

      // Parse PRIVMSG (chat messages)
      if (line.includes('PRIVMSG')) {
        const chatMessage = this.parsePrivMsg(line);
        if (chatMessage) {
          this.emit('chat', chatMessage);
        }
      }

      // Handle USERNOTICE (subs, raids, etc. - backup for EventSub)
      if (line.includes('USERNOTICE')) {
        this.handleUserNotice(line);
      }

      // Handle successful join
      if (line.includes('366')) {
        logger.info('Successfully joined channel', { channel: this.config.channelName });
      }
    }
  }

  /**
   * Parse PRIVMSG into ChatMessage
   */
  private parsePrivMsg(line: string): TwitchChatMessage | null {
    try {
      // Parse IRC tags
      const tagsMatch = line.match(/^@([^ ]+)/);
      const tags: Record<string, string> = {};
      if (tagsMatch) {
        tagsMatch[1].split(';').forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value || '';
        });
      }

      // Parse message content
      const msgMatch = line.match(/:([^!]+)![^:]+:(.+)$/);
      if (!msgMatch) return null;

      const [, username, message] = msgMatch;

      return {
        id: tags['id'] || `${Date.now()}-${Math.random()}`,
        platform: 'twitch',
        username: tags['display-name'] || username,
        userId: tags['user-id'] || username,
        message: message.trim(),
        timestamp: new Date(parseInt(tags['tmi-sent-ts']) || Date.now()),
        badges: tags['badges']?.split(',').filter(b => b) || [],
        isSubscriber: tags['subscriber'] === '1',
        isModerator: tags['mod'] === '1' || tags['badges']?.includes('broadcaster'),
        bits: tags['bits'] ? parseInt(tags['bits']) : undefined,
        isFirst: tags['first-msg'] === '1',
        color: tags['color'] || undefined,
        emotes: tags['emotes']?.split('/').filter(e => e) || [],
      };
    } catch (error) {
      logger.debug('Failed to parse PRIVMSG', { error, line });
      return null;
    }
  }

  /**
   * Handle USERNOTICE for subs/raids (backup for EventSub)
   */
  private handleUserNotice(line: string): void {
    // Parse for sub/resub/gift notifications
    const tagsMatch = line.match(/^@([^ ]+)/);
    if (!tagsMatch) return;

    const tags: Record<string, string> = {};
    tagsMatch[1].split(';').forEach(tag => {
      const [key, value] = tag.split('=');
      tags[key] = value || '';
    });

    const msgId = tags['msg-id'];
    
    if (msgId === 'sub' || msgId === 'resub') {
      const sub: TwitchSubscription = {
        userId: tags['user-id'],
        username: tags['display-name'] || tags['login'],
        tier: (tags['msg-param-sub-plan'] as '1000' | '2000' | '3000') || '1000',
        isGift: false,
        months: parseInt(tags['msg-param-cumulative-months']) || 1,
        streakMonths: parseInt(tags['msg-param-streak-months']) || undefined,
        message: line.match(/:([^:]+)$/)?.[1]?.trim(),
      };
      this.emit('subscription', sub);
    }

    if (msgId === 'subgift' || msgId === 'anonsubgift') {
      const sub: TwitchSubscription = {
        userId: tags['msg-param-recipient-id'],
        username: tags['msg-param-recipient-display-name'],
        tier: (tags['msg-param-sub-plan'] as '1000' | '2000' | '3000') || '1000',
        isGift: true,
        gifterName: msgId === 'anonsubgift' ? 'Anonymous' : tags['display-name'],
        months: 1,
      };
      this.emit('subscription', sub);
    }

    if (msgId === 'raid') {
      const raid: TwitchRaid = {
        fromChannel: tags['msg-param-displayName'] || tags['display-name'],
        viewerCount: parseInt(tags['msg-param-viewerCount']) || 0,
      };
      this.emit('raid', raid);
    }
  }

  /**
   * Handle EventSub messages
   */
  private async handleEventSubMessage(message: any): Promise<void> {
    const { metadata, payload } = message;

    switch (metadata?.message_type) {
      case 'session_welcome':
        this.sessionId = payload.session.id;
        logger.info('EventSub session started', { sessionId: this.sessionId });
        await this.subscribeToEvents();
        break;

      case 'session_keepalive':
        // Connection is alive
        break;

      case 'notification':
        this.handleEventNotification(payload);
        break;

      case 'session_reconnect':
        logger.info('EventSub reconnect requested');
        // Reconnect to new URL
        break;

      case 'revocation':
        logger.warn('EventSub subscription revoked', { reason: payload.subscription.status });
        break;
    }
  }

  /**
   * Subscribe to EventSub events via API
   */
  private async subscribeToEvents(): Promise<void> {
    if (!this.sessionId) {
      logger.error('No session ID for EventSub subscriptions');
      return;
    }

    const events = [
      { type: 'channel.subscribe', version: '1' },
      { type: 'channel.subscription.gift', version: '1' },
      { type: 'channel.subscription.message', version: '1' },
      { type: 'channel.cheer', version: '1' },
      { type: 'channel.raid', version: '1' },
      { type: 'channel.follow', version: '2' },
      { type: 'channel.channel_points_custom_reward_redemption.add', version: '1' },
    ];

    // Get broadcaster ID first
    const broadcasterId = await this.getBroadcasterId();
    if (!broadcasterId) {
      logger.error('Failed to get broadcaster ID');
      return;
    }

    for (const event of events) {
      try {
        const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: {
            'Client-ID': this.config.clientId,
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: event.type,
            version: event.version,
            condition: {
              broadcaster_user_id: broadcasterId,
              ...(event.type === 'channel.follow' ? { moderator_user_id: broadcasterId } : {}),
            },
            transport: {
              method: 'websocket',
              session_id: this.sessionId,
            },
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          logger.warn(`Failed to subscribe to ${event.type}`, { error });
        } else {
          logger.debug(`Subscribed to ${event.type}`);
        }
      } catch (error) {
        logger.error(`Error subscribing to ${event.type}`, { error });
      }
    }

    logger.info('EventSub subscriptions created');
  }

  /**
   * Get broadcaster user ID from username
   */
  private async getBroadcasterId(): Promise<string | null> {
    try {
      const response = await fetch(
        `https://api.twitch.tv/helix/users?login=${this.config.channelName}`,
        {
          headers: {
            'Client-ID': this.config.clientId,
            'Authorization': `Bearer ${this.config.accessToken}`,
          },
        }
      );

      if (!response.ok) return null;

      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.[0]?.id || null;
    } catch (error) {
      logger.error('Failed to get broadcaster ID', { error });
      return null;
    }
  }

  /**
   * Handle EventSub notifications
   */
  private handleEventNotification(payload: any): void {
    const { subscription, event } = payload;

    switch (subscription.type) {
      case 'channel.subscribe':
      case 'channel.subscription.message':
        this.emit('subscription', {
          userId: event.user_id,
          username: event.user_name,
          tier: event.tier || '1000',
          isGift: false,
          months: event.cumulative_months || 1,
          streakMonths: event.streak_months,
          message: event.message?.text,
        } as TwitchSubscription);
        break;

      case 'channel.subscription.gift':
        this.emit('subscription', {
          userId: event.user_id,
          username: event.user_name,
          tier: event.tier || '1000',
          isGift: true,
          gifterName: event.is_anonymous ? 'Anonymous' : event.user_name,
          months: 1,
        } as TwitchSubscription);
        break;

      case 'channel.cheer':
        this.emit('bits', {
          userId: event.user_id,
          username: event.user_name,
          bits: event.bits,
          message: event.message,
          isAnonymous: event.is_anonymous,
        } as TwitchBits);
        break;

      case 'channel.raid':
        this.emit('raid', {
          fromChannel: event.from_broadcaster_user_name,
          viewerCount: event.viewers,
        } as TwitchRaid);
        break;

      case 'channel.follow':
        this.emit('follow', {
          userId: event.user_id,
          username: event.user_name,
        });
        break;

      case 'channel.channel_points_custom_reward_redemption.add':
        this.emit('redemption', {
          userId: event.user_id,
          username: event.user_name,
          rewardTitle: event.reward.title,
          rewardCost: event.reward.cost,
          userInput: event.user_input,
        });
        break;
    }
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(type: 'irc' | 'eventsub'): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts reached for ${type}`);
      this.emit('disconnected', type);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info(`Reconnecting ${type} in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (type === 'irc') {
        this.connectIRC().catch(err => logger.error('IRC reconnect failed', { err }));
      } else {
        this.connectEventSub().catch(err => logger.error('EventSub reconnect failed', { err }));
      }
    }, delay);
  }

  /**
   * Send a chat message
   */
  sendMessage(message: string): void {
    if (this.ircWs?.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message - IRC not connected');
      return;
    }

    this.ircWs.send(`PRIVMSG #${this.config.channelName} :${message}`);
    logger.debug('Sent chat message', { message: message.substring(0, 50) });
  }

  /**
   * Reply to a specific message
   */
  replyToMessage(messageId: string, reply: string): void {
    if (this.ircWs?.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot reply - IRC not connected');
      return;
    }

    this.ircWs.send(`@reply-parent-msg-id=${messageId} PRIVMSG #${this.config.channelName} :${reply}`);
    logger.debug('Sent reply', { messageId, reply: reply.substring(0, 50) });
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && 
           this.ircWs?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from Twitch
   */
  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    if (this.ircWs) {
      this.ircWs.close();
      this.ircWs = null;
    }

    if (this.eventSubWs) {
      this.eventSubWs.close();
      this.eventSubWs = null;
    }

    this.isConnected = false;
    logger.info('Twitch client disconnected');
  }
}

