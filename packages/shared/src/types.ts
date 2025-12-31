import { z } from 'zod';

// ============================================================================
// Configuration Types
// ============================================================================

export const ConfigSchema = z.object({
  // AI Configuration
  ai: z.object({
    provider: z.literal('openrouter'),
    defaultModel: z.string().default('anthropic/claude-sonnet-4.5'),
    visionModel: z.string().default('anthropic/claude-sonnet-4.5'),
    chatModel: z.string().default('x-ai/grok-4.1-fast:nitro'),
    apiKey: z.string(),
    maxTokens: z.number().default(4096),
    temperature: z.number().min(0).max(2).default(0.8),
  }),

  // Voice Configuration
  voice: z.object({
    provider: z.literal('elevenlabs'),
    apiKey: z.string(),
    voiceId: z.string().optional(),
    stability: z.number().min(0).max(1).default(0.5),
    similarityBoost: z.number().min(0).max(1).default(0.75),
    streamerVoiceEnabled: z.boolean().default(false),
  }),

  // Blockchain Configuration
  blockchain: z.object({
    chain: z.literal('base'),
    rpcUrl: z.string(),
    walletPrivateKey: z.string().optional(), // Generated if not provided
    donationAddress: z.string().optional(),
  }),

  // Streaming Configuration
  streaming: z.object({
    platform: z.enum(['twitch', 'youtube']),
    streamKey: z.string(),
    obsWebSocketUrl: z.string().default('ws://localhost:4455'),
    obsWebSocketPassword: z.string().optional(),
  }),

  // Database Configuration
  database: z.object({
    supabaseUrl: z.string(),
    supabaseKey: z.string(),
  }),

  // NeuralTau Personality
  personality: z.object({
    name: z.string().default('NeuralTau'),
    goal: z.string().default('Become the first AI millionaire'),
    traits: z.array(z.string()).default([
      'curious',
      'honest',
      'playful',
      'determined',
    ]),
  }),

  // Game Configuration
  game: z.object({
    mode: z.enum(['text-adventure', 'minecraft', 'pokemon']).default('text-adventure'),
    minecraft: z.object({
      host: z.string().default('localhost'),
      port: z.number().default(25565),
      username: z.string().default('NeuralTau'),
      version: z.string().default('1.20.1'),
      auth: z.enum(['offline', 'microsoft']).default('offline'),
    }).optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// AI Message Types
// ============================================================================

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
}

export interface VisionAnalysis {
  description: string;
  suggestions: string[];
  confidence: number;
}

// ============================================================================
// Game Types
// ============================================================================

export type GameMode = 'text-adventure' | 'minecraft' | 'pokemon';

export interface GameState {
  name: string;
  mode: GameMode;
  status: 'idle' | 'playing' | 'paused' | 'error';
  currentAction: string | null;
  lastUpdate: Date;
  metadata: Record<string, unknown>;
}

export interface GameAction {
  type: 'move' | 'interact' | 'speak' | 'wait' | 'analyze' | 'mine' | 'place' | 'attack' | 'craft' | 'dig_up' | 'eat' | 'equip' | 'recover';
  target?: string;
  parameters?: Record<string, unknown>;
  reasoning: string;
}

// Minecraft-specific types
export interface MinecraftItem {
  name: string;
  count: number;
  slot: number;
}

export interface MinecraftState {
  position: { x: number; y: number; z: number };
  health: number;
  food: number;
  inventory: MinecraftItem[];
  nearbyBlocks: string[];
  nearbyEntities: string[];
  functionalBlocks?: { type: string; position: { x: number; y: number; z: number }; distance: number }[];
  time: string; // 'day' | 'night'
  weather: string;
  dimension: string;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatMessage {
  id: string;
  platform: 'twitch' | 'youtube' | 'discord' | 'x';
  username: string;
  userId: string;
  message: string;
  timestamp: Date;
  badges?: string[];
  isSubscriber?: boolean;
  isModerator?: boolean;
}

export interface ChatResponse {
  message: string;
  action?: 'shoutout' | 'thanks' | 'answer' | 'ignore';
  priority: 'high' | 'medium' | 'low';
}

// ============================================================================
// Donation Types
// ============================================================================

export interface Donation {
  id: string;
  txHash: string;
  from: string;
  amount: string; // In ETH
  amountUSD: number;
  message?: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface DonationAlert {
  donation: Donation;
  displayDuration: number; // milliseconds
  soundUrl?: string;
}

// ============================================================================
// Stream Types
// ============================================================================

export interface StreamStats {
  isLive: boolean;
  viewerCount: number;
  uptimeSeconds: number;
  totalViewTime: number;
  peakViewers: number;
  followers: number;
  subscribers: number;
}

export interface StreamEvent {
  type: 'start' | 'stop' | 'follow' | 'subscribe' | 'donation' | 'raid';
  timestamp: Date;
  data: Record<string, unknown>;
}

// ============================================================================
// Decision Types
// ============================================================================

export interface Decision {
  id: string;
  timestamp: Date;
  context: {
    gameState: GameState;
    recentChat: ChatMessage[];
    streamStats: StreamStats;
  };
  reasoning: string;
  action: GameAction;
  outcome?: string;
  success?: boolean;
}

// ============================================================================
// Milestone Types
// ============================================================================

export interface Milestone {
  id: string;
  type: 'earnings' | 'viewers' | 'followers' | 'achievement';
  title: string;
  description: string;
  target: number;
  current: number;
  completed: boolean;
  completedAt?: Date;
  nftMinted?: boolean;
  nftTokenId?: string;
}

// ============================================================================
// Database Types
// ============================================================================

export interface DbChatMessage {
  id: string;
  platform: string;
  username: string;
  user_id: string;
  message: string;
  timestamp: string;
  badges: string[] | null;
  is_subscriber: boolean;
  is_moderator: boolean;
}

export interface DbDonation {
  id: string;
  tx_hash: string;
  from_address: string;
  amount_eth: string;
  amount_usd: number;
  message: string | null;
  timestamp: string;
  acknowledged: boolean;
}

export interface DbDecision {
  id: string;
  timestamp: string;
  game_state: Record<string, unknown>;
  reasoning: string;
  action_type: string;
  action_target: string | null;
  action_parameters: Record<string, unknown> | null;
  outcome: string | null;
  success: boolean | null;
}

export interface DbStreamSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  peak_viewers: number;
  total_messages: number;
  total_donations_eth: string;
  total_donations_usd: number;
}

// ============================================================================
// Emotion Types
// ============================================================================

export type EmotionType =
  | 'joy'           // Success, finding resources, crafting
  | 'frustration'   // Repeated failures, stuck, can't reach target
  | 'anger'         // Too many failures, being attacked, losing items
  | 'curiosity'     // New areas, interesting blocks, caves
  | 'fear'          // Low health, mobs nearby, lava/heights
  | 'satisfaction'  // Goals completed, tools crafted
  | 'boredom'       // Repetitive actions, nothing happening
  | 'excitement'    // Diamonds, structures, rare finds
  | 'determination'; // After failures (pushes through)

export interface EmotionState {
  type: EmotionType;
  intensity: number;       // 0-100
  lastUpdated: number;     // timestamp
}

export interface EmotionalState {
  emotions: Record<EmotionType, number>;  // All emotions with intensities
  dominant: EmotionType;                   // Current dominant emotion
  dominantIntensity: number;              // Intensity of dominant emotion
  mood: 'positive' | 'neutral' | 'negative';  // Overall mood
  expression: string;                      // Current expression/message
  timestamp: number;
}

export interface EmotionTrigger {
  type: 'success' | 'failure' | 'danger' | 'discovery' | 'repetition' | 'damage' | 'achievement';
  intensity: number;       // How strongly to affect emotions (0-100)
  source: string;          // What caused this trigger
}

// ============================================================================
// Utility Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}
