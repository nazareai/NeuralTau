import { EventEmitter } from 'events';
import { Logger, ChatMessage, ChatResponse } from '@tau/shared';
import { TwitchClient, TwitchChatMessage, TwitchSubscription, TwitchBits, TwitchRaid } from './twitch-client.js';
import { XClient, XMention } from './x-client.js';

const logger = new Logger('ChatManager');

/**
 * Priority levels for chat interactions
 * Higher = more likely to get a response
 */
export enum ChatPriority {
  DONATION = 100,       // Bits, subs with message
  SUBSCRIBER_CHAT = 70, // Subscriber saying something
  MODERATOR = 60,       // Mod messages
  VERIFIED = 55,        // Verified X accounts
  QUESTION = 50,        // Messages containing questions
  MENTION = 45,         // Direct @ mentions
  FIRST_MESSAGE = 40,   // First-time chatters
  KEYWORD = 30,         // Contains interesting keywords
  RANDOM = 10,          // Random selection from remaining
}

export interface PrioritizedMessage {
  message: ChatMessage;
  priority: ChatPriority;
  priorityScore: number;    // Actual score (priority + modifiers)
  source: 'twitch' | 'x';
  metadata: {
    bits?: number;
    subTier?: string;
    subMonths?: number;
    isGift?: boolean;
    followerCount?: number;
    isVerified?: boolean;
  };
  timestamp: number;
  processed: boolean;
}

export interface ChatManagerConfig {
  // Rate limiting
  maxResponsesPerMinute: number;      // Max responses AI generates per minute
  minSecondsBetweenResponses: number; // Minimum gap between responses
  
  // Priority thresholds
  autoRespondThreshold: number;       // Priority score that guarantees response
  randomSampleSize: number;           // How many low-priority msgs to sample from
  randomSampleChance: number;         // Chance (0-1) to respond to sampled msg
  
  // COST CONTROL - Only respond to paying viewers
  subscribersAndDonationsOnly: boolean; // If true, ONLY respond to subs/bits/donations
  
  // Filtering
  ignoreBots: boolean;                // Ignore known bot accounts
  minMessageLength: number;           // Minimum chars to consider
  maxMessageLength: number;           // Maximum chars to process
  
  // Keywords that boost priority
  interestingKeywords: string[];
  
  // Donation thresholds (in USD equivalent)
  megaDonationThreshold: number;      // Gets immediate response
}

const DEFAULT_CONFIG: ChatManagerConfig = {
  maxResponsesPerMinute: 6,           // ~1 response every 10 seconds max
  minSecondsBetweenResponses: 8,
  autoRespondThreshold: 60,           // Subs+ always get responses
  randomSampleSize: 10,
  randomSampleChance: 0.15,           // 15% chance for random response
  subscribersAndDonationsOnly: true,  // DEFAULT: Only respond to subs/donations (cost control)
  ignoreBots: true,
  minMessageLength: 3,
  maxMessageLength: 500,
  interestingKeywords: [
    'minecraft', 'ai', 'bot', 'tau', 'neuraltau',
    'help', 'how', 'what', 'why', 'diamond', 'creeper',
    'die', 'death', 'kill', 'build', 'craft',
    'love', 'hate', 'amazing', 'insane', 'crazy',
    'donate', 'sub', 'follow',
  ],
  megaDonationThreshold: 10,          // $10+ = mega donation
};

// Known bot usernames to ignore
const BOT_USERNAMES = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'moobot',
  'fossabot', 'wizebot', 'soundalerts', 'commanderroot',
]);

/**
 * Smart chat manager that prioritizes messages and prevents overload
 * 
 * Design principles:
 * 1. Donations/subs ALWAYS get responses
 * 2. Interesting messages (questions, keywords) get higher priority
 * 3. Random sampling prevents ignoring regular viewers entirely
 * 4. Rate limiting prevents overwhelming the AI
 */
export class ChatManager extends EventEmitter {
  private config: ChatManagerConfig;
  private twitchClient: TwitchClient | null = null;
  private xClient: XClient | null = null;
  
  // Message queue and tracking
  private messageQueue: PrioritizedMessage[] = [];
  private responseTimestamps: number[] = [];
  private lastResponseTime: number = 0;
  
