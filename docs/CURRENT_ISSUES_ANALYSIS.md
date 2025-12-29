# Current Issues Analysis - Bot Behavior

**Date:** 2025-12-27 (2:50 PM)
**Status:** 🔍 INVESTIGATING

---

## Observations from Latest Logs

### ✅ What's Working:

1. **Failure detection is working!**
   - `place dirt` → "Failed to place dirt - Y position didn't change" (marked as FAILURE ✗)
   - consecutiveFailures increments: 0 → 1 → 2 → 3
   - SMART mode triggered after 3 failures

2. **Bot moved upward successfully once!**
   ```
   [MOVEMENT-3] Complete { endPos: '(-95, 43, -11)' }
   Bot went from Y=42 → Y=43! ✅
   ```

3. **Mining is working**
   - Bot successfully mines stone blocks
   - Blocks are being cleared

### ❌ What's NOT Working:

#### Issue 1: AI Not Following Mine → Move Pattern
```
Cycle 1: mine stone → "Mined stone but item was not collected" ✗
Cycle 2: place dirt → "Failed to place" ✗
Cycle 3: place dirt → "Failed to place" ✗
Cycle 4: move up → "Jumped (now at -96, 42, -11)" ✅ (but Y still 42!)
Cycle 5: mine stone → timeout
Cycle 6: mine stone → timeout
Cycle 7: mine stone → timeout
```

**Expected pattern:**
```
mine stone → move up → mine stone → move up → mine stone → move up
```

**Actual pattern:**
```
mine → place → place → move → mine → mine → mine
```

#### Issue 2: Spatial Observation Not Visible in Logs

I don't see ANY spatial observation output like:
```
=== SPATIAL OBSERVATION (Look around you!) ===
📍 ENVIRONMENT:
  - Y-Level: 42
  - Underground: YES
🔺 ESCAPE PATH TO SURFACE:
  - Obstacles: stone, stone, dirt
```

**This is CRITICAL** - the AI can't see the structured 3D information!

#### Issue 3: Vision Only Used for Movement, Not AI Decision-Making

Vision analysis appears in logs:
```
[VISION-ANALYSIS] Complete {
  blocksFound: 3,
  clearPaths: 0,
  canSeeSky: false,
  recommendation: 'Completely surrounded - need to DIG through blocks'
}
```

BUT this is only used for stuck recovery during movement, NOT for AI decision-making!

The AI doesn't see this vision data when choosing actions.

#### Issue 4: Mining → Movement Loop Wastes Time

After mining, bot tries to collect item:
```
Moving to mined block position for item pickup...
[STUCK-L1] Minimal movement detected (800ms)
[STUCK-L2] Still stuck after 1600ms
[STUCK-L3] Stuck for 2400ms - using INTELLIGENT RECOVERY
[VISION-ANALYSIS] Starting slow 360° analysis
```

This takes 10-15 seconds per mine action, and items aren't even being collected!

