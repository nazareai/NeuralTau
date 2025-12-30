# Minecraft Crafting Knowledge System

## Overview

This system provides the LLM with real-time knowledge of what can be crafted from the bot's current inventory. Instead of the AI guessing recipes or relying on training data, it receives explicit information about craftable items.

## How It Works

### 1. Recipe Database (`crafting-helper.ts`)

Contains 60+ essential Minecraft recipes organized by progression tier:

| Tier | Items | Purpose |
|------|-------|---------|
| 1 | Planks, Sticks, Crafting Table | Basic materials |
| 2 | Wooden Tools, Torches, Chest | First tools |
| 3 | Stone Tools, Furnace, Bow | Mining upgrade |
| 4 | Iron Tools, Armor, Bucket, Shield | Iron age |
| 5 | Diamond Tools, Advanced items | End game |

### 2. Inventory Analysis

When the bot makes a decision, the system:

1. Reads current inventory
2. Checks each recipe against available materials
3. Calculates how many of each item can be crafted
4. Identifies items that are "almost craftable" (missing 1 ingredient)
5. Suggests the optimal next craft for progression

### 3. LLM Context Integration

The crafting information is added to the context sent to the LLM:

```json
{
  "inv": ["oak_log:5", "cobblestone:12", "stick:4"],
  "crafting": "CAN CRAFT: oak_planks(20), stick(40), crafting_table(5), wooden_pickaxe*(1)\nALMOST: stone_pickaxe(need 2 stick)\n(* = needs crafting_table placed nearby)",
  "suggestCraft": "crafting_table (Required for all tool recipes)"
}
```

## Context Fields

### `crafting`
Shows what the bot can craft right now:
- **CAN CRAFT**: Items that can be made immediately with current materials
- **ALMOST**: Items that are 1 ingredient away from being craftable
- Items marked with `*` require a crafting table to be placed nearby

### `suggestCraft`
Recommends the optimal next craft based on progression:
- Follows the tool progression chain (wood → stone → iron → diamond)
- Prioritizes essential items (crafting table, pickaxe, furnace)
- Considers current tool availability

## Recipe Categories

### Essential (Tier 1)
- Planks (from any log type)
- Sticks
- Crafting Table

### Tools
- Pickaxes (wood/stone/iron/diamond)
- Axes
- Shovels
- Hoes

### Weapons
- Swords
- Bow & Arrow
- Shield

### Armor
- Helmet, Chestplate, Leggings, Boots (iron/diamond)

### Utility
- Torches
- Chest
- Bed
- Furnace
- Bucket
- Ladder

### Building
- Stairs
- Doors
- Fences

### Food
- Bread
- Golden Apple

## Wildcard Ingredients

The system handles "any type" ingredients:

- **any_planks**: Any wood plank type (oak, birch, spruce, jungle, acacia, dark_oak, etc.)
- **any_wool**: Any wool color
- **Log variants**: Stripped logs also work for plank recipes

## Files

| File | Purpose |
|------|---------|
| `packages/bot/src/games/crafting-helper.ts` | Recipe database and analysis functions |
| `packages/bot/src/ai/brain.ts` | Integration into LLM context |
| `packages/shared/src/prompts/minecraft-autonomous.ts` | Prompt explaining crafting fields |
| `packages/shared/src/prompts/minecraft-fast.ts` | Fast mode prompt with crafting info |

## API Functions

### `getCraftableItems(inventory, hasCraftingTableNearby)`
Returns array of craftable items with counts and requirements.

### `buildCraftableItemsContext(inventory, hasCraftingTableNearby, maxItems)`
Returns a compact string for LLM context.

### `getSuggestedCraft(inventory, hasCraftingTableNearby)`
Returns the recommended next craft for progression.

## Example Output

Given inventory: `oak_log x8, cobblestone x15, stick x6`

```
CAN CRAFT: oak_planks(32), stick(64), crafting_table(8), wooden_pickaxe*(1), wooden_axe*(1), furnace*(1), stone_pickaxe*(1)
ALMOST: torch(need 1 coal)
(* = needs crafting_table placed nearby)

suggestCraft: stone_pickaxe (Better durability, can mine iron)
```

## Benefits

1. **No Recipe Guessing**: LLM knows exactly what's possible
2. **Progression Guidance**: Suggests optimal next steps
3. **Token Efficient**: Compact format minimizes context size
4. **Dynamic**: Updates every decision cycle based on current inventory
5. **Handles Edge Cases**: Knows about crafting table requirements, wildcard ingredients
