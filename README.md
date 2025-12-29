# Tau - Autonomous AI Streamer

The world's first fully autonomous AI streamer that operates 24/7, earns crypto donations, and uses its earnings to upgrade itself.

## 🎯 Goal

Build an AI that streams 24/7 and becomes the first AI millionaire through community donations.

## 📦 Project Structure

```
tau/
├── packages/
│   ├── shared/          # Shared types, utilities, constants
│   ├── bot/             # Main AI bot (runs on Railway)
│   └── web/             # Next.js dashboard (runs on Vercel)
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- OpenRouter API key
- ElevenLabs API key (optional for voice)

### Installation

```bash
# Install dependencies
pnpm install

# Build shared package
cd packages/shared
pnpm build

# Go back to root
cd ../..
```

### Configuration

1. Copy the example environment file:

```bash
cd packages/bot
cp .env.example .env
```

2. Edit `.env` and add your API keys:

```env
# Required
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional (for voice)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here

# Models (configurable!)
AI_DEFAULT_MODEL=anthropic/claude-sonnet-4.5
AI_VISION_MODEL=anthropic/claude-sonnet-4.5
```

### Run Everything

```bash
# Single command to start bot + dashboard
pnpm start
```

Then open **http://localhost:3005** to see the visual dashboard!

**Or run separately:**

```bash
# Terminal 1: Bot only
pnpm bot

# Terminal 2: Dashboard only
pnpm web
```

## 🎮 Current Features

### ✅ Implemented (MVP)

- **AI Brain**: OpenRouter integration with configurable models
- **Text Adventure Game**: Simple game for testing AI decisions
- **Voice**: ElevenLabs TTS integration (optional)
- **Configuration**: Easy model switching at runtime
- **Logging**: Comprehensive logging system
- **Decision Loop**: AI makes decisions every 30 seconds
- **Web Dashboard**: Real-time visual interface with WebSocket updates
- **Live Stats**: Score, moves, inventory tracking
- **Decision History**: See AI reasoning in real-time

### 🚧 Coming Soon

- **Twitch Integration**: Chat reading and streaming
- **Blockchain**: Crypto wallet and donation handling
- **OBS Integration**: Automated streaming
- **Minecraft**: More complex game integration
- **Memory**: Remember viewers and conversations
- **Milestones**: Auto-mint NFTs at goals

## 🧠 How It Works

1. **AI Brain** analyzes the current game state
2. **Decision Making** using Claude/GPT via OpenRouter
3. **Action Execution** in the game
4. **Logging** all decisions and outcomes
5. **Repeat** every 30 seconds

## 🎛️ Configuration

### Changing AI Models

You can switch models at any time by editing your `.env` file:

```env
# Use different models
AI_DEFAULT_MODEL=anthropic/claude-opus-4
AI_VISION_MODEL=anthropic/claude-sonnet-4.5

# Or use OpenAI
AI_DEFAULT_MODEL=openai/gpt-4o
AI_VISION_MODEL=openai/gpt-4o
```

Available models:
- `anthropic/claude-sonnet-4.5` (recommended)
- `anthropic/claude-opus-4` (more powerful, more expensive)
- `openai/gpt-4o` (fast and capable)
- `openai/gpt-4-turbo` (good balance)

### Adjusting Personality

Edit the system prompt in `packages/shared/src/constants.ts` to change Tau's personality.

### Timing Configuration

Adjust decision intervals in `packages/shared/src/constants.ts`:

```typescript
export const TIMING = {
  AI_DECISION_INTERVAL: 30000, // 30 seconds
  // ... other timings
};
```

## 📊 Monitoring

The bot logs everything to console with timestamps:

```
2024-01-20T10:30:00.000Z [INFO] [AI-Brain] Making game decision
2024-01-20T10:30:02.000Z [INFO] [OpenRouter] Chat request successful
2024-01-20T10:30:02.000Z [INFO] [AI-Brain] Game decision made
```

## 🔧 Development

### Build Shared Package

```bash
cd packages/shared
pnpm build
```

### Watch Mode (for development)

```bash
# Terminal 1: Build shared package in watch mode
cd packages/shared
pnpm dev

# Terminal 2: Run bot in watch mode
cd packages/bot
pnpm dev
```

### Clean Build

```bash
# From root
pnpm clean
pnpm install
pnpm build
```

## 📝 Testing

Currently, the bot runs a text adventure game to test AI decision-making:

```bash
pnpm bot
```

You'll see:
- Game state summary
- AI reasoning for each decision
- Action results
- Score and progress

## 🎯 Next Steps

1. **Test the MVP**: Run the bot and watch it play the text adventure
2. **Add Twitch**: Integrate Twitch chat and streaming
3. **Add Wallet**: Set up Base wallet for donations
4. **Deploy**: Push to Railway for 24/7 operation
5. **Launch**: Go live and start the journey to $1M!

## 💰 Cost Estimates

With current setup:
- **OpenRouter**: ~$50-150/month (depends on usage)
- **ElevenLabs**: $22/month (or free tier for testing)
- **Total**: ~$75-175/month for AI costs

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+ with TypeScript
- **AI**: OpenRouter (Claude/GPT)
- **Voice**: ElevenLabs
- **Blockchain**: Base L2 (coming soon)
- **Database**: Supabase (coming soon)
- **Streaming**: OBS + Twitch (coming soon)
- **Deploy**: Railway (bot) + Vercel (dashboard)

## 📖 Documentation

- See [AUTONOMOUS_AI_STREAMER.md](./AUTONOMOUS_AI_STREAMER.md) for full project plan
- Check `packages/shared/src/types.ts` for all type definitions
- Check `packages/shared/src/constants.ts` for configuration options

## 🤝 Contributing

This is a revolutionary experiment! Ideas and contributions welcome.

## 📄 License

MIT

---

**Built with ❤️ and AI**

*Tau is an autonomous AI streamer working toward becoming the first AI millionaire. Watch the journey unfold live.*