Bot should:
1. Mine stone
2. **Immediately move up into cleared space**
3. Skip item collection (it's failing anyway)

---

## Root Causes

### Cause 1: Spatial Observation Not Reaching AI

**Hypothesis:** The spatial observation is being generated but not included in the AI prompt.

**Evidence needed:**
- Log the actual prompt being sent to the AI
- Check if `gameState.metadata.spatialObservation` exists

**Fix needed:**
- Debug why spatial observation isn't appearing in context
- Ensure it's being properly serialized and sent

### Cause 2: AI Ignoring Pattern Instructions

**Hypothesis:** The prompt says "after mining, use move up" but AI isn't following it.

**Possible reasons:**
1. AI doesn't see that last action was "mine" (action history format issue)
2. AI sees "item was not collected" and thinks mining failed
3. Temperature 0.1 is TOO deterministic - keeps choosing same action
4. Prompt is too long/complex for 500-token limit

**Fix needed:**
- Make the pattern more prominent in prompt
- Show last action type explicitly: "LAST ACTION: mine stone"
- Increase temperature to 0.2 for FAST mode?
- Add explicit rule: "If you just mined, your NEXT action MUST be 'move up'"

### Cause 3: Item Collection Blocking Progress

**Hypothesis:** The mine() method spends 10-15 seconds trying to collect items that don't exist, preventing the bot from moving up quickly.

**Fix needed:**
- Skip item collection when underground (items fall through or despawn)
- OR reduce item collection timeout from 15s to 2s
- OR add a flag to mine() to skip collection entirely

---

## Proposed Fixes (Priority Order)

### Fix 1: Debug Spatial Observation ⚠️ HIGH PRIORITY

**Action:** Add console logging to verify spatial observation is being sent to AI.

**Files to check:**
- `packages/bot/src/games/minecraft.ts:224` - Is spatialObs being generated?
- `packages/bot/src/ai/brain.ts:203` - Is it in gameState.metadata?
- Log the full context being sent to AI

### Fix 2: Simplify Mine Action (Skip Item Collection) ⚠️ HIGH PRIORITY

**Problem:** Mining takes 15 seconds because bot tries to collect items that fall/despawn.

**Solution:** Add a parameter to skip item collection when underground.

```typescript
private async mine(blockName: string, skipCollection = false): Promise<string> {
  // ... existing code ...

  if (skipCollection || currentY < 60) {
    // Underground or skip requested - don't waste time collecting
    return `Mined ${blockName} - space cleared above`;
  }

  // ... existing item collection code ...
}
```

**Impact:** Mining completes in ~8 seconds instead of 15 seconds.

### Fix 3: Explicit Last Action Indicator 🔴 CRITICAL

**Problem:** AI doesn't know what it just did, so can't follow "after mine → move" pattern.

**Solution:** Add explicit last action indicator in prompt.

```typescript
// In brain.ts, before sending to AI:
const lastAction = this.actionHistory[this.actionHistory.length - 1];
if (lastAction) {
  contextParts.push(`\n🔄 LAST ACTION: ${lastAction.action.type} ${lastAction.action.target || ''}`);
  contextParts.push(`   Result: ${lastAction.result}`);
  contextParts.push(`   Success: ${lastAction.success ? '✓ YES' : '✗ NO'}`);

  // CRITICAL: Pattern reminder
  if (lastAction.action.type === 'mine' && !lastAction.result.includes('Failed')) {
    contextParts.push(`\n⚡ NEXT ACTION MUST BE: move up (to climb into the space you just mined!)`);
  }
  if (lastAction.action.type === 'place' && lastAction.success) {
    contextParts.push(`\n⚡ NEXT ACTION MUST BE: move up (to climb onto the block you just placed!)`);
  }
}
```

**Impact:** AI will see clear instruction on what to do next based on last action.

### Fix 4: Increase Temperature for FAST Mode 🟡 MEDIUM PRIORITY

**Problem:** Temperature 0.1 might be TOO deterministic, causing AI to get stuck in loops.

**Solution:** Increase FAST mode temperature from 0.1 to 0.2.

```typescript
const temperatures = {
  fast: 0.2,   // Was 0.1 - allow slight variation
  smart: 0.3,  // Was 0.2
  deep: 0.4    // Was 0.3
};
```

**Rationale:** Even game-playing agents need some exploration to avoid local minima.

---

## Vision Usage Question

**User asked:** "also the vision, are you using it?"

**Answer:** Vision is being used, but ONLY for movement stuck recovery, NOT for AI decision-making!

**Current vision usage:**
- Bot tries to walk somewhere
- Gets stuck (can't move)
- Triggers vision analysis (360° scan)
- Uses vision to find clear path
- Continues movement

**Vision is NOT used for:**
- Choosing which action to take (mine vs place vs move)
- Understanding surroundings before acting
- Strategic decision-making

**Potential improvement:**
Add vision to spatial observation, so AI can "see" what's around before deciding what to do.

But **spatial observation already provides this** - it's just not reaching the AI!

---

## Testing Plan

1. **Add debug logging** to verify spatial observation is in AI context
2. **Implement Fix 3** (explicit last action indicator) - highest impact
3. **Implement Fix 2** (skip item collection underground) - saves 7 seconds per mine
4. **Test the bot** - does it now alternate mine/move?
5. **If still not working** - implement Fix 4 (increase temperature)

---

**Next Steps:** Implement fixes in priority order and monitor bot behavior.
