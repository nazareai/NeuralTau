# Critical Issues Found - Tau Minecraft Bot

## Session Analysis: Bot Trapped Underground

**Incident:** Bot became completely trapped at (-96, 45, -10) in a dead-end granite chamber.

---

## 🔴 CRITICAL ISSUE #1: Inventory Display Mismatch

### Problem:
- **AI says:** "I have 7 DIRT BLOCKS in inventory"
- **UI shows:** "Inventory: 3 items"
- **User confusion:** Appears to be hallucination

### Root Cause:
The UI is showing **number of item TYPES**, not **total item COUNT**.

**Example:**
```
Inventory slots:
- Slot 1: 7x dirt
- Slot 2: 1x stone_pickaxe
- Slot 3: 2x granite

UI displays: "3 items" (3 types)
AI sees: 7 dirt, 1 pickaxe, 2 granite (correct!)
```

### Fix Required:
**Update web UI to show detailed inventory:**
```
INVENTORY (10 items):
┌─────────────────────────┐
│ [7] Dirt                │
│ [1] Stone Pickaxe       │
│ [2] Granite             │
└─────────────────────────┘
```

**File to modify:** `/packages/web/src/app/page.tsx`

**Add inventory grid visualization:**
- 9x4 grid (36 slots like Minecraft)
- Show item icon + count in each slot
- Highlight equipped tool
- Show totals: "10 items across 3 stacks"

---

## 🔴 CRITICAL ISSUE #2: Bot Stuck in Failure Loop

### The Failure Loop:
```
1. Try to mine granite → Timeout (no pickaxe strong enough)
2. AI decides: "Place dirt to build up" → Timeout (can't place, blocked)
3. Try to move backward → Can't move (surrounded)
4. Repeat forever...
```

### Why Vision Analysis Isn't Triggering:

**Current stuck detection** (minecraft.ts lines 618-683):
```typescript
// STAGE 1: After 800ms stuck → try jump
// STAGE 2: After 1600ms stuck → try sidestep
// STAGE 3: After 2400ms stuck → call intelligentStuckRecovery()
```

**BUT:** The bot is executing ACTIONS (place, mine) that timeout after 10 seconds!
- Action: "place dirt" → 10 second timeout
- Returns to decision loop
- New action: "mine granite" → 10 second timeout
- Returns to decision loop
- **Never actually "stuck" in movement for 2.4 seconds!**

### Fix Required:

**Add action-level stuck detection:**

```typescript
// In index.ts decision loop (around line 140)
const failedActionsInRow = getConsecutiveFailures();

if (failedActionsInRow >= 3) {
  logger.warn('[STUCK-DETECTION] 3 failed actions in a row - triggering recovery');

  // Force vision analysis and escape logic
  const escapeAction = await minecraft.intelligentStuckRecovery();

  // If underground, force dig up
  if (gameState.metadata.position.y < 60) {
    await minecraft.digUpToSurface();
  }
}
```

**File to modify:** `/packages/bot/src/index.ts`

---

## 🔴 CRITICAL ISSUE #3: Action Timeouts Too Long

### Problem:
- Every action has 10-second timeout
- Bot wastes 10 seconds per failed action
- In tight loop = **30+ seconds** of nothing happening

### Fix Required:

**Adaptive timeouts based on action type:**

```typescript
const ACTION_TIMEOUTS = {
  mine: 15000,      // Mining can take time
  place: 3000,      // Placing should be instant
  move: 5000,       // Movement moderate
  craft: 2000,      // Crafting fast
  dig_up: 20000,    // Underground escape takes time
};
```

**Early timeout detection:**
```typescript
// If action shows no progress after 2 seconds, abort early
if (noProgressAfter(2000) && action.type === 'place') {
  throw new Error('Place action stuck - aborting early');
}
```

**File to modify:** `/packages/bot/src/index.ts` and `/packages/bot/src/games/minecraft.ts`

---

## 🔴 CRITICAL ISSUE #4: No Visual Feedback for Streamers

### Missing UI Elements:

**For engaging streaming, viewers need to see:**

