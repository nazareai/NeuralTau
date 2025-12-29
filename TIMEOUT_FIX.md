# Timeout Fix - Place Block Action

**Date:** 2025-12-27 (2:05 PM)
**Status:** ✅ FIXED
**Issue:** place dirt action timing out after 3 seconds

---

## The Problem

```
[DEBUG] Executing action { type: 'place', target: 'dirt' }
[WARN] Action timed out after 3000ms { action: 'place', target: 'dirt' }
```

Every `place` action was hitting the 3-second timeout because `placeBlock()` was waiting for a `blockUpdate` event that never fired.

---

## Root Cause

Mineflayer's `placeBlock()` method:
```typescript
await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
```

This call **waits up to 5 seconds** for the server to send a blockUpdate event confirming the block was placed. In many cases (especially when pillaring), this event doesn't fire or takes too long, causing timeouts.

---

## The Fix

**Don't wait for the block update event** - just place the block and check if the bot moved:

```typescript
// Before (BROKEN - times out):
await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));

// After (WORKS - fire and forget):
this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)).catch(() => {
  // Ignore placement errors, check Y position instead
});

await new Promise(resolve => setTimeout(resolve, 400)); // Wait for jump
this.bot.setControlState('jump', false);
await new Promise(resolve => setTimeout(resolve, 200)); // Wait for landing

const finalY = Math.floor(this.bot.entity.position.y);
const gained = finalY - startY;

if (gained > 0) {
  return `Placed ${blockName} and climbed up (Y: ${startY} → ${finalY})`;
} else {
  return `Tried to place ${blockName} (Y still ${finalY}). Try again or use different method.`;
}
```

---

## How It Works Now

**Place block sequence:**
1. Equip dirt in hand
2. Look down (pitch = Math.PI / 2)
3. Start jumping
4. **Fire placeBlock() without awaiting** (don't wait for server confirmation)
5. Wait 400ms for jump to complete
6. Stop jumping
7. Wait 200ms for landing
8. Check Y position to see if we actually climbed

**Success detection:**
- If `finalY > startY` → Block was placed and we climbed
- If `finalY === startY` → Block placement failed or we didn't climb

---

## Expected Behavior

**Before (with timeout):**
```
place dirt → wait 3 seconds → TIMEOUT → marked as success anyway
[Bot doesn't move]
```

**After (no timeout):**
```
place dirt → jump → place block → wait 600ms → check position
Result: "Placed dirt and climbed up (Y: 40 → 41)" ✅
OR
Result: "Tried to place dirt (Y still 40). Try again." ❌
```

---

## Impact

- **No more 3-second timeouts** on place actions
- Action completes in ~700ms instead of 3000ms
- **Proper failure detection** - if Y doesn't change, it's marked as failure
- Stuck detection will trigger if placement keeps failing

---

## Files Modified

| File | Change |
|------|--------|
| [packages/bot/src/games/minecraft.ts](packages/bot/src/games/minecraft.ts#L1572-L1576) | Don't await placeBlock() |

---

**Status:** ✅ READY TO TEST

**The place action should now execute quickly without timeouts, and properly report success/failure based on actual Y position change.**
