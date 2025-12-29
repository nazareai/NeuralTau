# 🎮 Minecraft Setup Guide

To test Tau playing Minecraft, you need a Minecraft server. Here are your options:

## Option 1: Use a Public Server (Easiest!)

Just connect to an existing public server that allows bots:

```bash
# Edit packages/bot/.env
GAME_MODE=minecraft
MINECRAFT_HOST=play.cubecraft.net
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=Tau
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

**Good public servers for testing:**
- `play.cubecraft.net` - CubeCraft (usually allows bots)
- `mc.hypixel.net` - Hypixel (very popular)
- `play.mineplex.com` - Mineplex

**Note:** Some servers may kick bots. If that happens, try a different server.

---

## Option 2: Run Local Server (Mac)

### Step 1: Download Minecraft Server

```bash
# Create server directory
mkdir ~/minecraft-server
cd ~/minecraft-server

# Download server jar (1.20.1)
curl -O https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar

# Rename it
mv server.jar minecraft_server.1.20.1.jar
```

### Step 2: Accept EULA

```bash
# Run once to generate eula.txt
java -Xmx1024M -Xms1024M -jar minecraft_server.1.20.1.jar nogui

# Accept EULA
echo "eula=true" > eula.txt
```

### Step 3: Configure Server

Edit `server.properties`:

```bash
# Important settings for bot testing
online-mode=false          # Allow offline mode (no Microsoft account needed)
difficulty=peaceful        # No monsters to kill the bot
gamemode=survival         # Or creative for testing
max-players=10
server-port=25565
```

### Step 4: Start Server

```bash
java -Xmx2G -Xms1G -jar minecraft_server.1.20.1.jar nogui
```

Wait for "Done!" message. Server is now running on `localhost:25565`

### Step 5: Connect Tau

```bash
# In packages/bot/.env
GAME_MODE=minecraft
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=Tau
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

---

## Option 3: Docker (If you have Docker)

```bash
docker run -d -p 25565:25565 \
  -e EULA=TRUE \
  -e ONLINE_MODE=FALSE \
  -e DIFFICULTY=peaceful \
  --name minecraft-server \
  itzg/minecraft-server
```

---

## Testing the Connection

### 1. Start Minecraft Server
- Public server: Already running
- Local server: Run the java command above

### 2. Update Your .env

```bash
cd /Users/0xroyce/PycharmProjects/tau/packages/bot

# Add these lines to .env
GAME_MODE=minecraft
MINECRAFT_HOST=localhost    # or play.cubecraft.net
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=Tau
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

### 3. Start Tau

```bash
cd /Users/0xroyce/PycharmProjects/tau
pnpm start
```

### 4. Watch in Dashboard

Open http://localhost:3005 and you should see:
- Tau connecting to Minecraft
- Position, health, food stats
- Inventory items
- Nearby blocks and entities
- AI decisions specific to Minecraft!

---

## Troubleshooting

### "Connection refused" or timeout
- Make sure server is running
- Check firewall settings
- Try a public server instead

### "Failed to verify username"
- Set `MINECRAFT_AUTH=offline`
- Set `online-mode=false` in server.properties

### Bot gets kicked
- Some servers don't allow bots
- Try a different server
- Use your own local server

### "Unsupported protocol version"
- Make sure `MINECRAFT_VERSION` matches server version
- Check server version with `status` command

---

## Recommended: Local Server for Development

For best results while developing:
1. Run local server (full control)
2. Set to peaceful mode (no combat)
3. Set to creative mode (for testing builds)
4. Use offline mode (no Microsoft account needed)

---

## Mac-Specific Notes

### Java Installation

If you don't have Java:

```bash
# Install with Homebrew
brew install openjdk@17

# Add to PATH
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify
java --version
```

### Server Performance

Minecraft server can use a lot of RAM. Recommended:
- **Minimum:** 1GB (`-Xmx1G`)
- **Recommended:** 2GB (`-Xmx2G`)
- **If laggy:** 4GB (`-Xmx4G`)

---

## Next Steps

Once connected:
1. ✅ Bot will spawn in the world
2. ✅ AI will analyze surroundings
3. ✅ Make autonomous decisions (mine, build, explore)
4. ✅ Dashboard shows live Minecraft stats
5. ✅ Watch Tau play in real-time!

---

**Quick Start (Public Server):**

```bash
# Edit .env
GAME_MODE=minecraft
MINECRAFT_HOST=play.cubecraft.net

# Run
pnpm start

# Open
http://localhost:3005
```

That's it! Tau is now playing Minecraft! 🎉
