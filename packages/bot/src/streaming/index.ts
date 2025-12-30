/**
 * Streaming Integration Module
 * 
 * Provides Twitch and X/Twitter integration with smart chat handling.
 * 
 * Features:
 * - Twitch IRC for chat + EventSub for donations/subs/bits
 * - X/Twitter polling for mentions
 * - Priority queue to avoid overload (donations > subs > questions > random)
 * - AI-powered contextual responses
 * - Rate limiting to prevent spam
 */

export { TwitchClient, type TwitchConfig, type TwitchChatMessage, type TwitchSubscription, type TwitchBits, type TwitchRaid } from './twitch-client.js';
export { XClient, type XConfig, type XMention } from './x-client.js';
export { ChatManager, ChatPriority, type ChatManagerConfig, type PrioritizedMessage, chatManager } from './chat-manager.js';
export { ChatResponder, type ChatResponderConfig } from './chat-responder.js';

import { Logger } from '@tau/shared';
import { TwitchClient, TwitchConfig } from './twitch-client.js';
import { XClient, XConfig } from './x-client.js';
import { chatManager, ChatManager } from './chat-manager.js';
import { ChatResponder } from './chat-responder.js';
import { TauWebSocketServer } from '../websocket-server.js';

const logger = new Logger('Streaming');

export interface StreamingConfig {
  twitch?: TwitchConfig;
  x?: XConfig;
  enabled: boolean;
  // Chat manager options
  subscribersAndDonationsOnly?: boolean;
  maxResponsesPerMinute?: number;
  autoRespondThreshold?: number;
}

/**
 * Initialize streaming integrations
 */
export async function initializeStreaming(
  config: StreamingConfig,
  wsServer: TauWebSocketServer
): Promise<{
  twitchClient: TwitchClient | null;
  xClient: XClient | null;
  chatManager: ChatManager;
  chatResponder: ChatResponder;
}> {
  let twitchClient: TwitchClient | null = null;
  let xClient: XClient | null = null;

  // Apply chat manager config
  chatManager.updateConfig({
    subscribersAndDonationsOnly: config.subscribersAndDonationsOnly ?? true,
    maxResponsesPerMinute: config.maxResponsesPerMinute,
    autoRespondThreshold: config.autoRespondThreshold,
  });

  const subsOnlyMode = config.subscribersAndDonationsOnly ?? true;
  logger.info('Chat manager config', { 
    subscribersAndDonationsOnly: subsOnlyMode,
    maxResponsesPerMinute: config.maxResponsesPerMinute ?? 6,
  });

  // Initialize Twitch if configured
  if (config.twitch && config.enabled) {
    try {
      twitchClient = new TwitchClient(config.twitch);
      await twitchClient.connect();
      chatManager.attachTwitch(twitchClient);
      logger.info('Twitch integration initialized');
    } catch (error) {
      logger.error('Failed to initialize Twitch', { error });
    }
  }

  // Initialize X if configured
  if (config.x && config.enabled) {
    try {
      xClient = new XClient(config.x);
      await xClient.connect();
      chatManager.attachX(xClient);
      logger.info('X integration initialized');
    } catch (error) {
      logger.error('Failed to initialize X', { error });
    }
  }

  // Create chat responder
  const chatResponder = new ChatResponder(chatManager);
  chatResponder.attachWebSocket(wsServer);

  // Start processing if we have at least one connection
  if (twitchClient || xClient) {
    chatManager.start();
    logger.info('Chat manager started');
  }

  return {
    twitchClient,
    xClient,
    chatManager,
    chatResponder,
  };
}

/**
 * Shutdown streaming integrations
 */
export function shutdownStreaming(
  twitchClient: TwitchClient | null,
  xClient: XClient | null
): void {
  chatManager.stop();

  if (twitchClient) {
    twitchClient.disconnect();
  }

  if (xClient) {
    xClient.disconnect();
  }

  logger.info('Streaming integrations shutdown');
}

