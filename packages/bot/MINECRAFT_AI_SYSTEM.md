# Minecraft AI Decision-Making System

## Overview

The Minecraft bot now uses an **intelligent decision-making system** separated into a dedicated "brain" module. This allows for easy review and updates to game logic and strategies.

## Architecture

### Files
- **[minecraft-brain.ts](src/games/minecraft-brain.ts)** - All decision-making logic, prompts, and strategies
- **[minecraft.ts](src/games/minecraft.ts)** - Game execution and movement implementation

## Key Features

### 1. Vision-Based Obstacle Detection

When the bot gets stuck, it performs a **slow 360° vision analysis**:
- Scans 16 directions (every 22.5°) at 300ms per direction (smooth camera movement)
- Checks 10 blocks ahead in each direction
- Looks straight up to detect if underground with sky visible
- Generates detailed recommendations based on surroundings

**Example Output:**
```
[VISION-ANALYSIS] Complete
  blocksFound: 5
  clearPaths: 3
  canSeeSky: false
  recommendation: "Underground and blocked - DIG UP at 45° angle (staircase)"
```

### 2. Underground Escape Logic

When stuck underground (Y < 60):
- Automatically digs a **45° staircase upward** (safe technique)
- Uses proper tool checking before digging each block
- Detects bedrock (cannot dig through)
- Tracks progress and reports climb distance

