# 🎮 Command Reference

Quick reference for all Tau commands.

## 🚀 Getting Started

```bash
# Initial setup (run once)
pnpm setup

# Copy environment file
cp packages/bot/.env.example packages/bot/.env

# Edit .env and add your API keys
# Then you're ready to run!
```

## 🤖 Running Tau

```bash
# Start EVERYTHING (bot + dashboard) - RECOMMENDED
pnpm start

# Run bot only (for debugging)
pnpm bot

# Run dashboard only (for development)
pnpm web

# Run bot in production mode
pnpm bot:prod

# Stop all services
Ctrl+C
```

## 🔨 Development Commands

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Build shared package only
cd packages/shared && pnpm build

# Clean everything
pnpm clean

# Watch mode (auto-rebuild on changes)
cd packages/shared && pnpm dev
```

## 📦 Package-Specific Commands

```bash
# Bot package
cd packages/bot
pnpm dev          # Run in dev mode
pnpm build        # Build for production
pnpm start        # Run production build

# Shared package
cd packages/shared
pnpm dev          # Build and watch for changes
pnpm build        # Build once
```

## 🔧 Useful Commands

```bash
# Check pnpm version
pnpm --version

# Check Node version
node --version

# List all workspaces
pnpm list -r --depth 0

# Update dependencies
pnpm update

# Clean install (if things break)
pnpm clean
rm -rf node_modules
pnpm install
pnpm setup
```

## 🐛 Debugging

```bash
# Check if shared package is built
ls packages/shared/dist

# Rebuild shared package
cd packages/shared
rm -rf dist
pnpm build

# Check OpenRouter API
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"

# Check environment variables
cd packages/bot
cat .env
```

## 🎯 Testing Different Models

Edit `packages/bot/.env`:

```bash
# Use Claude Opus (more powerful)
AI_DEFAULT_MODEL=anthropic/claude-opus-4

# Use GPT-4
AI_DEFAULT_MODEL=openai/gpt-4o

# Use cheaper Claude
AI_DEFAULT_MODEL=anthropic/claude-3.5-sonnet

# Mix and match
AI_DEFAULT_MODEL=anthropic/claude-sonnet-4.5
AI_VISION_MODEL=openai/gpt-4o
```

## 📊 Monitoring

```bash
# Watch logs in real-time
pnpm bot

# Check OpenRouter usage
# Visit: https://openrouter.ai/activity

# Check ElevenLabs usage
# Visit: https://elevenlabs.io/usage
```

## 🚢 Deployment (Coming Soon)

```bash
# Deploy to Railway
railway up

# Deploy to Vercel
vercel deploy

# Environment variables for production
railway variables set OPENROUTER_API_KEY=xxx
```

## 💡 Pro Tips

```bash
# Run bot with specific model (override .env)
AI_DEFAULT_MODEL=anthropic/claude-opus-4 pnpm bot

# Adjust decision speed (edit packages/shared/src/constants.ts)
AI_DECISION_INTERVAL: 15000  # Faster (15s)
AI_DECISION_INTERVAL: 60000  # Slower (1min)

# Check logs with timestamps
pnpm bot | tee logs.txt
```

## 📝 Quick Edits

| What to Change | File to Edit |
|----------------|--------------|
| API Keys | `packages/bot/.env` |
| AI Models | `packages/bot/.env` |
| Personality | `packages/shared/src/constants.ts` |
| Decision Speed | `packages/shared/src/constants.ts` |
| Game Logic | `packages/bot/src/games/text-adventure.ts` |
| AI Behavior | `packages/bot/src/ai/brain.ts` |

## 🎓 Learning the Codebase

```bash
# Main entry point
packages/bot/src/index.ts

# AI decision making
packages/bot/src/ai/brain.ts

# OpenRouter client
packages/bot/src/ai/openrouter.ts

# Game implementation
packages/bot/src/games/text-adventure.ts

# Shared types
packages/shared/src/types.ts

# Configuration
packages/bot/src/config.ts
```

---

**Keep this file handy!** Bookmark it for quick command reference.
