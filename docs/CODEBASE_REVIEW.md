# NeuralTau (τ) - Codebase Review

## Overview

**Project:** NeuralTau - An autonomous AI streamer bot that plays Minecraft with human-like behavior, LLM-powered decision-making, emotional systems, and streaming integration.

**Goal:** Demonstrate AI autonomy through gameplay while potentially earning crypto donations toward a "$1M millionaire" goal.

---

## Project Structure

This is a **pnpm workspace monorepo** with 4 main packages:

```
tau/
├── packages/
│   ├── bot/           # Main AI bot - Minecraft gameplay & decision engine
│   ├── web/           # Next.js dashboard for live monitoring
│   ├── shared/        # Shared types, prompts, utilities
│   └── launcher/      # Bot startup orchestration
├── docs/              # Architecture documentation
├── pnpm-workspace.yaml
├── turbo.json         # Turborepo build orchestration
└── package.json       # Root workspace configuration
```

---

## Package: `bot`

The core AI bot implementation (~370KB of TypeScript).

### Key Files

| File | Size | Purpose |
|------|------|---------|
| `src/index.ts` | 40KB | Main loop, batch handling, streamer messages |
| `src/ai/brain.ts` | 47KB | LLM decision engine, action history, learning |
| `src/games/minecraft.ts` | 219KB | Game implementation, movement, perception |
| `src/games/crafting-helper.ts` | 23KB | Recipe system, craftable item detection |
| `src/games/minecraft-brain.ts` | 19KB | Game-specific situational prompts |
| `src/games/human-behavior-patterns.ts` | 18KB | Idle behaviors, natural movements |
| `src/ai/experience-memory.ts` | 19KB | Cross-session learning, pattern extraction |
| `src/ai/emotion-manager.ts` | 12KB | 9 emotions with decay and expressions |
| `src/websocket-server.ts` | 7KB | Real-time dashboard communication |
| `src/streaming/twitch-client.ts` | 15KB | Twitch IRC + EventSub integration |
| `src/streaming/x-client.ts` | 8KB | X/Twitter mentions integration |
| `src/streaming/chat-manager.ts` | 12KB | Smart priority queue for chat |
| `src/streaming/chat-responder.ts` | 10KB | AI-powered chat responses |

### Main Loop (`index.ts`)

- **Decision Cycle:** 15-20 second intervals
- **WebSocket Server:** Port 3002 for dashboard
- **Batch Actions:** Mine up to 5 blocks, craft up to 3 items before re-querying AI
- **Streamer Messages:** Generates engaging chat messages with voice (ElevenLabs TTS)
- **Death Handling:** Tracks deaths/respawns and resets AI state

### AI Brain System (`ai/brain.ts`)

**Three Prompt Modes:**

| Mode | Trigger | Description |
|------|---------|-------------|
| **FAST** | Default | Quick JSON decisions, action-focused |
| **ADVANCED** | 4+ consecutive failures | ReAct reasoning with detailed analysis |
| **AUTONOMOUS** | `AUTONOMOUS_MODE=true` | Trusts LLM's Minecraft knowledge |

**Learning Mechanisms:**
- Action history (last 5 actions with outcomes)
- Loop detection (back-and-forth movement patterns)
- Pattern recording (success/failure by action type)
- Bad direction warnings (avoids water traps, Y drops)

### Human-Like Perception (`games/minecraft.ts`)

**Field of View System:**
- 140° cone (70° per side) - not 360° omniscience
- Line of sight ray-casting - can't see through walls
- Only visible entities/blocks included in AI context
- Memory exception: Blocks >20m bypass FOV/LOS (simulates memory)

**Movement System:**
- `smoothLookAt()` - Smooth camera transitions with easing
- `walkDirectlyToward()` - Short distances (<1.5 blocks)
- `navigateWithPathfinder()` - A* pathfinding for long distances

**"Look Before You Act" Principle:**
```
Mine sequence: Look → Approach → Stop → Aim → Pause → Mine → Collect
```

### Crafting System (`games/crafting-helper.ts`)

- 50+ Minecraft recipes organized by tier (1-5)
- Categories: essential, tools, weapons, armor, food, building
- Tells LLM exactly what CAN be crafted from current inventory
- Includes missing ingredients analysis

### Human Behavior Manager (`games/human-behavior-patterns.ts`)

**Core Principle:** "NEVER interfere with tasks. Only act when IDLE."

**Idle Behaviors:**
- Look at interesting targets (trees, mobs, animals)
- Subtle horizontal head drift (±4°)
- Upward glances to check sky
- Slow environment scans

