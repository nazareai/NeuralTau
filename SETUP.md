# NeuralTau Setup Guide

This document contains instructions for deploying me. Follow each section in order.

## Prerequisites

- Node.js 18 or higher
- pnpm package manager
- Minecraft Java Edition server (for Minecraft mode)
- API keys for required services

## Step 1: Install Dependencies

```bash
git clone https://github.com/nazareai/NeuralTau.git
cd NeuralTau
pnpm install
pnpm build
```

## Step 2: Configure Environment

```bash
cd packages/bot
cp .env.example .env
```

Edit the `.env` file with your configuration. All available variables are documented below.

## Environment Variables

### Required

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Obtain from [openrouter.ai](https://openrouter.ai). Navigate to Keys section after registration. Add credits to your account.

### AI Models

```env
AI_DEFAULT_MODEL=x-ai/grok-4.1-fast:nitro
AI_VISION_MODEL=x-ai/grok-4.1-fast:nitro
AI_CHAT_MODEL=x-ai/grok-4.1-fast:nitro
AI_TEMPERATURE=0.1
```

Available models depend on your OpenRouter account. Lower temperature produces more deterministic decisions.

### Voice (Optional)

```env
ELEVENLABS_API_KEY=your-key-here
ELEVENLABS_VOICE_ID=your-voice-id
STREAMER_VOICE_ENABLED=true
```

Obtain from [elevenlabs.io](https://elevenlabs.io). Navigate to profile for API key, Voices section for Voice ID.

### Game Configuration

```env
GAME_MODE=minecraft
```

Options: `text-adventure`, `minecraft`, `pokemon`

### Minecraft Configuration

For local server:
```env
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=TAU5330
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

For online servers with Microsoft authentication:
```env
MINECRAFT_HOST=join.6b6t.org
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=TAU5330
MINECRAFT_VERSION=1.21
MINECRAFT_AUTH=microsoft
```

Note: Microsoft authentication requires logging in through the browser prompt on first run.

### Human Behavior Settings

These parameters make my movements appear more natural to observers.

```env
HUMAN_BEHAVIOR_ENABLED=true
HUMAN_BEHAVIOR_CURIOSITY=0.7
HUMAN_BEHAVIOR_CAUTION=0.8
HUMAN_BEHAVIOR_FOCUS=0.5
HUMAN_BEHAVIOR_LOOK_FREQUENCY=8000
HUMAN_BEHAVIOR_DEBUG=true
```

- `CURIOSITY`: Likelihood of exploring new areas (0.0-1.0)
- `CAUTION`: Risk aversion in dangerous situations (0.0-1.0)
- `FOCUS`: Task persistence vs distraction (0.0-1.0)
- `LOOK_FREQUENCY`: Milliseconds between idle look movements

### Autonomous Mode

```env
AUTONOMOUS_MODE=true
LOG_PROMPTS=true
```

Autonomous mode allows me to reason freely without rule-based constraints. Enable `LOG_PROMPTS` to see my decision-making process.

### Camera and Plugins

```env
THIRD_PERSON_VIEW=false
AUTO_EAT_ENABLED=true
AUTO_ARMOR_ENABLED=true
```

Disable auto plugins if you want me to learn these behaviors through experience.

### Dashboard Integration

```env
WAIT_FOR_DASHBOARD=true
```

When enabled, I will wait for the web dashboard to connect before beginning autonomous operation.

### Chat Integration

```env
CHAT_INTEGRATION_ENABLED=true
```

Enable to allow me to receive and respond to chat messages from streaming platforms.

### Twitch Configuration

```env
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret
TWITCH_ACCESS_TOKEN=your-access-token
TWITCH_REFRESH_TOKEN=your-refresh-token
TWITCH_CHANNEL_NAME=neuraltau
```

Obtain credentials from [dev.twitch.tv](https://dev.twitch.tv). Create an application to receive Client ID and Secret. Use OAuth flow to obtain Access and Refresh tokens.

### X/Twitter Configuration

```env
X_BEARER_TOKEN=your-bearer-token
X_BOT_USERNAME=NeuralTau
```

Obtain from [developer.twitter.com](https://developer.twitter.com). Requires approved developer account.

## Step 3: Run

### Development Mode

```bash
# Terminal 1: Start the bot
pnpm bot

# Terminal 2: Start the dashboard (optional)
pnpm web
```

### Production Mode

```bash
pnpm start
```

## Step 4: Verify Operation

Upon successful startup, you will see:

```
[INFO] NeuralTau Bot starting up!
[INFO] Goal: Survive and thrive in Minecraft
[INFO] AI Model: x-ai/grok-4.1-fast:nitro
[INFO] Game Mode: minecraft
[INFO] Learning system initialized (3-tier architecture)
[INFO] Game initialized successfully
[INFO] Connected to Minecraft server
```

The dashboard is available at `http://localhost:3000` when running.

## Troubleshooting

### Configuration error
- Verify `.env` file exists in `packages/bot`
- Confirm API key format is correct
- Check OpenRouter account has credits

### Connection failed
- Verify Minecraft server is running and accessible
- Check host and port configuration
- For Microsoft auth: complete browser authentication

### Module not found
- Run `pnpm install` from project root
- Run `pnpm build` to compile all packages

### Decision timeout
- Check network connectivity
- Verify OpenRouter API status
- Review logs for rate limiting

## Cost Estimation

OpenRouter charges per token. With default settings:

- Per decision: 500-2000 tokens
- Per hour: Variable based on decision frequency
- Monitor usage at [openrouter.ai/activity](https://openrouter.ai/activity)

Adjust `AI_DECISION_INTERVAL` in constants to control decision frequency.

## Architecture

```
packages/
  bot/      - Core bot logic, AI brain, game integration
  shared/   - Types, constants, prompts shared across packages
  web/      - Dashboard interface
```

## Support

For issues and contributions: [github.com/nazareai/NeuralTau](https://github.com/nazareai/NeuralTau)

---

End of setup documentation.
