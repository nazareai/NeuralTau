import dotenv from 'dotenv';
import { Config, ConfigSchema } from '@tau/shared';
import { Logger } from '@tau/shared';

dotenv.config();

const logger = new Logger('Config');

export function loadConfig(): Config {
  try {
    const config = ConfigSchema.parse({
      ai: {
        provider: 'openrouter',
        defaultModel: process.env.AI_DEFAULT_MODEL || 'anthropic/claude-sonnet-4.5',
        visionModel: process.env.AI_VISION_MODEL || 'anthropic/claude-sonnet-4.5',
        chatModel: process.env.AI_CHAT_MODEL || process.env.AI_DEFAULT_MODEL || 'x-ai/grok-4.1-fast:nitro',
        apiKey: process.env.OPENROUTER_API_KEY,
        maxTokens: process.env.AI_MAX_TOKENS
          ? parseInt(process.env.AI_MAX_TOKENS)
          : 4096,
        temperature: process.env.AI_TEMPERATURE
          ? parseFloat(process.env.AI_TEMPERATURE)
          : 0.8,
      },
      voice: {
        provider: 'elevenlabs',
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: process.env.ELEVENLABS_VOICE_ID,
        stability: process.env.VOICE_STABILITY
          ? parseFloat(process.env.VOICE_STABILITY)
          : 0.5,
        similarityBoost: process.env.VOICE_SIMILARITY_BOOST
          ? parseFloat(process.env.VOICE_SIMILARITY_BOOST)
          : 0.75,
        streamerVoiceEnabled: process.env.STREAMER_VOICE_ENABLED === 'true',
      },
      blockchain: {
        chain: 'base',
        rpcUrl: process.env.BLOCKCHAIN_RPC_URL || 'https://mainnet.base.org',
        walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
      },
      streaming: {
        platform: (process.env.STREAMING_PLATFORM as 'twitch' | 'youtube') || 'twitch',
        streamKey: process.env.TWITCH_STREAM_KEY || '',
        obsWebSocketUrl: process.env.OBS_WEBSOCKET_URL || 'ws://localhost:4455',
        obsWebSocketPassword: process.env.OBS_WEBSOCKET_PASSWORD,
      },
      database: {
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseKey: process.env.SUPABASE_KEY || '',
      },
      personality: {
        name: process.env.TAU_NAME || 'NeuralTau',
        goal: process.env.TAU_GOAL || 'Become the first AI millionaire',
        traits: ['curious', 'honest', 'playful', 'determined'],
      },
      game: {
        mode: (process.env.GAME_MODE as 'text-adventure' | 'minecraft' | 'pokemon') || 'text-adventure',
        minecraft: {
          host: process.env.MINECRAFT_HOST || 'localhost',
          port: process.env.MINECRAFT_PORT ? parseInt(process.env.MINECRAFT_PORT) : 25565,
          username: process.env.MINECRAFT_USERNAME || 'NeuralTau',
          version: process.env.MINECRAFT_VERSION || '1.20.1',
          auth: (process.env.MINECRAFT_AUTH as 'offline' | 'microsoft') || 'offline',
        },
      },
    });

    logger.info('Configuration loaded successfully', {
      aiModel: config.ai.defaultModel,
      visionModel: config.ai.visionModel,
      blockchain: config.blockchain.chain,
      platform: config.streaming.platform,
    });

    return config;
  } catch (error) {
    logger.error('Failed to load configuration', { error });
    throw new Error(`Configuration error: ${error}`);
  }
}

export const config = loadConfig();
