# Autonomous AI Architecture Refactor Plan

## Problem Statement

The current system has **too many layers of rule-based logic** fighting with the LLM:

```
Current Flow:
Perception → Rules detect patterns → Rules generate warnings → Rules recommend actions → LLM receives conflicting advice → LLM confused
```

**Symptoms:**
- Bot gets stuck in loops despite many warnings
- Contradictory advice (safe path: N, but also: cave exit: W with water)
- AI can't form its own mental model
- We're implementing a dumb rule-based AI on top of a smart LLM

## Target Architecture

```
New Flow:
Raw Perception → Memory (action history) → LLM reasons freely → Action
```

**Principles:**
1. **Trust the LLM** - Claude knows Minecraft mechanics
2. **Perception not prescription** - Describe what we see, don't tell AI what to do
3. **Memory not warnings** - Show history, let AI learn patterns
4. **Minimal intervention** - Only hard safety limits (lava = death)

---

## Phase 1: Simplify Context (brain.ts)

### Current Context Structure (REMOVE/SIMPLIFY):
```
❌ "🚨🚨🚨 CRITICAL UNDERGROUND ALERT"
❌ "⛔ STOP mining stone - it will NEVER work!"
❌ "💡 RECOMMENDATION: dig up"
❌ "⚡ PATTERN: you just mined → MUST move up"
❌ "🌊 WATER TRAP - AVOID!"
```

### New Context Structure (RAW DATA):
```typescript
// Simple, factual context
const context = `
Position: ${pos.x}, ${pos.y}, ${pos.z}
Health: ${health}/20, Food: ${food}/20
Time: ${timeOfDay}

Inventory: ${inventory.map(i => `${i.name} x${i.count}`).join(', ')}

Surroundings:
  Above: ${blocksAbove.join(' → ')}
  North: ${blockNorth}, South: ${blockSouth}
  East: ${blockEast}, West: ${blockWest}
  Below: ${blocksBelow.join(' → ')}

Visible from looking around:
  ${directions.map(d => `${d.name}: ${d.clear ? 'clear' : d.blockingBlock} (${d.distance}m)`).join('\n  ')}

Recent actions:
${actionHistory.map(a => `- ${a.type} ${a.target}: ${a.result}`).join('\n')}
`;
```

### What to REMOVE from brain.ts:

| Current Code | Action |
|-------------|--------|
| `if (waterCount >= 2) { push("🌊🌊🌊 WARNING...") }` | DELETE - AI can see water in surroundings |
| `if (yPos < 50) { push("🚨 CRITICAL UNDERGROUND") }` | DELETE - AI can see Y position |
| `if (pickaxeBlocked >= 2) { push("⛔ STOP mining") }` | DELETE - AI sees failed attempts in history |
| `if (lastAction.type === 'mine') { push("⚡ PATTERN: MUST move up") }` | DELETE - AI can reason about sequences |
| `getBadDirectionWarnings()` | DELETE - AI sees Y drops in history |
| `getObservationContext()` with emojis | SIMPLIFY - just raw path data |

---

## Phase 2: Simplify System Prompt

### Current Prompt (VERBOSE):
```
You are Tau playing Minecraft...
# ESCAPING UNDERGROUND (CRITICAL!)
If Y < 63 and you need wood...
Mine block above → move up → repeat
REMEMBER: After EVERY mine action...
# TOOL REQUIREMENTS (CRITICAL!)
Stone/ores REQUIRES PICKAXE...
**IF YOU DON'T HAVE A PICKAXE:**
DO NOT try to mine stone...
```

### New Prompt (MINIMAL):
```typescript
const MINECRAFT_AUTONOMOUS_PROMPT = `You are an AI playing Minecraft.
Make decisions based on what you observe and remember.

Available actions:
- move <direction|coordinates>
- mine <block>
- place <block>
- craft <item>
- attack <entity>
- dig_up (mine upward and climb)
- wait
- speak <message>

Respond with JSON: {"type": "action", "target": "target", "reasoning": "why"}
`;
```

**Why this works:**
- Claude already knows Minecraft from training
- Claude knows pickaxes mine stone
- Claude knows Y=63 is surface level
- Claude can figure out "mine then move up" pattern
- We don't need to teach it the game

---

## Phase 3: Remove Forced Interventions (index.ts)

### Current Code to REMOVE:

```typescript
// DELETE: Forced recovery override
if (consecutiveFailures >= 4) {
  logger.warn('[STUCK-OVERRIDE] Consecutive failures detected - forcing recovery');
  await minecraftGame.intelligentStuckRecovery();
  await minecraftGame.digUpToSurface();
}
```

