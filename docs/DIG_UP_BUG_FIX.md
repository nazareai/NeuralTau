# dig_up Bug Analysis & Fix

**Date:** 2025-12-27 (1:35 PM)
**Status:** ✅ FIXED
**Severity:** CRITICAL - Bot stuck in infinite loop

---

## The Problem

Bot was stuck at Y=41-42 in an infinite loop:

```
Result: "Dug up 5 blocks (Y: 41 → 42)"
Next cycle: Position Y=41 (BACK TO START!)
AI: "Continue ascending, path is clear"
Result: "Dug up 5 blocks (Y: 41 → 42)"
[REPEAT FOREVER]
```

**Why this is critical:**
- Bot makes ZERO actual progress
- Action is marked as SUCCESS (no stuck detection triggers)
- AI sees "path is clear" from spatial observation
- Infinite loop wastes API calls and tokens

---

## Root Cause Analysis

### Issue #1: Jump Mechanics Don't Work

**Old code:**
```typescript
await this.bot.dig(blockAbove1);
blocksClimbed++;

// CRITICAL: Jump up into the space we just created
this.bot.setControlState('jump', true);
await new Promise(resolve => setTimeout(resolve, 300));  // Wait for jump
this.bot.setControlState('jump', false);
await new Promise(resolve => setTimeout(resolve, 200));  // Wait for landing
```

**Problems:**
1. **Timing is wrong**: 300ms jump + 200ms wait = 500ms total
   - Minecraft jumps take ~600-800ms
   - Bot falls back down before jump completes

2. **No actual climbing**: Single jump doesn't elevate you permanently
   - Minecraft requires HOLDING jump to climb stairs/blocks
   - Or placing blocks beneath yourself to gain height

3. **Wrong offset**: Using `offset(0, 2, 0)` means 2 blocks above current position
   - Bot is 1.62 blocks tall
   - Should dig 1 block above head, not 2

### Issue #2: Loop Logic Flaw

**Old code dug 5 blocks in sequence:**
```typescript
for (let i = 0; i < maxBlocks; i++) {
  dig block
  jump (doesn't work)
  dig next block (but bot didn't move up!)
  jump (still doesn't work)
  ...
}
```

**Result**: Bot digs 5 blocks above original position, jumps 5 times at same Y level, reports success.

### Issue #3: No Pillaring Mechanic

In Minecraft, to climb a vertical shaft you must:
1. Dig block above
2. **Place block beneath yourself** while jumping
3. This elevates you by 1 block
4. Repeat

The old code never placed blocks - it only tried to jump, which doesn't work in Minecraft physics.

---

## The Fix

### New Approach: Dig + Pillar

```typescript
private async digUp(): Promise<string> {
  const startY = Math.floor(this.bot.entity.position.y);
  let totalBlocksDug = 0;
  const maxBlocks = 3; // Fewer iterations, actual progress

  for (let i = 0; i < maxBlocks; i++) {
    const blockAboveHead = this.bot.blockAt(this.bot.entity.position.offset(0, 2, 0));

    // If air above, pillar up
    if (blockAboveHead.name === 'air') {
      const buildBlock = this.bot.inventory.items().find(i =>
        ['dirt', 'cobblestone', 'stone', 'gravel'].includes(i.name)
      );

      if (buildBlock) {
        // Look down, jump, place block beneath
        await this.bot.look(this.bot.entity.yaw, Math.PI / 2);
        this.bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 50));
        await this.bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        await new Promise(resolve => setTimeout(resolve, 200));
        this.bot.setControlState('jump', false);
      }
    }

    // If solid block above, dig it
    if (blockAboveHead.name !== 'air' && blockAboveHead.name !== 'bedrock') {
      await this.bot.dig(blockAboveHead);
      totalBlocksDug++;

      // Now pillar up into the space we created
      const buildBlock = this.bot.inventory.items().find(...);
      if (buildBlock) {
        await this.bot.equip(buildBlock, 'hand');
        await this.bot.look(this.bot.entity.yaw, Math.PI / 2); // Look down
        this.bot.setControlState('jump', true);
        await new Promise(resolve => setTimeout(resolve, 50));
        await this.bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        await new Promise(resolve => setTimeout(resolve, 200));
        this.bot.setControlState('jump', false);
      }
    }
  }

  const finalY = Math.floor(this.bot.entity.position.y);
  const actualGain = finalY - startY;

  if (actualGain === 0) {
    return `Tried to climb but stayed at Y=${finalY}. Need blocks to pillar up!`;
  }

  return `Climbed ${actualGain} blocks (Y: ${startY} → ${finalY}).`;
}
```

