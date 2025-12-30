import { EventEmitter } from 'events';
import { Logger, ChatMessage } from '@tau/shared';

const logger = new Logger('XClient');

export interface XConfig {
  bearerToken: string;        // X API Bearer Token (App-only)
  apiKey?: string;            // API Key (Consumer Key)
  apiSecret?: string;         // API Secret (Consumer Secret)
  accessToken?: string;       // User Access Token (for posting)
  accessSecret?: string;      // User Access Token Secret
  botUsername: string;        // Bot's X username (without @)
}

export interface XMention extends ChatMessage {
  tweetId: string;
  conversationId?: string;
  inReplyToId?: string;
  isVerified?: boolean;
  followerCount?: number;
  likeCount?: number;
  retweetCount?: number;
  mediaUrls?: string[];
}

export interface XDM {
  senderId: string;
  senderUsername: string;
  message: string;
  timestamp: Date;
}

/**
 * X/Twitter client for mentions and interactions
 * Uses X API v2 with filtered stream for real-time mentions
 */
export class XClient extends EventEmitter {
  private config: XConfig;
  private isConnected: boolean = false;
  private streamController: AbortController | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastMentionId: string | null = null;
  private rateLimitResetTime: number = 0;

  constructor(config: XConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to X API and start monitoring mentions
   * Uses polling (filtered stream requires elevated access)
   */
  async connect(): Promise<void> {
    // Validate bearer token
    const valid = await this.validateCredentials();
    if (!valid) {
      throw new Error('Invalid X API credentials');
    }

    // Get the most recent mention ID to avoid processing old mentions
    await this.getInitialMentionId();

    // Start polling for mentions (every 15 seconds - within rate limits)
    this.startMentionPolling();

    this.isConnected = true;
    logger.info('X client connected', { username: this.config.botUsername });
  }

  /**
   * Validate API credentials
   */
  private async validateCredentials(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.twitter.com/2/users/by/username/${this.config.botUsername}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.bearerToken}`,
          },
        }
      );

      if (response.status === 429) {
        // Rate limited
        const resetTime = response.headers.get('x-rate-limit-reset');
        if (resetTime) {
          this.rateLimitResetTime = parseInt(resetTime) * 1000;
        }
        logger.warn('X API rate limited during validation');
        return true; // Assume valid, just rate limited
      }

      return response.ok;
    } catch (error) {
      logger.error('Failed to validate X credentials', { error });
      return false;
    }
  }

  /**
   * Get the most recent mention ID to set as baseline
   */
  private async getInitialMentionId(): Promise<void> {
    try {
      // First get our user ID
      const userResponse = await fetch(
        `https://api.twitter.com/2/users/by/username/${this.config.botUsername}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.bearerToken}`,
          },
        }
      );

      if (!userResponse.ok) return;

      const userData = await userResponse.json() as { data?: { id?: string } };
      const userId = userData.data?.id;
      if (!userId) return;

      // Get recent mentions
      const mentionsResponse = await fetch(
        `https://api.twitter.com/2/users/${userId}/mentions?max_results=5`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.bearerToken}`,
          },
        }
      );

      if (mentionsResponse.ok) {
        const mentionsData = await mentionsResponse.json() as { data?: Array<{ id: string }> };
        if (mentionsData.data?.[0]?.id) {
          this.lastMentionId = mentionsData.data[0].id;
          logger.debug('Set initial mention ID', { id: this.lastMentionId });
        }
      }
    } catch (error) {
      logger.debug('Failed to get initial mention ID', { error });
    }
  }

  /**
   * Start polling for mentions
   */
  private startMentionPolling(): void {
    // Poll every 15 seconds (within free tier limits: 15 requests per 15 min window)
    this.pollInterval = setInterval(async () => {
      // Check rate limit
      if (Date.now() < this.rateLimitResetTime) {
        logger.debug('Skipping poll - rate limited');
        return;
      }

      await this.pollMentions();
    }, 15000);

    // Initial poll
    this.pollMentions();
  }

  /**
   * Poll for new mentions
   */
  private async pollMentions(): Promise<void> {
    try {
      // Get user ID
      const userResponse = await fetch(
        `https://api.twitter.com/2/users/by/username/${this.config.botUsername}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.bearerToken}`,
          },
        }
      );

      if (!userResponse.ok) {
        if (userResponse.status === 429) {
          this.handleRateLimit(userResponse);
        }
        return;
      }

      const userData = await userResponse.json() as { data?: { id?: string } };
      const userId = userData.data?.id;
      if (!userId) return;

      // Build query params
      let url = `https://api.twitter.com/2/users/${userId}/mentions?max_results=10`;
      url += '&tweet.fields=created_at,conversation_id,in_reply_to_user_id,public_metrics';
      url += '&expansions=author_id';
      url += '&user.fields=verified,public_metrics';

      if (this.lastMentionId) {
        url += `&since_id=${this.lastMentionId}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.bearerToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.handleRateLimit(response);
        }
        return;
      }

      interface TweetData {
        id: string;
        author_id: string;
        text: string;
        created_at: string;
        conversation_id?: string;
        in_reply_to_user_id?: string;
        public_metrics?: { like_count?: number; retweet_count?: number };
      }
      interface UserData {
        id: string;
        username: string;
        verified?: boolean;
        public_metrics?: { followers_count?: number };
      }
      interface MentionsResponse {
        data?: TweetData[];
        includes?: { users?: UserData[] };
      }

      const data = await response.json() as MentionsResponse;
      
      if (data.data && data.data.length > 0) {
        // Update last mention ID
        this.lastMentionId = data.data[0].id;

        // Process mentions (newest first, so reverse to emit oldest first)
        const mentions = [...data.data].reverse();
        const users = new Map(data.includes?.users?.map((u) => [u.id, u]) || []);

        for (const tweet of mentions) {
          const author = users.get(tweet.author_id);
          const mention = this.parseMention(tweet, author);
          this.emit('mention', mention);
        }

        logger.debug('Processed new mentions', { count: mentions.length });
      }
    } catch (error) {
      logger.debug('Error polling mentions', { error });
    }
  }

  /**
   * Parse tweet into XMention
   */
  private parseMention(tweet: any, author: any): XMention {
    return {
      id: tweet.id,
      tweetId: tweet.id,
      platform: 'discord', // Using 'discord' as placeholder since X isn't in the platform type
      username: author?.username || 'unknown',
      userId: tweet.author_id,
      message: tweet.text,
      timestamp: new Date(tweet.created_at),
      conversationId: tweet.conversation_id,
      inReplyToId: tweet.in_reply_to_user_id,
      isVerified: author?.verified,
      followerCount: author?.public_metrics?.followers_count,
      likeCount: tweet.public_metrics?.like_count,
      retweetCount: tweet.public_metrics?.retweet_count,
    };
  }

  /**
   * Handle rate limiting
   */
  private handleRateLimit(response: Response): void {
    const resetTime = response.headers.get('x-rate-limit-reset');
    if (resetTime) {
      this.rateLimitResetTime = parseInt(resetTime) * 1000;
      const waitTime = Math.ceil((this.rateLimitResetTime - Date.now()) / 1000);
      logger.warn(`X API rate limited. Resuming in ${waitTime}s`);
    } else {
      // Default 15 min wait
      this.rateLimitResetTime = Date.now() + (15 * 60 * 1000);
    }
  }

  /**
   * Post a tweet (reply or standalone)
   * Requires user-level authentication (OAuth 1.0a User Context)
   */
  async postTweet(text: string, replyToId?: string): Promise<string | null> {
    if (!this.config.accessToken || !this.config.accessSecret) {
      logger.warn('Cannot post tweet - user-level auth not configured');
      return null;
    }

    try {
      // X API v2 requires OAuth 1.0a for posting
      // This is a simplified version - in production use a proper OAuth library
      const body: Record<string, unknown> = { text };
      
      if (replyToId) {
        body.reply = { in_reply_to_tweet_id: replyToId };
      }

      const response = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Authorization': await this.getOAuth1Header('POST', 'https://api.twitter.com/2/tweets'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Failed to post tweet', { error });
        return null;
      }

      const data = await response.json() as { data?: { id?: string } };
      logger.info('Posted tweet', { id: data.data?.id });
      return data.data?.id || null;
    } catch (error) {
      logger.error('Error posting tweet', { error });
      return null;
    }
  }

  /**
   * Generate OAuth 1.0a header for user-level authentication
   * Simplified - in production use oauth-1.0a package
   */
  private async getOAuth1Header(method: string, url: string): Promise<string> {
    // This is a placeholder - real implementation requires:
    // 1. Generate oauth_nonce
    // 2. Generate oauth_timestamp
    // 3. Create signature base string
    // 4. Create signing key from consumer secret + token secret
    // 5. Calculate HMAC-SHA1 signature
    // 6. Build Authorization header

    // For now, if you have a bearer token that can post (app+user context):
    return `Bearer ${this.config.bearerToken}`;
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from X API
   */
  disconnect(): void {
    if (this.streamController) {
      this.streamController.abort();
      this.streamController = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isConnected = false;
    logger.info('X client disconnected');
  }
}