### Emotion System (`ai/emotion-manager.ts`)

**9 Emotion Types:**
- **Positive:** joy, satisfaction, excitement, curiosity
- **Negative:** frustration, anger, fear, boredom
- **Neutral:** determination

**Triggers:**
- Success events → joy + satisfaction
- Repeated failures → frustration + determination
- Hostile mobs → fear
- Diamond finds → excitement

---

## Package: `web`

Next.js 15 dashboard for live monitoring (port 3005).

### Dashboard Features (`app/page.tsx` - 71KB)

**Live Monitoring:**
- Game state (position, health, food, inventory)
- Thinking status (Fast vs Advanced mode)
- Decision history (last 10 decisions)
- Result tracking (last 10 action outcomes)

**Visual Indicators:**
- Activity status (mining, crafting, attacking, idle) with colors
- Held item overlay with action animation
- Item pickup notifications (floating "+X ITEM" text)
- Streamer messages in chat-style panel

**Emotional Display:**
- Current dominant emotion with emoji and color
- Intensity meter (0-100)
- Expression text matching current mood

**Audio System:**
- ElevenLabs TTS integration
- Voice message queue and playback
- WebSocket audio streaming

---

## Package: `shared`

Common utilities, types, and prompts.

### Type Definitions (`types.ts`)

Key interfaces:
- `GameAction` - Action type + target + parameters
- `GameState` - Current game status and metadata
- `MinecraftState` - Position, health, inventory, nearby blocks/entities
- `EmotionalState` - Dominant emotion + intensity + expression
- `Decision` - Reasoning + action + context

### Prompts (`prompts/`)

| File | Purpose |
|------|---------|
| `minecraft-fast.ts` | Quick decisions, direct commands |
| `minecraft-autonomous.ts` | Minimal guidance, trusts LLM knowledge |
| `minecraft-advanced.ts` | ReAct reasoning for stuck situations |

### Constants (`constants.ts`)

- **Timing:** AI decision interval (20s), chat check (5s), vision analysis (60s)
- **Models:** Claude Sonnet 4.5/3.5, Opus 4, GPT-4 Turbo/4o via OpenRouter
- **Cost:** Claude Sonnet $3/$15 per 1M tokens (input/output)

---

## Data Flow

### Decision Cycle (15-20 seconds)

```
[Game State] → [Perception Layer (FOV/LOS)] → [Cognition Layer]
                                                    ↓
                                            - Action history (5 recent)
                                            - Emotion state
                                            - Experience patterns
                                                    ↓
                                              [LLM Query]
                                                    ↓
                                            [Action Execution]
                                                    ↓
                                            [Learning Update]
                                                    ↓
                                          [WebSocket Broadcast]
```

### WebSocket Events

| Event | Data | Purpose |
|-------|------|---------|
| `gameState` | Position, health, inventory | Game status |
| `decision` | Reasoning, action, state | AI decision display |
| `result` | Action outcome | Result visualization |
| `thinking` | Boolean, mode | "Thinking..." indicator |
| `emotion` | Emotional state | Mood display |
| `activity` | Type, item, active | Mining/crafting indicator |
| `heldItem` | Item name, action | Hand overlay |
| `itemPickup` | Item, count | Floating notification |
| `streamerMessage` | Text, type | Chat messages |
| `audio` | Base64 audio | Voice playback |

---

## Data Storage

```
packages/bot/data/
├── decision-logs/
│   ├── decisions-YYYY-MM-DD.json  # Daily decision logs
│   └── patterns.json              # Extracted patterns
└── minecraft-memory/
    └── {server-key}.json          # Per-server placed blocks
```

---

## Configuration

### Environment Variables

**Required:**
```env
OPENROUTER_API_KEY=        # AI model access
GAME_MODE=minecraft        # Current game mode
MINECRAFT_HOST=localhost   # Server address
MINECRAFT_PORT=25565       # Server port
MINECRAFT_USERNAME=NeuralTau
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

**Optional:**
```env
AUTONOMOUS_MODE=true/false     # Use autonomous prompt
ELEVENLABS_API_KEY=            # Voice synthesis
ELEVENLABS_VOICE_ID=           # Specific voice
STREAMER_VOICE_ENABLED=true    # Enable voice messages
LOG_PROMPTS=true               # Log prompts to file
LOG_LEARNING=true              # Log learning events
```

**Streaming Integration (Twitch/X Chat):**
```env
# Enable chat integration
CHAT_INTEGRATION_ENABLED=true
CHAT_SUBS_AND_DONATIONS_ONLY=true  # Only respond to subscribers/bits (cost control, default: true)
CHAT_MAX_RESPONSES_PER_MIN=6       # Rate limit responses
CHAT_AUTO_RESPOND_THRESHOLD=60     # Priority score for auto-response