```typescript
// DELETE: Thinking mode tiers
const thinkingMode = consecutiveFailures >= 4 ? 'advanced' : 'fast';
```

```typescript
// DELETE: Forced observation triggers
if (recentFailures >= 2) { shouldObserve = true; }
if (inWater) { shouldObserve = true; }
```

### What to KEEP:

```typescript
// KEEP: Basic observation (but simplified)
// Just look around periodically, don't force it on failures
if (cycleCount % 5 === 0) {
  await minecraftGame.visionAnalysisLookAround();
}

// KEEP: Action history recording (neutral, no success/failure judgment)
aiBrain.recordAction(action, result);

// KEEP: Hard safety limits only
if (result.includes('lava') && health < 5) {
  // Emergency: teleport to safety or respawn
}
```

---

## Phase 4: Simplify Observation (minecraft.ts)

### Current Observation Output:
```
⚠️ DANGER: LAVA detected in S - AVOID!
✅ SAFE PATHS: N (8m), NE (6m)
🌊 WATER TRAP: W - AVOID!
💡 RECOMMENDATION: dig up
```

### New Observation Output:
```
Looking around (360°):
  N: clear 8m
  NE: clear 6m
  E: stone at 3m
  S: lava at 2m
  W: water at 4m
  NW: clear 5m
Sky visible: no
```

No emojis. No warnings. No recommendations. Just data.

---

## Phase 5: Memory System (Optional Enhancement)

Instead of rule-based trap detection, use episodic memory:

```typescript
interface Episode {
  situation: string;  // "at Y=45, went west"
  action: string;     // "move west"
  outcome: string;    // "fell into water, Y dropped to 35"
  timestamp: number;
}

// AI can query: "What happened last time I went west from here?"
```

This is more human-like - we remember experiences, not rules.

---

## Implementation Order

### Step 1: Create new minimal prompt
- File: `packages/shared/src/prompts/minecraft-autonomous.ts`
- Just action definitions, no strategy

### Step 2: Create simplified context builder
- File: `packages/bot/src/ai/brain.ts`
- New method: `buildAutonomousContext(gameState)`
- Raw data only, no warnings

### Step 3: Add feature flag
- File: `packages/bot/.env`
- `AUTONOMOUS_MODE=true`
- Can switch between old/new for comparison

### Step 4: Simplify observation output
- File: `packages/bot/src/games/minecraft.ts`
- `visionAnalysisLookAround()` returns plain text

### Step 5: Remove interventions
- File: `packages/bot/src/index.ts`
- Delete stuck override
- Delete forced observation triggers

### Step 6: Test & Compare
- Run both modes
- Compare decision quality
- Measure token usage

---

## Expected Outcomes

| Metric | Current | Expected |
|--------|---------|----------|
| Context tokens | ~2000 | ~800 |
| Decision time | 3-5s | 2-3s |
| Stuck loops | Frequent | Reduced (AI reasons) |
| Contradictory advice | Yes | No (just data) |
| Emergent behavior | Limited | More creative |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI forgets Minecraft mechanics | Add brief reminder in prompt if needed |
| AI ignores obvious dangers | Keep minimal safety checks (lava) |
| Slower reasoning | Acceptable tradeoff for better decisions |
| More API costs | Offset by fewer failed actions |

---

## Implementation Status: COMPLETE

All phases have been implemented:

### Changes Made:

**Phase 1: Simplified Context**
- Created `packages/shared/src/prompts/minecraft-autonomous.ts` - minimal prompt that trusts LLM
- Added `buildAutonomousContext()` in `brain.ts` - raw data only, no warnings
- Added `makeAutonomousDecision()` in `brain.ts` - uses autonomous prompt
- Added `AUTONOMOUS_MODE=true` to `.env`

**Phase 2: Simplified Observation**
- Modified `visionAnalysisLookAround()` in `minecraft.ts` - factual summary, no emojis

**Phase 3: Removed Forced Interventions**
- Disabled failure-based observation triggers in autonomous mode
- Disabled water-based observation triggers in autonomous mode
- Disabled stuck override recovery in autonomous mode
- LLM now reasons freely through all situations

### To Test:
```bash
pnpm --filter @tau/bot start
```

### To Switch Modes:
- **Autonomous mode**: `AUTONOMOUS_MODE=true` in `.env` (current)
- **Legacy mode**: `AUTONOMOUS_MODE=false` in `.env`
