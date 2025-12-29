# 🎮 Minecraft Quick Start (1 Minute!)

The fastest way to test Tau playing Minecraft on your Mac.

## Super Quick (Public Server)

1. **Edit your .env:**
```bash
# Open in your editor
code /Users/0xroyce/PycharmProjects/tau/packages/bot/.env

# Or use nano
nano /Users/0xroyce/PycharmProjects/tau/packages/bot/.env
```

2. **Change GAME_MODE to minecraft:**
```env
GAME_MODE=minecraft
```

3. **That's it! Start Tau:**
```bash
cd /Users/0xroyce/PycharmProjects/tau
pnpm start
```

4. **Open dashboard:**
```
http://localhost:3005
```

You should see Tau connecting to localhost:25565 (default Minecraft server).

---

## If You Don't Have a Minecraft Server

### Option A: Use Public Server (Easiest!)

Add to your `.env`:
```env
MINECRAFT_HOST=play.cubecraft.net
MINECRAFT_PORT=25565
```

**Good servers to try:**
- `play.cubecraft.net` - CubeCraft
- `mc.hypixel.net` - Hypixel (most popular)
- `play.mineplex.com` - Mineplex

### Option B: Quick Local Server (Mac)

```bash
# Install Java if you don't have it
brew install openjdk@17

# Download and run server
mkdir ~/minecraft-server && cd ~/minecraft-server
curl -O https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar
echo "eula=true" > eula.txt
java -Xmx2G -Xms1G -jar server.jar nogui
```

Wait for "Done!" then Tau can connect to `localhost:25565`

---

## What You'll See

### Terminal:
```
[bot]  Game Mode: minecraft
[bot]  Connecting to Minecraft server...
[bot]  Successfully spawned in Minecraft world
[bot]  Position: (123, 64, -456)
[bot]  🤖 Tau: I'm in a plains biome, I see grass and trees nearby...
```

### Dashboard (http://localhost:3005):
- **Position:** X, Y, Z coordinates
- **Health & Food:** 20/20, 20/20
- **Inventory:** Items Tau has collected
- **Nearby Blocks:** grass, dirt, stone, oak_log...
- **Nearby Entities:** cow, sheep, zombie...
- **AI Decisions:** "I should gather wood first..."

---

## Common Issues

### "ECONNREFUSED" or "Connection refused"
- Server isn't running
- Wrong host/port
- Try a public server instead

### "Failed to verify username"
- Normal for offline mode
- Public servers might kick you
- Use local server or find bot-friendly server

### Bot just stands there
- Normal! AI makes decisions every 30 seconds
- Watch the dashboard for reasoning
- Check terminal for logs

---

## Next Steps

Once connected:
1. ✅ Watch Tau explore
2. ✅ See AI decisions (mine, build, move)
3. ✅ Real-time stats in dashboard
4. ✅ Fully autonomous gameplay!

Then you can:
- Set specific goals in the AI prompt
- Add Twitch streaming
- Let viewers donate to upgrade Tau
- Stream 24/7 on Railway

---

**Ready? Just change `GAME_MODE=minecraft` and run `pnpm start`!** 🎮