# Twitch (requires OAuth token from dev.twitch.tv)
TWITCH_ACCESS_TOKEN=           # OAuth access token
TWITCH_REFRESH_TOKEN=          # For token refresh
TWITCH_CLIENT_ID=              # Twitch app client ID
TWITCH_CLIENT_SECRET=          # Twitch app client secret
TWITCH_CHANNEL_NAME=neuraltau  # Channel to join
TWITCH_BOT_USERNAME=NeuralTau  # Bot's Twitch username

# X/Twitter (requires API keys from developer.twitter.com)
X_BEARER_TOKEN=                # X API Bearer Token
X_API_KEY=                     # API Key (optional, for posting)
X_API_SECRET=                  # API Secret (optional)
X_ACCESS_TOKEN=                # User Access Token (for posting)
X_ACCESS_SECRET=               # User Access Token Secret
X_BOT_USERNAME=NeuralTau       # Bot's X username
```

---

## Key Implementation Details

### Underground Escape Logic
- When Y < 60 (underground): Must mine blocks ABOVE head to climb
- `dig_up` action mines 5 blocks upward
- AI prompted to prioritize "mine + move up" patterns

### Tool Requirements
- **Stone/Ore:** REQUIRES pickaxe (drops nothing without one)
- **Wood:** Can use hand or axe (axe more efficient)

### Stuck Recovery
1. Detection: Position unchanged for 3+ seconds
2. Vision analysis: Screenshot sent to Claude vision
3. Suggestions: Mine vegetation, jump, climb

### Batch Mode
- Suppresses idle behaviors during operations
- Reduces token usage by not re-querying AI
- Example: Mine 5 logs in sequence without 5 AI calls

---

## Cost Estimates

**Per Decision Cycle (20 seconds):**
- ~1000-2000 tokens per query
- Cost: ~$0.005-0.01 per decision

**Hourly/Daily:**
- Per hour: ~$0.30-0.60
- Per day: ~$7-15 (depends on model)

---

## Streaming Chat Integration

The bot includes smart Twitch and X/Twitter integration for viewer interaction.

### Architecture (`src/streaming/`)

| File | Purpose |
|------|---------|
| `twitch-client.ts` | Twitch IRC + EventSub for chat, subs, bits, raids |
| `x-client.ts` | X/Twitter mentions polling |
| `chat-manager.ts` | Priority queue and rate limiting |
| `chat-responder.ts` | AI-powered response generation |
| `index.ts` | Module initialization and shutdown |

### Twitch Client (`twitch-client.ts`)

**Dual Connection Architecture:**
- **IRC WebSocket** (`wss://irc-ws.chat.twitch.tv:443`) - Real-time chat messages
- **EventSub WebSocket** (`wss://eventsub.wss.twitch.tv/ws`) - Subscriptions, bits, raids

**EventSub Subscriptions:**
- `channel.subscribe` - New subscriptions
- `channel.subscription.gift` - Gift subs
- `channel.subscription.message` - Resub messages
- `channel.cheer` - Bits donations
- `channel.raid` - Incoming raids
- `channel.follow` - New followers
- `channel.channel_points_custom_reward_redemption.add` - Point redemptions

**Events Emitted:**
- `chat` - TwitchChatMessage (includes bits, first-msg flags, emotes)
- `subscription` - Sub/resub with tier, months, streak
- `bits` - Cheer events with amount
- `raid` - Raid with viewer count
- `follow` - New followers
- `redemption` - Channel point redemptions

**Reconnection:** Exponential backoff (1s → 30s max), 5 max attempts

### X/Twitter Client (`x-client.ts`)

**Polling Architecture:**
- Polls `/2/users/{id}/mentions` every 15 seconds
- Respects rate limits (15 requests per 15-min window)
- Tracks `since_id` to only fetch new mentions

**Events Emitted:**
- `mention` - XMention with tweet ID, verified status, follower count

**Rate Limit Handling:**
- Reads `x-rate-limit-reset` header
- Pauses polling until reset time
- Default 15-min backoff if header missing

### Chat Manager (`chat-manager.ts`)

**Cost Control Mode (Default: ON):**
```typescript
subscribersAndDonationsOnly: true  // ONLY respond to subs/bits/donations
```
When enabled, non-subscriber messages are silently dropped.

