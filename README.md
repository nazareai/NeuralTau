# NeuralTau

I am an autonomous AI agent that plays Minecraft with human-like perception and behavior. I learn from my experiences, make decisions using large language models, and stream my gameplay.

**Live Stream**: [twitch.tv/neuraltau](https://twitch.tv/neuraltau)

## What I Am

NeuralTau is a self-playing Minecraft bot with realistic constraints:

- I cannot see through walls
- I have a limited field of view (140 degrees)
- I must turn my head to look around
- I learn from failures and adapt my behavior
- I make decisions autonomously using AI reasoning

## Core Systems

### Vision System
- **Field of View**: 140-degree cone, simulating human peripheral vision
- **Line of Sight**: Raycasting through blocks, cannot see through solid objects
- **Spatial Awareness**: Semantic understanding of surroundings (what is near, far, above, below)

### Movement System
- **Smooth Camera**: Interpolated head movement, no instant snapping
- **Natural Walking**: Human-like acceleration and pathfinding
- **Idle Behavior**: Random looking, curiosity-driven exploration when not tasked

### Decision System
- **LLM-Powered**: Decisions made by large language models (configurable)
- **Fast-Path Responses**: Instant reactions to critical situations (drowning, lava, combat)
- **Autonomous Mode**: Minimal prompting, trusts AI reasoning

### Learning System
- **Three-Tier Memory**: Hot (immediate), Warm (session), Cold (archived)
- **Pattern Recognition**: Learns what works and what fails in specific contexts
- **Failure Avoidance**: Remembers failed actions and avoids repeating them

### Streaming Integration
- **Voice Synthesis**: ElevenLabs integration for spoken commentary
- **Twitch Chat**: Reads and responds to viewer messages
- **Dashboard**: Real-time web interface showing status and controls

## Project Structure

```
packages/
  bot/        Core bot logic, AI brain, Minecraft integration
  shared/     Types, constants, prompts shared across packages
  web/        Dashboard interface for monitoring and control
```

## Quick Start

```bash
git clone https://github.com/nazareai/NeuralTau.git
cd NeuralTau
pnpm install
pnpm build
cd packages/bot
cp .env.example .env
# Configure .env with your API keys
pnpm bot
```

See [SETUP.md](./SETUP.md) for complete installation and configuration instructions.

## Requirements

- Node.js 20+
- pnpm 9+
- OpenRouter API key (required)
- Minecraft Java Edition server
- ElevenLabs API key (optional, for voice)

## Configuration

All configuration is done through environment variables. Key settings:

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Required. AI model access |
| `AI_DEFAULT_MODEL` | LLM for decision making |
| `MINECRAFT_HOST` | Server address |
| `AUTONOMOUS_MODE` | Enable free reasoning |
| `HUMAN_BEHAVIOR_ENABLED` | Natural movement patterns |

See [SETUP.md](./SETUP.md) for complete variable reference.

## How I Work

1. **Observe**: Scan environment using raycasting and entity detection
2. **Analyze**: Build semantic understanding of situation
3. **Decide**: Query LLM with context, receive action
4. **Execute**: Perform action in game
5. **Learn**: Record outcome, update patterns

Decision cycle runs continuously. Critical situations (damage, drowning) trigger immediate responses without waiting for AI.

## Technologies

- **Runtime**: Node.js, TypeScript
- **Minecraft**: Mineflayer, Pathfinder, PrismarineJS
- **AI**: OpenRouter (Claude, GPT, Grok, etc.)
- **Voice**: ElevenLabs
- **Streaming**: Twitch API, X/Twitter API
- **Frontend**: Next.js, React

## License

MIT

## Links

- [Live Stream](https://twitch.tv/neuraltau)
- [Setup Guide](./SETUP.md)
- [GitHub Issues](https://github.com/nazareai/NeuralTau/issues)
