# 🚀 How to Start Tau with Visual Dashboard

## Super Simple (1 Command!)

```bash
pnpm start
```

That's it! This will launch:
- ✅ Bot (AI brain + WebSocket server)
- ✅ Dashboard (Visual interface)

Then open your browser to: **http://localhost:3005**

---

## What You'll See

### In Your Terminal:
```
🚀 Starting Tau - Autonomous AI Streamer...

[bot]  ✅ Tau Bot is now running!
[bot]  WebSocket server started on port 3002
[web]  ▲ Next.js 15.1.3
[web]  - Local:   http://localhost:3005
[bot]  --- AI Decision Cycle Starting ---
[bot]  🤖 Tau: The room is dimly lit...
```

Both services run in the same terminal with color-coded output:
- **[bot]** = Blue (AI brain)
- **[web]** = Magenta (Dashboard)

### In Your Browser (http://localhost:3005):
```
┌─────────────────────────────────────────────────┐
│  🟢 LIVE        τ TAU - Autonomous AI Streamer  │
│  Score: 20  |  Moves: 2  |  Room: Starting Room│
└─────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│  🎮 Game State      │  │  📜 Decision History│
│                     │  │                     │
│  Location: Kitchen  │  │  "I should grab..." │
│  Items: bread       │  │  → interact torch   │
│  Inventory: torch   │  │                     │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────────────────────────────────┐
│  🤖 Tau is thinking...                          │
│  "The room is dimly lit, I need the torch..."   │
│  Action: interact → torch                       │
└─────────────────────────────────────────────────┘
```

---

## Dashboard Features

- ✅ **Live Status** - Green dot when connected
- ✅ **Real-time Stats** - Score, moves, room, items
- ✅ **Game Visualization** - Current location and available actions
- ✅ **AI Thoughts** - See Tau's reasoning as it happens
- ✅ **Decision History** - Last 10 decisions with timestamps
- ✅ **Results Feed** - See outcomes of actions
- ✅ **Animated UI** - Glowing effects when Tau is thinking

---

## Alternative: Run Separately (Advanced)

If you want more control, you can still run them separately:

### Terminal 1: Bot Only
```bash
pnpm bot
```

### Terminal 2: Dashboard Only
```bash
pnpm web
```

---

## Stopping the Services

Press `Ctrl+C` once to stop both services gracefully.

If one service crashes, the other will automatically stop too.

---

## Troubleshooting

### Dashboard shows "OFFLINE"
- Wait a few seconds for bot to start
- Refresh browser page
- Check terminal for errors

### Port Already in Use
```bash
# Kill processes on ports 3000 and 3001
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9

# Then restart
pnpm start
```

### "Module not found" errors
```bash
pnpm install
cd packages/shared && pnpm build
cd ../..
pnpm start
```

---

## What Happens When You Run `pnpm start`

1. **Concurrently** launches both services in parallel
2. **Bot** starts AI brain + WebSocket server (port 3002)
3. **Dashboard** starts Next.js dev server (port 3000)
4. **Browser** connects to dashboard via http://localhost:3005
5. **Dashboard** connects to bot via WebSocket (ws://localhost:3002)
6. **Real-time updates** flow from bot → dashboard → you!

---

## Next Steps

Once you see it working:

1. ✅ **Watch Tau play** - See the AI make decisions
2. ✅ **Understand the flow** - Decision → Action → Result
3. ✅ **See it think** - AI reasoning displayed in real-time

Then we can add:
- 🎮 **Minecraft** - Actual 3D game with visuals
- 📺 **Twitch Streaming** - Go live to the world
- 💬 **Chat Integration** - Viewers interact with Tau
- 💰 **Crypto Wallet** - Accept donations
- 🎙️ **Voice Output** - Tau speaks via TTS
- 🎨 **VTuber Avatar** - Animated character

---

**Ready? Just run:**

```bash
pnpm start
```

Then open http://localhost:3005 and watch the magic! 🎉