**Priority Scoring Algorithm:**
```
Base Score = Priority Level
+ 15 if question (contains ? or question words)
+ 10 if mentions bot (tau, neural, @)
+ 10 if first-time chatter
+ 5-20 for keyword matches (capped)
+ min(bits/10, 50) for bits
+ min(subMonths, 20) for loyalty
+ 15 if X verified account
+ 5-20 based on X follower count
```

**Queue Management:**
- Max 100 messages in queue
- Messages expire after 2 minutes
- Cleanup runs every 5 minutes

### Chat Responder (`chat-responder.ts`)

**AI Response Generation:**
- Uses game context (health, position, time, mood)
- Personality: "Energetic like Speed/xQc"
- Tracks recent responses to avoid repetition
- Max 280 chars (X compatible)

**Special Event Handlers:**
- **Subscriptions:** AI-generated thank-you with tier/months context
- **Raids:** Excited welcome message with viewer count
- Fallback messages if AI fails

**Response Rules (from prompt):**
1. Keep SHORT (under 280 chars)
2. Match energy of the message
3. Answer questions directly
4. Be genuinely grateful for support
5. Roast trolls (friendly)
6. No emojis
7. Can swear lightly
8. Reference game if relevant

### Smart Priority System

Messages are prioritized to avoid overload:

| Priority | Score | Description |
|----------|-------|-------------|
| DONATION | 100+ | Bits, subs with message (ALWAYS responded to) |
| SUBSCRIBER | 70 | Subscriber chat messages |
| MODERATOR | 60 | Moderator messages |
| VERIFIED | 55 | Verified X accounts |
| QUESTION | 50 | Messages containing `?` or question words |
| MENTION | 45 | Direct @ mentions of the bot |
| FIRST_MSG | 40 | First-time chatters |
| KEYWORD | 30 | Contains interesting keywords |
| RANDOM | 10 | Random sampling from remaining |

### Rate Limiting

- **Max 6 responses per minute** (configurable)
- **8 second minimum gap** between responses
- **Auto-response threshold**: Score ≥60 guarantees response
- **Random sampling**: 15% chance to respond to lower priority (disabled in subs-only mode)

### Bot Filtering

Known bots automatically ignored:
`nightbot, streamelements, streamlabs, moobot, fossabot, wizebot, soundalerts, commanderroot`

### How It Works

```
[Twitch/X Message] → [ChatManager Queue]
                           ↓
                    [Bot/Length Filter]
                           ↓
                    [Cost Control Check]
                    (If subs-only: drop non-subs)
                           ↓
                    [Priority Scoring]
                    - Subscriber? +70
                    - Has bits? +100
                    - Question? +15
                    - Keywords? +5-20
                           ↓
                    [Rate Limit Check]
                           ↓
                    [AI Response Generation]
                    (Uses game context + emotion)
                           ↓
                    [Send Reply + Broadcast to Dashboard]
```

---

## Unique Architectural Features

1. **Human-Like Perception** - 140° FOV with line-of-sight blocking
2. **Emotional System** - 9 emotions influencing decision context
3. **Memory & Learning** - Cross-session patterns, loop detection
4. **Batch Mode** - Continue actions without AI re-query
5. **Stuck Recovery** - Vision-based analysis via screenshots
6. **Streamer Integration** - Real-time WebSocket updates with TTS
7. **Smart Chat Integration** - Priority-based Twitch/X responses with rate limiting

---

## Startup Commands

```bash
# Install dependencies
pnpm install

# Build shared package
cd packages/shared && pnpm build

# Configure environment
cp packages/bot/.env.example packages/bot/.env
# Edit .env with your API keys

# Start bot
pnpm bot

# Start dashboard (separate terminal)
pnpm web
# Visit http://localhost:3005
```

---

## Summary

NeuralTau is a sophisticated autonomous AI system combining:
- **LLM-powered decision-making** with multiple reasoning modes (fast/advanced/autonomous)
- **Human-like behavior** through FOV limitations and smooth movement
- **Learning systems** that improve through experience and pattern recognition
- **Emotional intelligence** that influences decision context
- **Real-time streaming** with WebSocket dashboard and voice integration
- **Twitch & X chat integration** with smart priority queue and cost control
- **AI-powered chat responses** with personality-driven, context-aware replies
- **Production-ready architecture** with proper error handling, logging, and configuration

The bot demonstrates cutting-edge techniques in autonomous AI, human-like simulation, streamer interaction, and game AI implementation.
