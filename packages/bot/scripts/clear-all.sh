#!/bin/bash
# =============================================================================
# FULL RESET - Bot Memory + Minecraft Server Player Data
# Run this when starting a completely fresh map
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"
MC_SERVER_DIR="${MC_SERVER_DIR:-/Users/0xroyce/tau-minecraft}"

echo "🧹 FULL RESET - Bot Memory + Minecraft Player Data"
echo "   Bot directory: $BOT_DIR"
echo "   MC Server: $MC_SERVER_DIR"
echo ""

# ============================================================================
# PART 1: Clear Bot Memory
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Clearing Bot Memory..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Clear decision logs
rm -f "$BOT_DIR/data/decision-logs"/*.json 2>/dev/null || true
echo "✅ Cleared decision logs"

# Clear minecraft memory
rm -f "$BOT_DIR/data/minecraft-memory"/*.json 2>/dev/null || true
echo "✅ Cleared minecraft memory"

# Clear viewer memory
rm -f "$BOT_DIR/data/viewer-memory.json" 2>/dev/null || true
echo "✅ Cleared viewer memory"

# Clear logs
rm -f "$BOT_DIR/logs"/*.log 2>/dev/null || true
echo "✅ Cleared log files"

echo ""

# ============================================================================
# PART 2: Clear Minecraft Server Player Data (ALL WORLDS)
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎮 Clearing Minecraft Player Data..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -d "$MC_SERVER_DIR" ]; then
    echo "⚠️  Minecraft server directory not found: $MC_SERVER_DIR"
    echo "   Set MC_SERVER_DIR environment variable to your server path"
    echo "   Example: MC_SERVER_DIR=/path/to/server ./clear-all.sh"
else
    # Find all world folders (they contain level.dat)
    WORLDS_CLEARED=0
    for WORLD_DIR in "$MC_SERVER_DIR"/*/; do
        if [ -f "${WORLD_DIR}level.dat" ]; then
            WORLD_NAME=$(basename "$WORLD_DIR")
            
            # Clear playerdata
            if [ -d "${WORLD_DIR}playerdata" ]; then
                rm -f "${WORLD_DIR}playerdata"/*.dat 2>/dev/null || true
                echo "✅ Cleared playerdata for: $WORLD_NAME"
                ((WORLDS_CLEARED++))
            fi
            
            # Clear advancements
            if [ -d "${WORLD_DIR}advancements" ]; then
                rm -f "${WORLD_DIR}advancements"/*.json 2>/dev/null || true
                echo "✅ Cleared advancements for: $WORLD_NAME"
            fi
            
            # Clear stats
            if [ -d "${WORLD_DIR}stats" ]; then
                rm -f "${WORLD_DIR}stats"/*.json 2>/dev/null || true
                echo "✅ Cleared stats for: $WORLD_NAME"
            fi
        fi
    done
    
    if [ $WORLDS_CLEARED -eq 0 ]; then
        echo "⚠️  No Minecraft worlds found in $MC_SERVER_DIR"
    else
        echo ""
        echo "🎮 Cleared player data from $WORLDS_CLEARED world(s)"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 FULL RESET COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Restart Minecraft server"
echo "  2. Restart bot: pnpm dev"
echo ""

