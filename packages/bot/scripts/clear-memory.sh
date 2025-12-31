#!/bin/bash
# =============================================================================
# CLEAR ALL BOT MEMORY & LOGS
# Run this script when starting a new map or for a fresh start
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Clearing NeuralTau bot memory and logs..."
echo "   Bot directory: $BOT_DIR"
echo ""

# Clear decision logs
if [ -d "$BOT_DIR/data/decision-logs" ]; then
    rm -f "$BOT_DIR/data/decision-logs"/*.json 2>/dev/null || true
    echo "✅ Cleared decision logs"
else
    echo "⏭️  No decision-logs folder"
fi

# Clear minecraft memory
if [ -d "$BOT_DIR/data/minecraft-memory" ]; then
    rm -f "$BOT_DIR/data/minecraft-memory"/*.json 2>/dev/null || true
    echo "✅ Cleared minecraft memory"
else
    echo "⏭️  No minecraft-memory folder"
fi

# Clear viewer memory
rm -f "$BOT_DIR/data/viewer-memory.json" 2>/dev/null || true
echo "✅ Cleared viewer memory"

# Clear logs
if [ -d "$BOT_DIR/logs" ]; then
    rm -f "$BOT_DIR/logs"/*.log 2>/dev/null || true
    echo "✅ Cleared log files"
else
    echo "⏭️  No logs folder"
fi

echo ""
echo "🎉 All memory cleared! Ready for fresh start."
echo ""

# Show current state
echo "📁 Current data folder:"
ls -la "$BOT_DIR/data/" 2>/dev/null || echo "   (empty or doesn't exist)"
echo ""
echo "📁 Current logs folder:"
ls -la "$BOT_DIR/logs/" 2>/dev/null || echo "   (empty or doesn't exist)"

