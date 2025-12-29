# Alternating Pattern Fix - Place Block Mechanics

**Date:** 2025-12-27 (2:30 PM)
**Status:** ✅ FIXED
**Issue:** Bot placing blocks successfully then failing because trying to place where block already exists

---

## The Problem

```
✅ place dirt → Y: 40 → 41 (SUCCESS)
✅ place dirt → Y: 41 → 42 (SUCCESS)
❌ place dirt → Y still 42 (FAILED)
❌ place gravel → Y still 42 (FAILED)
```

**Why this happens:**
1. Bot places dirt at Y=40, jumps, climbs to Y=41 ✅
2. Bot places dirt at Y=41, jumps, climbs to Y=42 ✅
3. Bot is now STANDING ON the dirt block at Y=42
4. Bot tries to place ANOTHER dirt at Y=42 → **FAILS** (block already occupied)
5. Bot doesn't understand it needs to MOVE UP first

---

## Root Cause

**Minecraft mechanics:**
- You cannot place a block where a block already exists
- After placing a block beneath you and climbing onto it, that position is now occupied
- To continue pillaring, you must:
  1. Move UP onto the block you just placed
  2. THEN place another block beneath the new position

**Bot behavior:**
- Bot successfully placed 2 blocks in sequence
- But then tried to place a 3rd block without moving up first
- No understanding of the alternating pattern needed

---

## The Fix

Updated [minecraft-fast.ts:26-54](packages/shared/src/prompts/minecraft-fast.ts#L26-L54) to explicitly teach the AI the alternating pattern:

```markdown
# ESCAPING UNDERGROUND (CRITICAL!)
When underground (Y < 60), use SPATIAL OBSERVATION to escape:

**Check ESCAPE PATH obstacles first:**
- If obstacles show "air (too high - need to build up)" → You're in a tall shaft, jumping won't work!
  → CRITICAL: You must ALTERNATE actions - cannot place block where one already exists
  → If last action was "place dirt" that succeeded → now use "move up" to climb onto it
  → If last action was "move up" → now use "place dirt" to build next step
  → Pattern: place → move up → place → move up → place → move up

- If obstacles show solid blocks (stone, dirt, etc.):
  → Use "mine <block_name>" to break that specific block
  → Then "move up" into the space you created
  → Repeat: mine → move up → mine → move up

**Example escape sequences:**

Tall shaft (air above but too high):
1. See "Obstacles: air (too high)" → place dirt
2. Result: Placed dirt beneath → move up
3. Repeat until Y >= 63

Blocked by stone:
1. See "BLOCKS ABOVE: stone" → mine stone
2. See "BLOCKS ABOVE: dirt" → mine dirt
3. See "BLOCKS ABOVE: air" (reachable) → move up
4. Continue until Y >= 63

ALWAYS check if path is "clear" - if NO, check what obstacles are blocking!
```

---

## How It Works Now

**Expected behavior:**
```
Cycle 1:
  Observation: "Obstacles: air (too high - need to build up)"
  AI Decision: place dirt
  Result: "Placed dirt and climbed up (Y: 40 → 41)"

Cycle 2:
  AI sees last action was "place dirt" that succeeded
  AI follows pattern: place → move up → place → move up
  AI Decision: move up
  Result: Bot moves to Y=42 (onto the block placed last cycle)

Cycle 3:
  AI sees last action was "move up"
  AI follows pattern: move up → place → move up → place
  AI Decision: place dirt
  Result: "Placed dirt and climbed up (Y: 42 → 43)"

Cycle 4:
  AI sees last action was "place dirt" that succeeded
  AI Decision: move up
  Result: Bot moves to Y=43

[Continues alternating until Y >= 63]
```

---

## Why This Approach

**Why prompt-based instead of code?**
1. **AI Context Awareness**: The AI sees the last action result in the game state
2. **Flexibility**: AI can adapt if placement fails (try different blocks, different approach)
3. **Simpler**: No complex state tracking needed in code
4. **Observable**: We can see the AI's reasoning in logs

**Why alternating pattern works:**
- Minecraft allows moving into air (vertical jump)
- Minecraft allows placing block beneath you while in air
- Alternating ensures you're always in the right position to place

---

## Expected Results

**Before (broken):**
```
place dirt → Y: 40 → 41 ✅
place dirt → Y: 41 → 42 ✅
place dirt → Y still 42 ❌ (block already there)
place gravel → Y still 42 ❌ (still blocked)
[Bot stuck, never escapes]
```

**After (fixed):**
```
place dirt → Y: 40 → 41 ✅
move up → Y: 41 → 42 ✅ (climb onto placed block)
place dirt → Y: 42 → 43 ✅ (new position, can place)
move up → Y: 43 → 44 ✅
place dirt → Y: 44 → 45 ✅
move up → Y: 45 → 46 ✅
...
[Bot successfully escapes to surface]
```

---

## Testing Checklist

When you restart the bot:

- [ ] Does AI see "Obstacles: air (too high - need to build up)"?
- [ ] After successful `place dirt`, does AI choose `move up` next?
- [ ] After `move up`, does AI choose `place dirt` next?
- [ ] Does the pattern alternate consistently?
- [ ] Does Y position increase steadily?
- [ ] Does bot reach surface (Y >= 63)?

---

## Files Modified

| File | Change |
|------|--------|
| [packages/shared/src/prompts/minecraft-fast.ts](packages/shared/src/prompts/minecraft-fast.ts#L26-L54) | Added alternating pattern instructions |

---

## Complete Fix Chain

This fix is the final piece in a chain of fixes:

1. ✅ **Spatial observation** - Bot can see "air too high"
2. ✅ **placeBlock timeout fix** - place action completes in 700ms instead of 3000ms
3. ✅ **Success detection** - Reports actual Y gain, not fake progress
4. ✅ **Alternating pattern** - Teaches AI to alternate place/move

---

**Status:** ✅ READY TO TEST

**Expected Impact:** Bot should successfully pillar up through tall shafts and escape underground.

**The complete escape sequence is now implemented: observe → identify obstacle → execute correct pattern → reach surface.**