  // Processing state
  private processInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(config: Partial<ChatManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update config at runtime
   */
  updateConfig(config: Partial<ChatManagerConfig>): void {
    // Only update defined values
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        (this.config as any)[key] = value;
      }
    }
  }

  /**
   * Initialize with Twitch client
   */
  attachTwitch(client: TwitchClient): void {
    this.twitchClient = client;
    
    // Listen for chat messages
    client.on('chat', (msg: TwitchChatMessage) => {
      this.handleIncomingMessage(msg, 'twitch');
    });

    // Listen for subscriptions with messages
    client.on('subscription', (sub: TwitchSubscription) => {
      if (sub.message) {
        const chatMsg: ChatMessage = {
          id: `sub-${Date.now()}`,
          platform: 'twitch',
          username: sub.username,
          userId: sub.userId,
          message: sub.message,
          timestamp: new Date(),
          isSubscriber: true,
        };
        
        this.handleIncomingMessage(chatMsg, 'twitch', {
          priority: ChatPriority.DONATION,
          metadata: {
            subTier: sub.tier,
            subMonths: sub.months,
            isGift: sub.isGift,
          },
        });
      }

      // Always emit sub event for potential thank-you
      this.emit('subscription', sub);
    });

    // Listen for bits
    client.on('bits', (bits: TwitchBits) => {
      const chatMsg: ChatMessage = {
        id: `bits-${Date.now()}`,
        platform: 'twitch',
        username: bits.username,
        userId: bits.userId,
        message: bits.message,
        timestamp: new Date(),
      };

      const usdValue = bits.bits / 100; // Rough conversion
      
      this.handleIncomingMessage(chatMsg, 'twitch', {
        priority: usdValue >= this.config.megaDonationThreshold 
          ? ChatPriority.DONATION + 50  // Mega donations get boosted
          : ChatPriority.DONATION,
        metadata: { bits: bits.bits },
      });
    });

    // Listen for raids
    client.on('raid', (raid: TwitchRaid) => {
      this.emit('raid', raid);
    });

    logger.info('Twitch client attached to ChatManager');
  }

  /**
   * Initialize with X client
   */
  attachX(client: XClient): void {
    this.xClient = client;

    client.on('mention', (mention: XMention) => {
      this.handleIncomingMessage(mention, 'x');
    });

    logger.info('X client attached to ChatManager');
  }

  /**
   * Start processing the message queue
   */
  start(): void {
    if (this.processInterval) return;

    // Process queue every 2 seconds
    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 2000);

    logger.info('ChatManager started');
  }

  /**
   * Stop processing
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    logger.info('ChatManager stopped');
  }

  /**
   * Handle incoming message from any source
   */
  private handleIncomingMessage(
    message: ChatMessage, 
    source: 'twitch' | 'x',
    overrides?: { priority?: ChatPriority; metadata?: any }
  ): void {
    // Filter bots
    if (this.config.ignoreBots && BOT_USERNAMES.has(message.username.toLowerCase())) {
      return;
    }

    // Filter by length
    const msgLen = message.message.length;
    if (msgLen < this.config.minMessageLength || msgLen > this.config.maxMessageLength) {
      return;
    }

    // COST CONTROL: If subscribersAndDonationsOnly is enabled, 
    // only process messages from subscribers or with bits/donations
    if (this.config.subscribersAndDonationsOnly) {
      const hasBits = overrides?.metadata?.bits && overrides.metadata.bits > 0;
      const hasSub = overrides?.metadata?.subTier || message.isSubscriber;
      const isDonation = overrides?.priority === ChatPriority.DONATION;
      
      if (!hasBits && !hasSub && !isDonation) {
        // Not a subscriber or donation - skip silently
        return;
      }
    }

    // Calculate priority
    const { priority, score } = this.calculatePriority(message, source, overrides);

    const prioritizedMsg: PrioritizedMessage = {
      message,
      priority,
      priorityScore: score,
      source,
      metadata: overrides?.metadata || {},
      timestamp: Date.now(),
      processed: false,
    };

    // Add to queue
    this.messageQueue.push(prioritizedMsg);

    // Keep queue manageable (last 100 messages)
    if (this.messageQueue.length > 100) {
      // Remove oldest low-priority messages
      this.messageQueue = this.messageQueue
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 100);
    }

    // Emit for logging/dashboard
    this.emit('message', prioritizedMsg);

    // If mega priority, process immediately
    if (score >= this.config.autoRespondThreshold + 50) {
      this.processQueue();
    }
  }

  /**
   * Calculate message priority
   */
  private calculatePriority(
    message: ChatMessage,
    source: 'twitch' | 'x',
    overrides?: { priority?: ChatPriority; metadata?: any }
  ): { priority: ChatPriority; score: number } {
    // Start with override or base priority
    let priority = overrides?.priority || ChatPriority.RANDOM;
    let score = priority;

    const msgLower = message.message.toLowerCase();
    const metadata = overrides?.metadata || {};

    // Subscriber boost
    if (message.isSubscriber && priority < ChatPriority.SUBSCRIBER_CHAT) {
      priority = ChatPriority.SUBSCRIBER_CHAT;
      score = ChatPriority.SUBSCRIBER_CHAT;
    }

    // Moderator boost
    if (message.isModerator && priority < ChatPriority.MODERATOR) {
      priority = ChatPriority.MODERATOR;
      score = ChatPriority.MODERATOR;
    }

    // X-specific: verified account boost
    if (source === 'x' && (message as XMention).isVerified) {
      score += 15;
      if (priority < ChatPriority.VERIFIED) {
        priority = ChatPriority.VERIFIED;
      }
    }

    // X-specific: high follower count boost
    if (source === 'x') {
      const followers = (message as XMention).followerCount || 0;
      if (followers >= 10000) score += 20;
      else if (followers >= 1000) score += 10;
      else if (followers >= 100) score += 5;
    }

    // Question detection
    if (msgLower.includes('?') || 
        /^(what|how|why|when|where|who|can|should|is|are|do|does|will|would)\b/.test(msgLower)) {
      score += 15;
      if (priority < ChatPriority.QUESTION) {
        priority = ChatPriority.QUESTION;
      }
    }

    // Direct mention of bot
    if (msgLower.includes('tau') || msgLower.includes('neural') || msgLower.includes('@')) {
      score += 10;
      if (priority < ChatPriority.MENTION) {
        priority = ChatPriority.MENTION;
      }
    }

    // First message bonus (Twitch)
    if ((message as TwitchChatMessage).isFirst) {
      score += 10;
    }

    // Keyword matching
    const keywordMatches = this.config.interestingKeywords.filter(kw => 
      msgLower.includes(kw.toLowerCase())
    );
    if (keywordMatches.length > 0) {
      score += Math.min(keywordMatches.length * 5, 20);
      if (priority < ChatPriority.KEYWORD) {
        priority = ChatPriority.KEYWORD;
      }
    }

    // Bits boost based on amount
    if (metadata.bits) {
      score += Math.min(metadata.bits / 10, 50); // Cap at +50
    }

    // Sub months loyalty boost
    if (metadata.subMonths) {
      score += Math.min(metadata.subMonths, 20); // Cap at +20
    }

    return { priority, score };
  }

  /**
   * Process the message queue and select messages to respond to
   */
  private processQueue(): void {
    if (this.isProcessing) return;
    if (this.messageQueue.filter(m => !m.processed).length === 0) return;

    this.isProcessing = true;

    try {
      // Check rate limits
      const now = Date.now();
      
      // Clean old timestamps
      this.responseTimestamps = this.responseTimestamps.filter(
        t => now - t < 60000
      );

      // Check if we can respond
      if (this.responseTimestamps.length >= this.config.maxResponsesPerMinute) {
        return;
      }

      if (now - this.lastResponseTime < this.config.minSecondsBetweenResponses * 1000) {
        return;
      }

      // Get unprocessed messages
      const pending = this.messageQueue
        .filter(m => !m.processed)
        .sort((a, b) => b.priorityScore - a.priorityScore);

      if (pending.length === 0) return;

      // Decision logic
      let selectedMessage: PrioritizedMessage | null = null;

      // High priority messages get auto-responded
      const highPriority = pending.filter(m => m.priorityScore >= this.config.autoRespondThreshold);
      if (highPriority.length > 0) {
        selectedMessage = highPriority[0];
      } else if (!this.config.subscribersAndDonationsOnly) {
        // Random sampling for lower priority - DISABLED when subscribersAndDonationsOnly is true
        const samplePool = pending.slice(0, this.config.randomSampleSize);
        if (Math.random() < this.config.randomSampleChance) {
          selectedMessage = samplePool[Math.floor(Math.random() * samplePool.length)];
        }
      }

      if (selectedMessage) {
        selectedMessage.processed = true;
        this.responseTimestamps.push(now);
        this.lastResponseTime = now;

        // Emit for response generation
        this.emit('respond', selectedMessage);

        logger.debug('Selected message for response', {
          username: selectedMessage.message.username,
          priority: selectedMessage.priority,
          score: selectedMessage.priorityScore,
          source: selectedMessage.source,
        });
      }

      // Mark old messages as processed (older than 2 minutes)
      this.messageQueue.forEach(m => {
        if (!m.processed && now - m.timestamp > 120000) {
          m.processed = true;
        }
      });

      // Clean up old messages
      this.messageQueue = this.messageQueue.filter(m => now - m.timestamp < 300000);

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send a response to Twitch chat
   */
  sendTwitchMessage(message: string, replyToId?: string): void {
    if (!this.twitchClient) {
      logger.warn('No Twitch client attached');
      return;
    }

    if (replyToId) {
      this.twitchClient.replyToMessage(replyToId, message);
    } else {
      this.twitchClient.sendMessage(message);
    }
  }

  /**
   * Post a reply on X
   */
  async sendXReply(message: string, replyToId: string): Promise<void> {
    if (!this.xClient) {
      logger.warn('No X client attached');
      return;
    }

    await this.xClient.postTweet(message, replyToId);
  }

  /**
   * Get queue stats for dashboard
   */
  getStats(): {
    queueSize: number;
    pendingCount: number;
    responsesLastMinute: number;
    priorityBreakdown: Record<string, number>;
  } {
    const now = Date.now();
    const pending = this.messageQueue.filter(m => !m.processed);
    
    const priorityBreakdown: Record<string, number> = {};
    for (const msg of pending) {
      const key = ChatPriority[msg.priority] || 'UNKNOWN';
      priorityBreakdown[key] = (priorityBreakdown[key] || 0) + 1;
    }

    return {
      queueSize: this.messageQueue.length,
      pendingCount: pending.length,
      responsesLastMinute: this.responseTimestamps.filter(t => now - t < 60000).length,
      priorityBreakdown,
    };
  }
}

// Export singleton
export const chatManager = new ChatManager();