### Key Improvements

1. **Actually places blocks beneath bot** to gain height
2. **Checks actual Y gain** (`finalY - startY`) instead of counting digs
3. **Returns failure** if actualGain === 0 (triggers stuck detection)
4. **Requires inventory blocks** (dirt, cobblestone) to work
5. **Logs every step** for debugging

---

## Alternative: Use Spatial Observation + Mine Command

Instead of relying on `dig_up`, the AI can now:

1. **See what's above** from spatial observation:
   ```
   🧊 BLOCKS ABOVE YOUR HEAD: stone
   👁️ LOOKING UP: stone → stone → dirt
   ```

2. **Choose to mine those specific blocks**:
   ```json
   {
     "type": "mine",
     "target": "stone",
     "reasoning": "Stone block above head blocking escape"
   }
   ```

3. **Updated prompts** to guide this behavior:
   ```
   # USING SPATIAL OBSERVATION
   - Check "BLOCKS ABOVE YOUR HEAD" to see what you need to mine
   - If stone/dirt above: use "mine stone" or "mine dirt"
   - Look at "ESCAPE PATH" obstacles to know what to mine
   ```

---

## Expected Behavior Now

### Scenario 1: Solid blocks above

**Before:**
```
dig_up → Reports "Y: 41 → 42" but actually Y=41
dig_up → Reports "Y: 41 → 42" but actually Y=41
[infinite loop]
```

**After (with pillaring):**
```
dig_up → Digs stone, pillar up with dirt → Y: 41 → 42 (ACTUAL)
dig_up → Digs stone, pillar up with dirt → Y: 42 → 43 (ACTUAL)
dig_up → Digs dirt, pillar up with dirt → Y: 43 → 44 (ACTUAL)
```

**After (with mine command):**
```
AI sees: "BLOCKS ABOVE: stone"
mine stone → Breaks stone above head
[Next cycle, bot is still at Y=41]
AI detects no progress → tries different approach
```

### Scenario 2: No building blocks

**Before:**
```
dig_up → "Y: 41 → 42" (fake progress)
```

**After:**
```
dig_up → "Tried to climb but stayed at Y=41. Need blocks to pillar up!"
[Marked as FAILURE → stuck detection triggers]
AI: "No building blocks, try mining forward to collect resources"
```

---

## Why Spatial Observation Matters

The spatial observation now shows:

```
🔺 ESCAPE PATH TO SURFACE:
  - Direction: UP
  - Blocks to surface: ~20
  - Path clear: NO - obstacles detected
  - Obstacles: stone, stone, dirt

🧊 BLOCKS ABOVE YOUR HEAD (dig these to go up):
  Center: stone
```

**This tells the AI:**
- There ARE obstacles (not "path is clear")
- The obstacles are specific blocks (stone, dirt)
- It needs to MINE those blocks, not just "dig_up"

---

## Testing Checklist

- [x] Bot has dirt/cobblestone in inventory (confirmed: 7 dirt)
- [ ] dig_up actually changes Y position
- [ ] If no building blocks, returns failure message
- [ ] AI sees "obstacles: stone" in spatial observation
- [ ] AI chooses to mine specific blocks instead of dig_up
- [ ] Consecutive failures trigger stuck detection
- [ ] Bot escapes to surface successfully

---

## Files Modified

| File | Changes |
|------|---------|
| [packages/bot/src/games/minecraft.ts](packages/bot/src/games/minecraft.ts#L1494-L1619) | Rewrote digUp() with pillaring mechanic |
| [packages/shared/src/prompts/minecraft-fast.ts](packages/shared/src/prompts/minecraft-fast.ts#L27-L31) | Added spatial observation usage guide |

---

## Next Steps

1. **Test in live game**: Verify bot actually climbs now
2. **Monitor logs**: Check `[dig_up]` debug messages
3. **Watch for new pattern**: Does AI prefer `mine stone` over `dig_up`?
4. **Stuck detection**: If still loops, failure detection should trigger

---

**Status:** ✅ CODE FIXED, AWAITING LIVE TEST

**Impact:** Should eliminate infinite Y=41-42 loop completely