1. **Health/Food Bars** (visual, not just numbers)
```
Health: ████████░░ 16/20
Food:   ██████████ 20/20
```

2. **Detailed Inventory Grid** (Minecraft-style)
```
┌──────────────────────────────┐
│ [7]dirt  [ ]      [ ]      │
│ [ ]      [1]pick  [ ]      │
│ [2]stone [ ]      [ ]      │
└──────────────────────────────┘
```

3. **Nearby Blocks** (what bot can see)
```
VISIBLE BLOCKS:
- Granite (North, East, South, West)
- Stone (Above)
- Air (blocked by granite)
```

4. **Current Goal/Strategy**
```
GOAL: Escape underground chamber
STRATEGY: Dig upward using pickaxe
PROGRESS: Y=45 → Target Y=70 (35 blocks to go)
```

5. **Action Progress Bar**
```
Current Action: Mining stone (Block 12/50)
████████░░░░░░░░░░ 40%
```

---

## 🔴 CRITICAL ISSUE #5: Brain Doesn't See "Stuck" Context

### Problem:
The AI brain gets:
- Position
- Inventory
- Nearby blocks

But **DOESN'T get:**
- Recent failed actions count
- "You are STUCK" flag
- Vision analysis results
- Stuck detection state

### Current Prompt Context (brain.ts):
```typescript
Current Game State: {
  position: {x: -96, y: 45, z: -10},
  health: 20,
  food: 20,
  inventory: [...],
  nearbyBlocks: ["granite", "stone", ...]
}
```

### Missing Context:
```typescript
CRITICAL STATUS:
- ⚠️ STUCK ALERT: 3 consecutive failed actions
- Last 3 actions ALL FAILED (place, mine, place)
- Position hasn't changed in 30 seconds
- You are in a DEAD-END chamber
- RECOMMENDED ACTION: Use "dig_up" to mine upward and escape
```

### Fix Required:

**Add stuck detection state to game state:**

```typescript
// In minecraft.ts getState()
const state: MinecraftState = {
  position: currentPos,
  health: this.bot.health,
  food: this.bot.food,
  inventory: this.getInventory(),

  // NEW: Stuck detection info
  stuckStatus: {
    isStuck: this.consecutiveFailures >= 3,
    failedActions: this.consecutiveFailures,
    timeSinceLastMove: Date.now() - this.lastMoveTime,
    recommendedAction: this.consecutiveFailures >= 3 ? 'dig_up' : null
  }
};
```

**Update prompt in brain.ts to highlight stuck status:**

```typescript
if (gameState.metadata.stuckStatus?.isStuck) {
  contextParts.push('\n🚨 CRITICAL: You are STUCK!');
  contextParts.push(`Failed ${gameState.metadata.stuckStatus.failedActions} actions in a row.`);
  contextParts.push('You must try a DIFFERENT approach!');

  if (gameState.metadata.position.y < 60) {
    contextParts.push('⛏️ RECOMMENDED: Use "dig_up" action to mine upward and escape underground.');
  }
}
```

---

## 🟡 ISSUE #6: No Gameplay Self-Critique

### The Bot Should Learn:

**After 3 failed attempts at same action:**
```
LEARNING MOMENT:
- Tried "place dirt" 3 times → all failed
- Reason: Space is blocked
- LESSON: If place fails, don't try again immediately
- NEW STRATEGY: Try different action (dig, move, analyze)
```

### Fix Required:

**Add pattern detection to action history:**

