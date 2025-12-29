# 🎮 Quick Minecraft Server Setup (2 Minutes!)

Since `constantiam.net` requires authentication, let's set up a super quick local server.

## Option 1: Docker (Easiest if you have Docker)

```bash
docker run -d -p 25565:25565 \
  -e EULA=TRUE \
  -e ONLINE_MODE=FALSE \
  -e DIFFICULTY=peaceful \
  -e GAMEMODE=creative \
  --name tau-minecraft \
  itzg/minecraft-server

# Wait 30 seconds for server to start
# Then run Tau
pnpm start
```

## Option 2: Manual Setup (5 minutes)

```bash
# 1. Install Java (if needed)
brew install openjdk@17

# 2. Create server directory
mkdir -p ~/tau-minecraft-server
cd ~/tau-minecraft-server

# 3. Download server
curl -O https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar

# 4. Create eula.txt
echo "eula=true" > eula.txt

# 5. Create server.properties
cat > server.properties << 'EOF'
online-mode=false
difficulty=peaceful
gamemode=creative
max-players=10
server-port=25565
motd=Tau's Minecraft Server
spawn-protection=0
EOF

# 6. Start server (in a new terminal)
java -Xmx2G -Xms1G -jar server.jar nogui

# 7. Wait for "Done!" message
# 8. In your tau directory, run:
cd /Users/0xroyce/PycharmProjects/tau
pnpm start
```

## Option 3: Use Different Public Server

Try these servers that might allow offline mode:

**Edit `.env` and try:**

```env
# Try option 1
MINECRAFT_HOST=2b2t.org
MINECRAFT_VERSION=1.12.2

# Or option 2
MINECRAFT_HOST=mc.hypixel.net
MINECRAFT_VERSION=1.8.9

# Or option 3 - Aternos (if available)
MINECRAFT_HOST=YourAternosServer.aternos.me
MINECRAFT_VERSION=1.20.1
```

## Recommended: Docker Method

If you have Docker installed:

```bash
# Start server
docker run -d -p 25565:25565 \
  -e EULA=TRUE \
  -e ONLINE_MODE=FALSE \
  -e DIFFICULTY=peaceful \
  -e GAMEMODE=creative \
  --name tau-minecraft \
  itzg/minecraft-server

# Check if running
docker logs -f tau-minecraft
# Wait for "Done!"

# Stop with:
docker stop tau-minecraft

# Remove with:
docker rm tau-minecraft
```

## Your .env Should Be:

```env
GAME_MODE=minecraft
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=Tau
MINECRAFT_VERSION=1.20.1
MINECRAFT_AUTH=offline
```

Then run:
```bash
pnpm start
```

---

**Which method do you want to try?**
- Docker (fastest if you have it)
- Manual (takes 5 min but you control everything)
- Different public server (try your luck)
