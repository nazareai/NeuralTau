# Human-Like AI Player Architecture

## The Vision: A Truly Human AI Player

This document is the guiding architecture for building an AI Minecraft player that is **indistinguishable from a human player** in behavior, perception, and decision-making. Not just "good enough" - but genuinely human-like.

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [System Architecture](#system-architecture)
3. [Perception System (FOV)](#perception-system-fov)
4. [Movement System](#movement-system)
5. [Decision System](#decision-system)
6. [Behavior System](#behavior-system)
7. [Memory & Learning](#memory--learning)
8. [Component Relationships](#component-relationships)
9. [Implementation Status](#implementation-status)
10. [Future Improvements](#future-improvements)

---

## Core Philosophy

### What Makes a Player "Human"?

A human player is limited, imperfect, and contextual:

| Aspect | Robot AI | Human-Like AI |
|--------|----------|---------------|
| **Vision** | 360° awareness, sees through walls | ~140° FOV, blocked by terrain |
| **Movement** | Teleport-like, mechanical paths | Natural momentum, curves, pauses |
| **Attention** | Processes everything simultaneously | Focuses on one thing, gets distracted |
| **Decisions** | Optimal, instant | Considers, hesitates, sometimes wrong |
| **Memory** | Perfect recall | Learns from mistakes, forgets details |
| **Emotions** | None | Frustration, excitement, curiosity |

### The Three Laws of Human-Like AI

1. **Look Before You Act** - A human sees the target, then moves toward it
2. **Perceive What's Visible** - Only "know" what the eyes can see
3. **Move With Intent** - Every movement has purpose, natural curves and pauses

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TauBot (index.ts)                              │
│                        Main Decision Loop                                │
│                                                                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │   AI Brain  │   │   Emotion   │   │  Experience │   │  Decision   │  │
│  │  (brain.ts) │   │   Manager   │   │   Memory    │   │   Logger    │  │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘  │
│         │                 │                 │                 │          │
└─────────┼─────────────────┼─────────────────┼─────────────────┼──────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        GameManager (game-manager.ts)                     │
│                                                                          │
│                    ┌─────────────────────────────┐                       │
│                    │     MinecraftGame           │                       │
│                    │     (minecraft.ts)          │                       │
│                    └──────────────┬──────────────┘                       │
│                                   │                                      │
│    ┌──────────────────────────────┼────────────────────────────────┐    │
│    │                              │                                 │    │
│    ▼                              ▼                                 ▼    │
│ ┌────────────┐           ┌────────────────┐              ┌────────────┐ │
│ │  Pathfinder │           │ Human Behavior │              │  Movement  │ │
│ │  Navigation │           │    Manager     │              │  Functions │ │
│ └──────┬─────┘           └───────┬────────┘              └──────┬─────┘ │
│        │                         │                              │       │
│        │                         │                              │       │
│        ▼                         ▼                              ▼       │
│   navigateWith              Idle-Only              walkDirectlyToward   │
│   Pathfinder()              Behaviors              smoothLookAt         │
│                                                    smoothWalkTo         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │  Mineflayer │
                            │  Bot (API)  │
                            └─────────────┘
```

### File Responsibilities

| File | Role |
|------|------|
| `index.ts` | Main loop, batch actions, stuck detection, mode switching |
| `games/minecraft.ts` | All game actions, movement, mining, combat, FOV, vision |
| `games/human-behavior-patterns.ts` | Idle behaviors, natural head movements |
| `games/minecraft-brain.ts` | Situational prompts, strategy selection |
| `ai/brain.ts` | LLM communication, prompt building, thinking modes |
| `ai/experience-memory.ts` | Cross-session learning, pattern extraction |
| `ai/emotion-manager.ts` | Emotional states, expressions |
| `ai/openrouter.ts` | API calls, vision analysis |

---

## Perception System (FOV)

### The Problem

Traditional bots have **360° omniscient awareness**. They see zombies behind them, know about chests inside mountains, and react to entities they couldn't possibly see.

### The Solution: Field of View Filtering

```typescript
// minecraft.ts - isInFieldOfView()
private isInFieldOfView(
  targetPos: { x: number; y: number; z: number }, 
  fovHalfRadians: number = Math.PI * 0.39  // ~70° each side = 140° total
): boolean {
  const dx = targetPos.x - botPos.x;
  const dz = targetPos.z - botPos.z;
  const angleToTarget = Math.atan2(-dx, -dz);
  
  let angleDiff = angleToTarget - botYaw;
  // Normalize to [-π, π]
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
  
  return Math.abs(angleDiff) < fovHalfRadians;
}
```

### Where FOV + Line of Sight is Applied

| Component | FOV | LOS | Result |
|-----------|-----|-----|--------|
| `getNearbyEntities()` | ✅ | ✅ | AI only "knows" about visible entities |
| `entitySpawn` handler | ✅ | ✅ | Hostile mob alerts only for visible mobs |
| `findNearestBlockType()` | ✅ | ✅ | Trees/ores only if visible (<20 blocks) |
| `getSpatialObservation()` nearestMob | ✅ | ✅ | Nearest mob must be visible |
| `getSpatialObservation()` threats | ✅ | ✅ | Threats only if visible |
| `findNearbyInterestingTarget()` | N/A | ✅ | Idle looking checks LOS (can turn, can't see through walls) |
| `attack()` | ❌ | ❌ | AI already filtered what it requested |

### FOV + LOS Visualization

```
                    North
                      │
                     70°
              ╱   ╲
       ╱              ╲
West  ────── BOT ──────  East
       ╲    [WALL]    ╱
              ╲   ╱
                     70°
                      │
                    South
                    
    ███ = Visible (in FOV + clear LOS)
    ░░░ = Invisible (behind player)
    ▓▓▓ = In FOV but blocked by wall (LOS fail)

EXAMPLES:
    Zombie at North + no wall = VISIBLE ✓
    Zombie at North + behind wall = INVISIBLE ✗
    Zombie at South = INVISIBLE (behind) ✗
    Tree behind mountain = INVISIBLE ✗
```

### Line of Sight (Occlusion)

FOV alone isn't enough - humans also can't see through walls. The Line of Sight system adds occlusion checking:

```typescript
// minecraft.ts - hasLineOfSight()
private hasLineOfSight(targetPos: { x: number; y: number; z: number }, maxDistance: number = 16): boolean {
  const eyePos = this.bot.entity.position.offset(0, 1.62, 0);  // Eye level
  const direction = normalize(targetPos - eyePos);
  const distance = distanceTo(targetPos);
  
  // Ray-cast from eyes to target, checking every 0.5 blocks
  for (let i = 0; i < distance; i += 0.5) {
    const checkPos = eyePos + direction * i;
    const block = this.bot.blockAt(checkPos);
    
    if (block && !isTransparentBlock(block.name)) {
      return false;  // Solid block blocks vision
    }
  }
  return true;
}
```

### Transparent vs Opaque Blocks

Vision passes through:
- `air`, `water`, `lava`
- `glass`, `glass_pane`, `stained_glass`
- `leaves` (all types)
- `tall_grass`, `grass`, `fern`, `flowers`
- `torch`, `lantern`, `fire`
- `fence`, `iron_bars`, `chain`
- `ladder`, `vine`, `scaffolding`

Vision is blocked by:
- `stone`, `dirt`, `wood` (all solid blocks)
- `oak_log`, `birch_log` (tree trunks)
- `chest`, `furnace` (containers)
- All full-size solid blocks

### Critical Insight

**The AI's decision prompt only contains information about visible entities.** This means:
- A skeleton behind the bot → AI doesn't know it exists
- A zombie behind a wall → AI doesn't know it exists
- A tree behind a mountain → AI doesn't know it exists
- Bot must turn around AND have clear LOS → NOW it can see and react
- This creates natural **situational awareness** behaviors

### Memory Exception for Distant Blocks

Blocks beyond 20 blocks skip FOV/LOS checks to simulate **memory**:
- Player walked past a tree → remembers it's "back there"
- Prevents complete amnesia when turning around

---

## Movement System

### Movement Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                     HIGH-LEVEL DECISION                       │
│                "mine oak_log" or "move north"                 │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    walkTowardTarget3D()                       │
│              Decides which movement method to use             │
│                                                               │
│   Distance > 1.5 blocks? ──► navigateWithPathfinder()        │
│   Distance < 1.5 blocks? ──► Already there                    │
└───────────────────────────┬──────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌─────────────────────┐        ┌─────────────────────┐
│ navigateWithPathfinder│        │  walkDirectlyToward  │
│                     │        │                     │
│ • Long distances    │        │ • Short distances   │
│ • Complex terrain   │        │ • Item pickup       │
│ • A* pathfinding    │        │ • Final approach    │
│ • Vegetation aware  │        │ • Obstacle jumping  │
│ • Stuck recovery    │        │ • Leaf breaking     │
└─────────────────────┘        └─────────────────────┘
```

### The Human Mining Sequence

```typescript
// How a HUMAN mines a tree:
1. SEE the tree (smoothLookAt)
2. WALK toward it (navigateWithPathfinder → walkDirectlyToward)
3. STOP moving (clearControlStates)
4. AIM precisely (smoothLookAt again)
5. PAUSE briefly (100-200ms, like raising arm)
6. MINE (digWithAnimation)
7. WAIT for item drop
8. WALK to item (walkDirectlyToward)
9. COLLECT (auto-pickup when close enough)
```

### Key Movement Functions

#### `smoothLookAt(x, y, z, duration)`
```typescript
// Smooth camera transitions with easing
// Duration scales with angle change for consistent angular velocity
private async smoothLookAt(x: number, y: number, z: number, baseDurationMs: number = 400): Promise<void>
```

#### `walkDirectlyToward(targetX, targetZ, options)`
```typescript
// For short distances - precise control without pathfinder overhead
// Options:
// - stopDistance: How close to get (default 1.2)
// - timeoutMs: Max time to try (default 8000)
// - maintainPitch: Lock pitch to this value
// - breakVegetation: Mine through leaves/bushes
// - autoJump: Auto-jump when stuck
```

#### `navigateWithPathfinder(x, y, z, label, stopDistance, sessionId)`
```typescript
// A* pathfinding with:
// - Low digCost for vegetation (5 above ground, 15 underground)
// - Stuck recovery (mine instant-break blocks)
// - Max 3 stuck recovery attempts per navigation
```

### Pathfinder Settings (Human-Like)

```typescript
movements.canDig = true;           // Can break blocks
movements.digCost = 5;             // Low cost = willing to break vegetation
movements.allowSprinting = false;  // No robotic speed bursts
movements.allowParkour = false;    // No perfect jumps
movements.allow1by1towers = false; // Don't build straight up
```

---

## Decision System

### Decision Flow

```
┌──────────────────────────────────────────────────────────────┐
│                       DECISION LOOP                           │
│                    (index.ts ~15s cycle)                      │
└───────────────────────────┬──────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
   ┌──────────┐      ┌──────────┐      ┌──────────┐
   │  Batch?  │      │  Normal  │      │  Stuck?  │
   │(continue)│      │ AI Query │      │(recover) │
   └────┬─────┘      └────┬─────┘      └────┬─────┘
        │                 │                 │
        │                 ▼                 │
        │      ┌─────────────────────┐      │
        │      │     AI Brain        │      │
        │      │                     │      │
        │      │ Mode Selection:     │      │
        │      │ • Fast (default)    │      │
        │      │ • Advanced (4+ fail)│      │
        │      │ • Autonomous (env)  │      │
        │      └──────────┬──────────┘      │
        │                 │                 │
        └────────────────►│◄────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   Execute   │
                   │   Action    │
                   └─────────────┘
```

### Prompt System

Three prompt modes:

| Mode | When Used | Focus |
|------|-----------|-------|
| `MINECRAFT_FAST_SYSTEM_PROMPT` | Default | Quick decisions, JSON output |
| `MINECRAFT_ADVANCED_SYSTEM_PROMPT` | 4+ consecutive failures | ReAct reasoning, detailed analysis |
| `MINECRAFT_AUTONOMOUS_PROMPT` | `AUTONOMOUS_MODE=true` | Minimal prompting, trusts LLM knowledge |

### Batch Actions

To avoid re-querying AI for repetitive tasks:

```typescript
// index.ts
private readonly BATCH_LIMITS: Record<string, number> = {
  mine: 5,      // Mine up to 5 of same block type
  craft: 3,     // Craft up to 3 of same item
  move: 1,      // Don't batch movement
  place: 2,     // Place up to 2 blocks
};
```

**Batch mode suppresses idle behaviors** - critical for preventing "looking around" while mining.

---

## Behavior System

### Human Behavior Manager

**Core Principle: NEVER interfere with tasks. Only act when IDLE.**

```typescript
// human-behavior-patterns.ts
export class HumanBehaviorManager {
  // Only performs idle behaviors when:
  // 1. No active task (currentTask === null)
  // 2. Not in batch mode (batchModeActive === false)
  // 3. Enough time since last look (8 seconds)
  
  private currentTask: string | null = null;
  private batchModeActive: boolean = false;
}
```

### Idle Behaviors (When Nothing Else Happening)

| Behavior | Probability | Description |
|----------|-------------|-------------|
| Look at interesting target | If found | Trees, mobs, animals |
| Subtle horizontal drift | 40% | ±4° head movement |
| Brief upward glance | 30% | Check sky/ceiling |
| Slow environment scan | 30% | Pan left/right |

### Task/Batch Mode Integration

```typescript
// When starting an action:
humanBehaviorManager.notifyTaskStart('mining');

// During batch operations:
humanBehaviorManager.enterBatchMode(25000); // 25s per action

// When done:
humanBehaviorManager.notifyTaskEnd('mining');
humanBehaviorManager.exitBatchMode();
```

---

## Memory & Learning

### Experience Memory System

```
┌─────────────────────────────────────────────────────────────┐
│                    EXPERIENCE MEMORY                         │
│                 (experience-memory.ts)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │  Pattern Store   │      │ Experience Index │             │
│  │                  │      │                  │             │
│  │ action → success │      │ situation vector │             │
│  │  rate, contexts  │      │ → past outcomes  │             │
│  └─────────┬────────┘      └────────┬─────────┘             │
│            │                        │                        │
│            └────────────┬───────────┘                        │
│                         │                                    │
│                         ▼                                    │
│              ┌─────────────────────┐                         │
│              │  Build Memory       │                         │
│              │  Context for LLM    │                         │
│              └─────────────────────┘                         │
│                                                              │
│  Stored in: packages/bot/data/decision-logs/                │
│  • decisions-YYYY-MM-DD.json (daily logs)                   │
│  • patterns.json (extracted patterns)                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Emotion System

```typescript
// emotion-manager.ts
// Emotions influence decision-making context

Type             │ Triggered By          │ Effect on Decisions
─────────────────┼───────────────────────┼─────────────────────
joy              │ Success               │ Continue current approach
frustration      │ 2-3 failures          │ Try different approach
anger            │ 4+ failures           │ Major strategy change
fear             │ Low health, mobs      │ Prioritize safety
curiosity        │ New area, discovery   │ Explore
satisfaction     │ Goal completion       │ Seek new goals
boredom          │ Repetitive actions    │ Try something new
excitement       │ Rare finds (diamond)  │ Express joy
```

---

## Component Relationships

### Data Flow Diagram

```
USER OBSERVES ◄─────────────────────────────────────────────────────────────┐
                                                                             │
                                                                             │
┌─────────────────────────────────────────────────────────────────────────┐ │
│                            PERCEPTION LAYER                              │ │
│                                                                          │ │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐              │ │
│  │ Block Scan  │      │ Entity Scan │      │ Vision AI   │              │ │
│  │ (raycast)   │ ───► │ (+FOV filter)│ ───► │(screenshots)│              │ │
│  └─────────────┘      └─────────────┘      └─────────────┘              │ │
│          │                   │                    │                      │ │
│          └───────────────────┴────────────────────┘                      │ │
│                              │                                           │ │
│                              ▼                                           │ │
│                    ┌─────────────────────┐                               │ │
│                    │    Game State       │                               │ │
│                    │  (getState())       │                               │ │
│                    └──────────┬──────────┘                               │ │
└───────────────────────────────┼──────────────────────────────────────────┘ │
                                │                                            │
                                ▼                                            │
┌─────────────────────────────────────────────────────────────────────────┐ │
│                           COGNITION LAYER                                │ │
│                                                                          │ │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐              │ │
│  │ Experience  │      │  AI Brain   │      │  Emotion    │              │ │
│  │   Memory    │ ───► │   (LLM)     │ ◄─── │  Manager    │              │ │
│  └─────────────┘      └─────────────┘      └─────────────┘              │ │
│                              │                                           │ │
│                              ▼                                           │ │
│                    ┌─────────────────────┐                               │ │
│                    │      Decision       │                               │ │
│                    │  {type, target}     │                               │ │
│                    └──────────┬──────────┘                               │ │
└───────────────────────────────┼──────────────────────────────────────────┘ │
                                │                                            │
                                ▼                                            │
┌─────────────────────────────────────────────────────────────────────────┐ │
│                            ACTION LAYER                                  │ │
│                                                                          │ │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐              │ │
│  │  Movement   │      │   Mining    │      │   Combat    │              │ │
│  │  Functions  │      │  Functions  │      │  Functions  │              │ │
│  └─────────────┘      └─────────────┘      └─────────────┘              │ │
│          │                   │                    │                      │ │
│          └───────────────────┴────────────────────┘                      │ │
│                              │                                           │ │
│                              ▼                                           │ │
│                    ┌─────────────────────┐                               │ │
│                    │  Mineflayer Bot     │                               │ │
│                    │  (actual actions)   │                               │ │
│                    └──────────┬──────────┘                               │ │
└───────────────────────────────┼──────────────────────────────────────────┘ │
                                │                                            │
                                ▼                                            │
                         Minecraft World ────────────────────────────────────┘
                         (visual feedback)
```

### Key Relationships

| From | To | Relationship |
|------|----|--------------|
| `index.ts` | `minecraft.ts` | Executes actions, manages batch mode |
| `index.ts` | `brain.ts` | Requests decisions |
| `brain.ts` | `minecraft-brain.ts` | Gets situational prompts |
| `brain.ts` | `experience-memory.ts` | Retrieves learned patterns |
| `minecraft.ts` | `human-behavior-patterns.ts` | Controls idle behavior activation |
| `minecraft.ts` | `openrouter.ts` | Vision AI for stuck recovery |
| `emotion-manager.ts` | `brain.ts` | Emotional context for decisions |

---

## Implementation Status

### ✅ Completed

| Feature | Status | File(s) |
|---------|--------|---------|
| FOV filtering for entities | ✅ Done | `minecraft.ts` |
| **Line of Sight (occlusion)** | ✅ Done | `minecraft.ts` |
| **LOS for block detection (trees, ores)** | ✅ Done | `minecraft.ts` |
| **LOS for idle looking behavior** | ✅ Done | `human-behavior-patterns.ts` |
| FOV for mob alerts | ✅ Done | `minecraft.ts` |
| Human-like mining sequence | ✅ Done | `minecraft.ts` |
| Smooth camera transitions | ✅ Done | `minecraft.ts` |
| Direct walking for short distances | ✅ Done | `minecraft.ts` |
| Pathfinder stuck recovery | ✅ Done | `minecraft.ts` |
| Vegetation breaking during navigation | ✅ Done | `minecraft.ts` |
| Batch mode (suppress idle during tasks) | ✅ Done | Multiple files |
| Vision-based stuck recovery (screenshots) | ✅ Done | `minecraft.ts` |
| Stop movement before mining | ✅ Done | `minecraft.ts` |
| Tool selection for blocks | ✅ Done | `minecraft.ts` |
| Idle-only human behaviors | ✅ Done | `human-behavior-patterns.ts` |
| Experience memory system | ✅ Done | `experience-memory.ts` |
| Emotion system | ✅ Done | `emotion-manager.ts` |
| **Animal detection with LOS** | ✅ Done | `human-behavior-patterns.ts` |

### ⚠️ Needs Improvement

| Feature | Issue | Recommendation |
|---------|-------|----------------|
| Item collection reliability | Sometimes misses items in holes | Improve Y-level handling |
| Pitch reset after mining | Can still be jarring | Use gradual pitch adjustment |
| Block detection at different heights | Sometimes misses head-level blocks | Enhanced multi-level checking |

### 🔮 Future Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| Sound-based awareness | Hear mobs behind (turn to look) | High |
| Peripheral vision | Subtle awareness at edges of FOV | Medium |
| Natural path curves | Bezier curves instead of straight lines | Medium |
| Fatigue simulation | Slower reactions over time | Low |
| Mouse-like aiming | Acceleration/deceleration curves | Medium |
| Breathing/idle motion | Subtle constant camera movement | Low |

---

## Future Improvements

### 1. Sound-Based Awareness

Humans can HEAR things behind them, then TURN to look:

```typescript
// Proposed: Sound event triggers turn
bot.on('entitySound', (entity, sound) => {
  if (!isInFieldOfView(entity.position)) {
    // Sound is behind us - turn to look
    await smoothLookAt(entity.position.x, entity.position.y, entity.position.z);
    // NOW the AI can see it and react
  }
});
```

### 2. Peripheral Vision

Entities at edge of FOV should be "noticed" with lower priority:

```typescript
// Center of vision (0-40°): Full awareness
// Peripheral (40-70°): "Something moved" awareness
// Behind (>70°): Invisible unless sound

if (angleDiff < 0.7) {  // 40°
  // Full awareness - add to entities list
} else if (angleDiff < 1.22) {  // 70°
  // Peripheral - add with "glimpsed" flag
  // AI might ignore or investigate
}
```

### 3. Natural Path Curves

Instead of straight-line pathfinding, use Bezier curves:

```typescript
// Current: Walk straight to point
// Human: Slight arc, natural curve

function generateNaturalPath(start: Vec3, end: Vec3): Vec3[] {
  const controlPoint = midpoint(start, end)
    .offset(randomOffset(-2, 2), 0, randomOffset(-2, 2));
  return bezierCurve(start, controlPoint, end, steps=20);
}
```

### 4. Attention Span System

Humans get distracted, lose focus:

```typescript
// Track attention on current task
attentionLevel: number = 1.0;

// Decrease over time during boring tasks
if (sameActionCount > 3) {
  attentionLevel -= 0.1;
}

// Low attention = might look around, miss things
if (attentionLevel < 0.5) {
  // Random chance to "get distracted"
  maybePerformIdleLook();
}
```

---

## Quick Reference

### Key Functions

| Function | Purpose | Human Trait |
|----------|---------|-------------|
| `smoothLookAt()` | Gradual camera movement | Eyes move smoothly |
| `walkDirectlyToward()` | Short-distance precise walking | Walk to nearby item |
| `navigateWithPathfinder()` | Long-distance navigation | Navigate complex terrain |
| `isInFieldOfView()` | Check if position is in FOV | Can only see what's in front |
| `hasLineOfSight()` | Check if position is occluded | Can't see through walls |
| `isTransparentBlock()` | Determine if block allows vision | Glass/leaves/air are see-through |
| `getNearbyEntities()` | Get visible entities only | Awareness of visible surroundings |
| `digWithAnimation()` | Mining with arm swing | Visible digging motion |

### Key Settings

```typescript
// FOV + Line of Sight
FOV_HALF_RADIANS = Math.PI * 0.39;  // 70° each side = 140° total
LOS_MAX_DISTANCE = 16;              // Ray-cast up to 16 blocks
LOS_STEP_SIZE = 0.5;                // Check every 0.5 blocks
MEMORY_DISTANCE = 20;               // Skip FOV/LOS for blocks >20m

// Movement
movements.digCost = 5;              // Willing to break vegetation
movements.allowSprinting = false;   // Natural speed
movements.allowParkour = false;     // No perfect jumps

// Behavior
lookFrequency = 8000;               // 8s between idle looks
MAX_STUCK_RECOVERY_ATTEMPTS = 3;    // Tries before giving up
```

### Debug Logs

```bash
# Movement debugging
tail -f packages/bot/logs/movement.log

# AI decisions  
tail -f packages/bot/logs/learning.log

# Prompts sent to AI
tail -f packages/bot/logs/prompts.log

# Vision screenshots
ls packages/bot/data/vision-screenshots/
```

---

## Conclusion

Building a truly human-like AI player requires:

1. **Limited perception** - FOV, no omniscience
2. **Natural movement** - Smooth, curved, with pauses  
3. **Contextual decisions** - Emotions, memory, learning
4. **Imperfection** - Mistakes, distractions, recovery

This architecture provides the foundation. Continue iterating with real gameplay observation to identify and fix remaining robotic behaviors.

**The goal: A player who, when watched, makes you forget it's an AI.**