**Features:**
- Never digs straight down (dangerous in Minecraft)
- Validates tool efficiency (won't waste pickaxe on dirt)
- Stops at bedrock with clear error message
- Returns to surface at Y=70 (safe level)

### 3. Tool-Aware Digging Logic

Before digging ANY block, the system checks:
- What tool is equipped (hand, pickaxe, axe, shovel)
- What block is being mined (stone, dirt, ore, etc.)
- If the tool is efficient for that block

**Efficiency Rules:**
```typescript
// GOOD: Stone pickaxe mining stone/ores ✓
// BAD: Pickaxe mining dirt ✗ (wastes durability, use shovel)
// BAD: Hand mining stone ✗ (drops nothing, need pickaxe)
// BAD: Wooden pickaxe mining diamond ✗ (need iron pickaxe)
```

### 4. Tool Progression System

The brain tracks progression through Minecraft's tool tiers:

```
HAND → WOOD TOOLS → STONE TOOLS → IRON TOOLS → DIAMOND → NETHERITE
```

**Priority Logic:**
1. If no wooden pickaxe → gather wood first
2. If wooden pickaxe but no stone tools → mine stone immediately
3. If stone tools → search for iron ore (major upgrade)
4. Always craft better tools before exploring

### 5. Game Strategy Prompts

All Minecraft strategies are defined in `MINECRAFT_PROMPTS` object for easy review:

#### Available Prompts:
- `INITIAL_STRATEGY` - What to do when spawning
- `WALL_STUCK_STRATEGY` - How to escape when hitting walls
- `UNDERGROUND_STRATEGY` - How to return to surface
- `MINING_DECISION` - Tool efficiency rules
- `TOOL_PROGRESSION` - Upgrade path
- `LOST_STRATEGY` - Recovery when disoriented
- `NIGHT_STRATEGY` - Survival during night (mob spawns)
- `LOW_HEALTH_STRATEGY` - Emergency health recovery
- `FOOD_STRATEGY` - Food sources and farming

**These prompts can be easily edited** without touching code logic.

### 6. Intelligent Decision Making

The `makeDecision()` function evaluates game state and returns best action:

```typescript
interface Decision {
  action: 'navigate' | 'dig' | 'craft' | 'fight' | 'flee' | 'dig_up_escape';
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  target?: { x, y, z } | string;
  tool?: string;
  prompt?: string; // Relevant strategy prompt
}
```

**Decision Priority:**
1. **CRITICAL** - Health < 6, in lava, deep underground without tools
2. **HIGH** - Night without shelter, underground (Y < 60), no basic tools
3. **MEDIUM** - Need better tools, hungry, searching for resources
4. **LOW** - Exploration, scanning environment

## How It Works

### Stuck Recovery Flow

```
Bot gets stuck (2.4 seconds no movement)
    ↓
intelligentStuckRecovery() called
    ↓
1. Analyze stuck situation (wall, underground, hole)
    ↓
2. Perform 360° vision analysis (slow camera sweep)
    ↓
3. Get current game state (health, tools, position, inventory)
    ↓
4. Make intelligent decision using brain
    ↓
5. Execute action:
   - dig_up_escape → digUpToSurface() [45° staircase]
   - look_around → Return vision recommendation
   - dig → Mine blocking obstacle with proper tool
   - flee → Retreat from danger
   - navigate → Pathfinder to target
```

### Tool Efficiency Check

Before ANY dig operation:

```typescript
shouldDigBlock(blockName, currentTool)
    ↓
Returns:
  {
    shouldDig: boolean,
    reason: string,
    recommendedTool?: string
  }
```

**Examples:**
```javascript
// ✓ ALLOWED
shouldDigBlock('stone', 'wooden_pickaxe')
// → { shouldDig: true, reason: 'Stone/ore block - correct tool equipped' }

// ✗ BLOCKED
shouldDigBlock('dirt', 'wooden_pickaxe')
// → { shouldDig: false, reason: 'Do NOT use pickaxe on dirt/sand (wastes durability)', recommendedTool: 'shovel or hand' }

// ✗ BLOCKED
shouldDigBlock('diamond_ore', 'stone_pickaxe')
// → { shouldDig: false, reason: 'Diamond/obsidian requires iron pickaxe or better', recommendedTool: 'iron_pickaxe' }
```

## Gameplay Logic Improvements

### Based on Research

The system incorporates optimal Minecraft strategies from:
- [Minecraft Survival Guide 2025](https://pinecone.academy/blog/minecraft-survival-guide-(2025-edition)-survive-thrive-build-your-world)
- [Beginner's Guide - Minecraft Wiki](https://minecraft.wiki/w/Tutorial:Beginner's_guide)
- [Tool Progression Guide](https://zap-hosting.com/en/blog/2025/12/ultimate-minecraft-tools-guide-crafting-efficiency-enchantments-optimization-explained/)

### Key Improvements:

1. **Never dig straight down** - Uses 45° staircase when escaping underground
2. **Tool efficiency** - Won't waste pickaxe durability on dirt
3. **Progression awareness** - Knows wood → stone → iron is critical path
4. **Underground detection** - Automatically tries to return to surface (Y > 60)
5. **Vision-based navigation** - Slow camera sweep to understand surroundings
6. **Bedrock detection** - Stops digging at world bottom with clear message

## Configuration

### Adjusting Strategies

Edit prompts in [minecraft-brain.ts](src/games/minecraft-brain.ts):

```typescript
export const MINECRAFT_PROMPTS = {
  UNDERGROUND_STRATEGY: `You are underground (y < 60). Your goal is to reach surface:
1. Check your Y coordinate - if below 60, you need to go UP
2. Look for natural caves that lead upward
3. If no caves, dig a staircase UP at 45-degree angle
...`,
  // Add your own strategies here!
}
```

### Adjusting Decision Logic

Edit `makeDecision()` function priorities:

```typescript
export function makeDecision(state: GameState): Decision {
  // CRITICAL: Life-threatening
  if (state.health < 6) {
    return { action: 'flee', priority: 'critical', ... }
  }

  // Add your own decision rules here!
}
```

## Testing

To test the new system:

1. **Spawn bot in cave/underground** - Should automatically dig up to surface
2. **Block bot with walls** - Should do 360° vision scan and find escape route
3. **Give bot wrong tools** - Should refuse to dig and request correct tool
4. **Monitor logs** - Watch `[VISION-ANALYSIS]`, `[STUCK-RECOVERY]`, `[DIG-UP]` messages

## Future Enhancements

Potential additions:
- [ ] Crafting recipes integration
- [ ] Mob detection and combat logic
- [ ] Food gathering automation
- [ ] Shelter building strategies
- [ ] Mining level optimization (Y=16 for diamonds)
- [ ] Day/night cycle awareness
- [ ] Biome-specific strategies
- [ ] Multi-agent coordination

## Logs to Watch

Key log prefixes:
- `[VISION-ANALYSIS]` - 360° camera sweep results
- `[VISION-N/S/E/W]` - Individual direction scans
- `[STUCK-RECOVERY]` - Intelligent recovery system activated
- `[DIG-UP]` - Underground escape in progress
- `[MOVEMENT-XX]` - Navigation session tracking

## API Reference

### Main Functions

**`makeDecision(state: GameState): Decision`**
- Evaluates current situation and returns best action
- Used by stuck recovery system

**`shouldDigBlock(blockName: string, currentTool: string | null): DiggingDecision`**
- Validates tool efficiency before mining
- Prevents wasted durability and failed mining attempts

**`analyzeStuckSituation(bot: Bot, positionHistory: Vec3[]): StuckAnalysis`**
- Detects if bot is stuck and why (wall, underground, falling)
- Returns recommended action

**`getCurrentGameState(bot: Bot): GameState`**
- Gathers all relevant game information (health, tools, position, surroundings)
- Used for decision-making

**`calculateEscapeDigDirection(pos: Vec3, targetY: number): DigDirection`**
- Calculates 45° upward angle for safe underground escape
- Returns yaw and pitch for staircase digging

---

**Note:** All prompts and logic are in separate files for easy maintenance and updates!
