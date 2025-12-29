# 🚀 Quick Setup Guide

Follow these steps to get Tau running in the next 10 minutes!

## Step 1: Get Your API Keys

### OpenRouter (Required)
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up and log in
3. Go to "Keys" section
4. Create a new API key
5. Add $10-20 credits to your account
6. Copy your API key

### ElevenLabs (Optional - for voice)
1. Go to [elevenlabs.io](https://elevenlabs.io)
2. Sign up and log in
3. Go to your profile → API keys
4. Copy your API key
5. Go to "Voices" section
6. Choose a voice and copy its Voice ID

## Step 2: Configure the Bot

```bash
cd packages/bot
cp .env.example .env
```

Edit `.env` and paste your keys:

```env
# REQUIRED
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxx

# OPTIONAL (for voice)
ELEVENLABS_API_KEY=xxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_VOICE_ID=xxxxxxxxxxxxxxxxxxxxx

# Models (already configured, but you can change)
AI_DEFAULT_MODEL=anthropic/claude-sonnet-4.5
AI_VISION_MODEL=anthropic/claude-sonnet-4.5
```

## Step 3: Run It!

```bash
# From the tau directory
pnpm bot
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║                      TAU - TEXT ADVENTURE                  ║
╚════════════════════════════════════════════════════════════╝

You are in the Starting Room. You are in a dimly lit room...
Available exits: north
Items you can see: chest, torch
Your inventory: empty
Score: 0 | Moves: 0

[INFO] 🚀 Tau Bot starting up!
[INFO] --- AI Decision Cycle Starting ---
🤖 Tau: I should explore this room first and pick up useful items...
📝 Result: You pick up the torch. You now have it in your inventory. (+10 points)
```

## Step 4: Watch the Magic

Every 30 seconds, Tau will:
1. Analyze the current situation
2. Think about what to do
3. Make a decision
4. Execute the action
5. Log everything

You'll see the AI's reasoning and the results in real-time!

## 🎮 What's Happening?

The bot is playing a text adventure game to demonstrate:
- ✅ AI decision making (using Claude)
- ✅ Game state analysis
- ✅ Action execution
- ✅ Logging and monitoring
- ✅ Autonomous operation

## 🔧 Troubleshooting

### "Configuration error"
- Make sure you copied `.env.example` to `.env`
- Check that your API key is valid
- Ensure you have credits in OpenRouter

### "Failed to make game decision"
- Check your internet connection
- Verify OpenRouter API key is correct
- Check OpenRouter dashboard for errors

### "Module not found"
- Run `pnpm install` from root
- Build shared package: `cd packages/shared && pnpm build`

## 📊 Monitoring Costs

Watch your OpenRouter usage at: https://openrouter.ai/activity

With the text adventure:
- Each decision: ~1000-2000 tokens (~$0.005-0.01)
- Per hour: ~$0.30-0.60
- Per day: ~$7-15

You can adjust `AI_DECISION_INTERVAL` in `packages/shared/src/constants.ts` to reduce costs.

## 🎯 Next Steps

Once you see it working:

1. **Experiment with models**: Try different models in `.env`
2. **Adjust personality**: Edit system prompt in `packages/shared/src/constants.ts`
3. **Add Twitch**: We'll integrate Twitch next
4. **Add wallet**: Set up crypto donations
5. **Deploy**: Push to Railway for 24/7 operation

## 💡 Tips

- Press `Ctrl+C` to stop the bot
- Check logs in console for debugging
- The AI learns from its actions (via conversation history)
- Score increases when it picks up items

## 🎉 You're Ready!

If you see the bot making decisions and playing the game, **you're all set!**

The foundation is working. Now we can add:
- Twitch streaming
- Chat interaction
- Crypto wallet
- OBS integration
- Dashboard
- And more!

---

**Need help?** Check the full docs in [README.md](./README.md) or [AUTONOMOUS_AI_STREAMER.md](./AUTONOMOUS_AI_STREAMER.md)