```typescript
// In brain.ts
private detectRepeatedFailures(): string | null {
  const last5 = this.actionHistory.slice(-5);

  // Check if repeating same failed action
  const failedActions = last5.filter(a => !a.success);
  if (failedActions.length >= 3) {
    const sameAction = failedActions.every(a => a.action.type === failedActions[0].action.type);
    if (sameAction) {
      return `⚠️ WARNING: You've tried "${failedActions[0].action.type}" 3 times and it keeps failing. Try something DIFFERENT!`;
    }
  }

  return null;
}
```

---

## 📋 Action Plan (Priority Order)

### IMMEDIATE (Fix the stuck bot NOW):

1. **Add stuck override in main loop** (index.ts)
   - Detect 3+ consecutive failures
   - Force `intelligentStuckRecovery()`
   - If underground (Y<60), force `digUpToSurface()`

2. **Reduce action timeouts** (especially `place` action)
   - place: 10s → 3s
   - move: 10s → 5s
   - Early abort if no progress

3. **Add stuck status to game state** (minecraft.ts)
   - Include consecutive failure count
   - Include "isStuck" boolean
   - Include recommended action

### HIGH PRIORITY (Better UI for streaming):

4. **Add detailed inventory display** (web/page.tsx)
   - Show item counts clearly: "[7] Dirt"
   - Minecraft-style grid (9x4 = 36 slots)
   - Highlight equipped tool

5. **Add health/food bars** (visual progress bars)
   - Red bar for health
   - Orange bar for food
   - Show percentages

6. **Add nearby blocks display**
   - List of visible blocks in each direction
   - "What I can see" panel

### MEDIUM PRIORITY (Smarter AI):

7. **Enhance prompt with stuck context**
   - Warn AI when stuck
   - Suggest alternative actions
   - Prevent action repetition

8. **Add action progress tracking**
   - Show "Mining block 5/50"
   - Progress bars for long actions
   - ETA estimation

### LONG TERM (Polish):

9. **Add camera view preview** (what bot sees)
   - Screenshot or block grid
   - Show where bot is looking

10. **Add goals/strategy display**
    - Current objective
    - Progress toward goal
    - Decision reasoning history

---

## Self-Critique: What Went Wrong

### Design Flaws Found:

1. **Stuck detection only works for MOVEMENT**
   - Fails to detect "action loop" stuck
   - Bot can waste minutes in failed action loop
   - **Lesson:** Need stuck detection at DECISION level, not just movement

2. **Timeouts are too forgiving**
   - 10 seconds per action is way too long
   - Should fail fast and try alternatives
   - **Lesson:** Quick failures > slow failures

3. **AI doesn't see its own failure patterns**
   - No context about repeated failures
   - Keeps trying same thing
   - **Lesson:** Action history must be prominent in context

4. **UI prioritized code over viewer experience**
   - "3 items" is useless for engagement
   - Need visual inventory, health bars, strategy
   - **Lesson:** Streamer UI ≠ Developer UI

5. **No escape route validation**
   - Bot tries to place blocks in blocked spaces
   - Doesn't check if space is clear before acting
   - **Lesson:** Add pre-action validation

6. **Vision analysis only triggered by movement stuck**
   - Should trigger on ANY repeated failure
   - **Lesson:** Vision = general problem-solving tool, not just movement

---

## Files That Need Changes

| Priority | File | Changes |
|----------|------|---------|
| 🔴 CRITICAL | `/packages/bot/src/index.ts` | Add consecutive failure detection and forced recovery |
| 🔴 CRITICAL | `/packages/bot/src/games/minecraft.ts` | Add stuck status to game state, reduce timeouts |
| 🔴 CRITICAL | `/packages/bot/src/ai/brain.ts` | Add stuck warnings to prompt context |
| 🟡 HIGH | `/packages/web/src/app/page.tsx` | Add inventory grid, health bars, nearby blocks UI |
| 🟡 HIGH | `/packages/bot/src/index.ts` | Add action-specific timeouts |
| 🟢 MEDIUM | `/packages/bot/src/ai/brain.ts` | Add pattern detection for repeated failures |

---

## Testing Plan

After fixes:

1. **Spawn bot in trapped chamber** (like current situation)
2. **Expected behavior:**
   - Detects stuck after 3 failures (< 15 seconds)
   - Triggers intelligentStuckRecovery()
   - Performs 360° vision analysis
   - Sees "underground, no clear paths"
   - Executes digUpToSurface()
   - Mines upward at 45° angle
   - Reaches surface within 2 minutes

3. **UI should show:**
   - Detailed inventory: "[7] Dirt, [1] Stone Pickaxe"
   - Health bar visual
   - "STUCK - Attempting recovery" message
   - Progress: "Digging up: 15/35 blocks"

---

**All fixes align with the goal: Make Tau an engaging, intelligent streamer!** 🚀
