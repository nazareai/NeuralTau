/**
 * Minecraft Crafting Helper
 *
 * Provides the LLM with knowledge of what can be crafted from current inventory.
 * Instead of the LLM guessing recipes, we tell it exactly what's possible.
 */

import { Logger } from '@tau/shared';

const logger = new Logger('CraftingHelper');

// Recipe definition
export interface Recipe {
  result: string;
  resultCount: number;
  ingredients: { item: string; count: number }[];
  requiresCraftingTable: boolean;
  category: 'essential' | 'tools' | 'weapons' | 'armor' | 'food' | 'building' | 'utility';
  tier?: number; // For progression ordering (1 = first priority)
}

// Craftable item result
export interface CraftableItem {
  item: string;
  canCraft: number; // How many can be crafted
  missingFor1?: { item: string; need: number; have: number }[]; // What's missing to craft 1
  requiresCraftingTable: boolean;
  category: string;
  tier?: number;
}

/**
 * Essential Minecraft recipes for survival mode
 * Organized by progression tier and category
 */
export const MINECRAFT_RECIPES: Recipe[] = [
  // ===========================================
  // TIER 1: First things to craft (from logs)
  // ===========================================
  {
    result: 'oak_planks',
    resultCount: 4,
    ingredients: [{ item: 'oak_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'birch_planks',
    resultCount: 4,
    ingredients: [{ item: 'birch_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'spruce_planks',
    resultCount: 4,
    ingredients: [{ item: 'spruce_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'jungle_planks',
    resultCount: 4,
    ingredients: [{ item: 'jungle_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'acacia_planks',
    resultCount: 4,
    ingredients: [{ item: 'acacia_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'dark_oak_planks',
    resultCount: 4,
    ingredients: [{ item: 'dark_oak_log', count: 1 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'stick',
    resultCount: 4,
    ingredients: [{ item: 'any_planks', count: 2 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },
  {
    result: 'crafting_table',
    resultCount: 1,
    ingredients: [{ item: 'any_planks', count: 4 }],
    requiresCraftingTable: false,
    category: 'essential',
    tier: 1,
  },

  // ===========================================
  // TIER 2: Basic wooden tools (need crafting table)
  // ===========================================
  {
    result: 'wooden_pickaxe',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 2,
  },
  {
    result: 'wooden_axe',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 2,
  },
  {
    result: 'wooden_shovel',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 1 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 2,
  },
  {
    result: 'wooden_hoe',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 2 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 2,
  },
  {
    result: 'wooden_sword',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 2 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 2,
  },

  // ===========================================
  // TIER 3: Stone tools (after getting cobblestone)
  // ===========================================
  {
    result: 'furnace',
    resultCount: 1,
    ingredients: [{ item: 'cobblestone', count: 8 }],
    requiresCraftingTable: true,
    category: 'essential',
    tier: 3,
  },
  {
    result: 'stone_pickaxe',
    resultCount: 1,
    ingredients: [
      { item: 'cobblestone', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 3,
  },
  {
    result: 'stone_axe',
    resultCount: 1,
    ingredients: [
      { item: 'cobblestone', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 3,
  },
  {
    result: 'stone_shovel',
    resultCount: 1,
    ingredients: [
      { item: 'cobblestone', count: 1 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 3,
  },
  {
    result: 'stone_hoe',
    resultCount: 1,
    ingredients: [
      { item: 'cobblestone', count: 2 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 3,
  },
  {
    result: 'stone_sword',
    resultCount: 1,
    ingredients: [
      { item: 'cobblestone', count: 2 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 3,
  },

  // ===========================================
  // TIER 4: Iron tools (after smelting iron)
  // ===========================================
  {
    result: 'iron_pickaxe',
    resultCount: 1,
    ingredients: [
      { item: 'iron_ingot', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 4,
  },
  {
    result: 'iron_axe',
    resultCount: 1,
    ingredients: [
      { item: 'iron_ingot', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 4,
  },
  {
    result: 'iron_shovel',
    resultCount: 1,
    ingredients: [
      { item: 'iron_ingot', count: 1 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 4,
  },
  {
    result: 'iron_sword',
    resultCount: 1,
    ingredients: [
      { item: 'iron_ingot', count: 2 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 4,
  },
  {
    result: 'bucket',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 3 }],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 4,
  },
  {
    result: 'shield',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 6 },
      { item: 'iron_ingot', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 4,
  },
  {
    result: 'shears',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 2 }],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 4,
  },

  // ===========================================
  // TIER 5: Diamond tools
  // ===========================================
  {
    result: 'diamond_pickaxe',
    resultCount: 1,
    ingredients: [
      { item: 'diamond', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 5,
  },
  {
    result: 'diamond_axe',
    resultCount: 1,
    ingredients: [
      { item: 'diamond', count: 3 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 5,
  },
  {
    result: 'diamond_sword',
    resultCount: 1,
    ingredients: [
      { item: 'diamond', count: 2 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 5,
  },

  // ===========================================
  // UTILITY & BUILDING
  // ===========================================
  {
    result: 'torch',
    resultCount: 4,
    ingredients: [
      { item: 'coal', count: 1 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: false,
    category: 'utility',
    tier: 2,
  },
  {
    result: 'torch',
    resultCount: 4,
    ingredients: [
      { item: 'charcoal', count: 1 },
      { item: 'stick', count: 1 },
    ],
    requiresCraftingTable: false,
    category: 'utility',
    tier: 2,
  },
  {
    result: 'chest',
    resultCount: 1,
    ingredients: [{ item: 'any_planks', count: 8 }],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 2,
  },
  {
    result: 'bed',
    resultCount: 1,
    ingredients: [
      { item: 'any_planks', count: 3 },
      { item: 'any_wool', count: 3 },
    ],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 2,
  },
  {
    result: 'ladder',
    resultCount: 3,
    ingredients: [{ item: 'stick', count: 7 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 2,
  },
  {
    result: 'oak_door',
    resultCount: 3,
    ingredients: [{ item: 'oak_planks', count: 6 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 2,
  },
  {
    result: 'oak_fence',
    resultCount: 3,
    ingredients: [
      { item: 'oak_planks', count: 4 },
      { item: 'stick', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'building',
    tier: 2,
  },
  {
    result: 'oak_stairs',
    resultCount: 4,
    ingredients: [{ item: 'oak_planks', count: 6 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 2,
  },
  {
    result: 'cobblestone_stairs',
    resultCount: 4,
    ingredients: [{ item: 'cobblestone', count: 6 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 3,
  },

  // ===========================================
  // COMBAT & ARMOR
  // ===========================================
  {
    result: 'bow',
    resultCount: 1,
    ingredients: [
      { item: 'stick', count: 3 },
      { item: 'string', count: 3 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 3,
  },
  {
    result: 'arrow',
    resultCount: 4,
    ingredients: [
      { item: 'flint', count: 1 },
      { item: 'stick', count: 1 },
      { item: 'feather', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'weapons',
    tier: 3,
  },
  {
    result: 'fishing_rod',
    resultCount: 1,
    ingredients: [
      { item: 'stick', count: 3 },
      { item: 'string', count: 2 },
    ],
    requiresCraftingTable: true,
    category: 'tools',
    tier: 3,
  },
  // Iron Armor
  {
    result: 'iron_helmet',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 5 }],
    requiresCraftingTable: true,
    category: 'armor',
    tier: 4,
  },
  {
    result: 'iron_chestplate',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 8 }],
    requiresCraftingTable: true,
    category: 'armor',
    tier: 4,
  },
  {
    result: 'iron_leggings',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 7 }],
    requiresCraftingTable: true,
    category: 'armor',
    tier: 4,
  },
  {
    result: 'iron_boots',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 4 }],
    requiresCraftingTable: true,
    category: 'armor',
    tier: 4,
  },

  // ===========================================
  // FOOD
  // ===========================================
  {
    result: 'bread',
    resultCount: 1,
    ingredients: [{ item: 'wheat', count: 3 }],
    requiresCraftingTable: true,
    category: 'food',
    tier: 3,
  },
  {
    result: 'golden_apple',
    resultCount: 1,
    ingredients: [
      { item: 'gold_ingot', count: 8 },
      { item: 'apple', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'food',
    tier: 5,
  },

  // ===========================================
  // REDSTONE & ADVANCED
  // ===========================================
  {
    result: 'compass',
    resultCount: 1,
    ingredients: [
      { item: 'iron_ingot', count: 4 },
      { item: 'redstone', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 4,
  },
  {
    result: 'clock',
    resultCount: 1,
    ingredients: [
      { item: 'gold_ingot', count: 4 },
      { item: 'redstone', count: 1 },
    ],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 4,
  },
  {
    result: 'anvil',
    resultCount: 1,
    ingredients: [
      { item: 'iron_block', count: 3 },
      { item: 'iron_ingot', count: 4 },
    ],
    requiresCraftingTable: true,
    category: 'utility',
    tier: 5,
  },
  {
    result: 'iron_block',
    resultCount: 1,
    ingredients: [{ item: 'iron_ingot', count: 9 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 4,
  },
  {
    result: 'gold_block',
    resultCount: 1,
    ingredients: [{ item: 'gold_ingot', count: 9 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 5,
  },
  {
    result: 'diamond_block',
    resultCount: 1,
    ingredients: [{ item: 'diamond', count: 9 }],
    requiresCraftingTable: true,
    category: 'building',
    tier: 5,
  },
];

/**
 * Items that count as "any_planks" in recipes
 */
const PLANK_TYPES = [
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'bamboo_planks', 'crimson_planks', 'warped_planks',
];

/**
 * Items that count as "any_wool" in recipes
 */
const WOOL_TYPES = [
  'white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool',
  'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool',
  'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool',
  'brown_wool', 'green_wool', 'red_wool', 'black_wool',
];

/**
 * Log types that can be converted to planks
 */
const LOG_TO_PLANKS: Record<string, string> = {
  'oak_log': 'oak_planks',
  'birch_log': 'birch_planks',
  'spruce_log': 'spruce_planks',
  'jungle_log': 'jungle_planks',
  'acacia_log': 'acacia_planks',
  'dark_oak_log': 'dark_oak_planks',
  'mangrove_log': 'mangrove_planks',
  'cherry_log': 'cherry_planks',
  'stripped_oak_log': 'oak_planks',
  'stripped_birch_log': 'birch_planks',
  'stripped_spruce_log': 'spruce_planks',
  'stripped_jungle_log': 'jungle_planks',
  'stripped_acacia_log': 'acacia_planks',
  'stripped_dark_oak_log': 'dark_oak_planks',
};

/**
 * Get the count of an ingredient from inventory, handling "any_" wildcards
 */
function getIngredientCount(
  ingredientName: string,
  inventory: Map<string, number>
): number {
  if (ingredientName === 'any_planks') {
    let total = 0;
    for (const plankType of PLANK_TYPES) {
      total += inventory.get(plankType) || 0;
    }
    return total;
  }

  if (ingredientName === 'any_wool') {
    let total = 0;
    for (const woolType of WOOL_TYPES) {
      total += inventory.get(woolType) || 0;
    }
    return total;
  }

  return inventory.get(ingredientName) || 0;
}

/**
 * Check if a recipe can be crafted with given inventory
 */
function canCraftRecipe(
  recipe: Recipe,
  inventory: Map<string, number>,
  hasCraftingTable: boolean
): { canCraft: number; missing: { item: string; need: number; have: number }[] } {
  // Check if crafting table is available (either in inventory or nearby)
  if (recipe.requiresCraftingTable && !hasCraftingTable) {
    return { canCraft: 0, missing: [{ item: 'crafting_table', need: 1, have: 0 }] };
  }

  let maxCraftable = Infinity;
  const missing: { item: string; need: number; have: number }[] = [];

  for (const ingredient of recipe.ingredients) {
    const have = getIngredientCount(ingredient.item, inventory);
    const canMake = Math.floor(have / ingredient.count);

    if (canMake === 0) {
      missing.push({
        item: ingredient.item,
        need: ingredient.count,
        have: have,
      });
    }

    maxCraftable = Math.min(maxCraftable, canMake);
  }

  return {
    canCraft: maxCraftable === Infinity ? 0 : maxCraftable,
    missing,
  };
}

/**
 * Get all items that can be crafted from current inventory
 * Returns items sorted by tier (most essential first)
 */
export function getCraftableItems(
  inventory: { name: string; count: number }[],
  hasCraftingTableNearby: boolean = false
): CraftableItem[] {
  // Convert inventory to map for easier lookup
  const invMap = new Map<string, number>();
  for (const item of inventory) {
    invMap.set(item.name, (invMap.get(item.name) || 0) + item.count);
  }

  // Check if player has a crafting table in inventory
  const hasCraftingTableInInventory = (invMap.get('crafting_table') || 0) > 0;
  const hasCraftingTable = hasCraftingTableInInventory || hasCraftingTableNearby;

  const craftableItems: CraftableItem[] = [];
  const seenItems = new Set<string>(); // Avoid duplicates (e.g., torch from coal vs charcoal)

  for (const recipe of MINECRAFT_RECIPES) {
    // Skip if we've already added this item (handles alternative recipes)
    if (seenItems.has(recipe.result)) {
      // But check if this alternative recipe can craft more
      const existing = craftableItems.find(c => c.item === recipe.result);
      if (existing) {
        const { canCraft } = canCraftRecipe(recipe, invMap, hasCraftingTable);
        if (canCraft > existing.canCraft) {
          existing.canCraft = canCraft;
          existing.missingFor1 = undefined; // Clear missing since we can now craft it
        }
      }
      continue;
    }

    const { canCraft, missing } = canCraftRecipe(recipe, invMap, hasCraftingTable);

    // Only add if we can craft it OR we're close (missing only 1-2 ingredients)
    if (canCraft > 0 || missing.length <= 2) {
      craftableItems.push({
        item: recipe.result,
        canCraft: canCraft * recipe.resultCount,
        missingFor1: canCraft === 0 ? missing : undefined,
        requiresCraftingTable: recipe.requiresCraftingTable,
        category: recipe.category,
        tier: recipe.tier,
      });
      seenItems.add(recipe.result);
    }
  }

  // Sort by: craftable first, then by tier, then by category priority
  const categoryPriority: Record<string, number> = {
    essential: 0,
    tools: 1,
    weapons: 2,
    armor: 3,
    utility: 4,
    food: 5,
    building: 6,
  };

  craftableItems.sort((a, b) => {
    // Craftable items first
    if (a.canCraft > 0 && b.canCraft === 0) return -1;
    if (a.canCraft === 0 && b.canCraft > 0) return 1;

    // Then by tier
    const tierA = a.tier || 99;
    const tierB = b.tier || 99;
    if (tierA !== tierB) return tierA - tierB;

    // Then by category
    return (categoryPriority[a.category] || 99) - (categoryPriority[b.category] || 99);
  });

  return craftableItems;
}

/**
 * Build a concise string for LLM context showing what can be crafted
 * Optimized for token efficiency
 */
export function buildCraftableItemsContext(
  inventory: { name: string; count: number }[],
  hasCraftingTableNearby: boolean = false,
  maxItems: number = 10
): string {
  const craftable = getCraftableItems(inventory, hasCraftingTableNearby);

  if (craftable.length === 0) {
    return 'CAN CRAFT: nothing (need materials)';
  }

  const lines: string[] = [];

  // Items that CAN be crafted now
  const canCraftNow = craftable.filter(c => c.canCraft > 0).slice(0, maxItems);
  if (canCraftNow.length > 0) {
    const craftList = canCraftNow.map(c => {
      const tableNote = c.requiresCraftingTable ? '*' : '';
      return `${c.item}${tableNote}(${c.canCraft})`;
    });
    lines.push(`CAN CRAFT: ${craftList.join(', ')}`);
  }

  // Items that are ALMOST craftable (good suggestions)
  const almostCraftable = craftable
    .filter(c => c.canCraft === 0 && c.missingFor1 && c.missingFor1.length === 1)
    .slice(0, 5);

  if (almostCraftable.length > 0) {
    const almostList = almostCraftable.map(c => {
      const missing = c.missingFor1![0];
      return `${c.item}(need ${missing.need - missing.have} ${missing.item})`;
    });
    lines.push(`ALMOST: ${almostList.join(', ')}`);
  }

  // Add legend if crafting table items are present
  if (canCraftNow.some(c => c.requiresCraftingTable)) {
    lines.push('(* = needs crafting_table placed nearby)');
  }

  return lines.join('\n');
}

/**
 * Get suggested next craft based on progression
 * Returns the most important thing to craft next
 */
export function getSuggestedCraft(
  inventory: { name: string; count: number }[],
  hasCraftingTableNearby: boolean = false
): { suggestion: string; reason: string } | null {
  const invMap = new Map<string, number>();
  for (const item of inventory) {
    invMap.set(item.name, (invMap.get(item.name) || 0) + item.count);
  }

  // Check what tools we already have
  const hasWoodenPickaxe = (invMap.get('wooden_pickaxe') || 0) > 0;
  const hasStonePickaxe = (invMap.get('stone_pickaxe') || 0) > 0;
  const hasIronPickaxe = (invMap.get('iron_pickaxe') || 0) > 0;
  const hasCraftingTable = (invMap.get('crafting_table') || 0) > 0 || hasCraftingTableNearby;

  // Get planks count
  let planksCount = 0;
  for (const plankType of PLANK_TYPES) {
    planksCount += invMap.get(plankType) || 0;
  }

  // Get logs count
  let logsCount = 0;
  for (const logType of Object.keys(LOG_TO_PLANKS)) {
    logsCount += invMap.get(logType) || 0;
  }

  const sticksCount = invMap.get('stick') || 0;
  const cobblestoneCount = invMap.get('cobblestone') || 0;
  const ironIngotCount = invMap.get('iron_ingot') || 0;

  // Progression logic

  // 1. Need planks first
  if (planksCount < 4 && logsCount > 0) {
    const logType = Object.keys(LOG_TO_PLANKS).find(l => (invMap.get(l) || 0) > 0);
    const plankType = logType ? LOG_TO_PLANKS[logType] : 'oak_planks';
    return { suggestion: plankType, reason: 'Need planks for crafting table and tools' };
  }

  // 2. Need crafting table
  if (!hasCraftingTable && planksCount >= 4) {
    return { suggestion: 'crafting_table', reason: 'Required for all tool recipes' };
  }

  // 3. Need sticks
  if (sticksCount < 2 && planksCount >= 2) {
    return { suggestion: 'stick', reason: 'Required for tools' };
  }

  // 4. Need wooden pickaxe (to mine stone)
  if (!hasWoodenPickaxe && hasCraftingTable && planksCount >= 3 && sticksCount >= 2) {
    return { suggestion: 'wooden_pickaxe', reason: 'Required to mine stone/cobblestone' };
  }

  // 5. Upgrade to stone pickaxe
  if (hasWoodenPickaxe && !hasStonePickaxe && cobblestoneCount >= 3 && sticksCount >= 2) {
    return { suggestion: 'stone_pickaxe', reason: 'Better durability, can mine iron' };
  }

  // 6. Upgrade to iron pickaxe
  if (hasStonePickaxe && !hasIronPickaxe && ironIngotCount >= 3 && sticksCount >= 2) {
    return { suggestion: 'iron_pickaxe', reason: 'Can mine diamond and obsidian' };
  }

  // 7. Furnace for smelting
  if (hasWoodenPickaxe && cobblestoneCount >= 8 && (invMap.get('furnace') || 0) === 0) {
    return { suggestion: 'furnace', reason: 'Smelt iron ore into ingots' };
  }

  // 8. Torches if we have coal
  const coalCount = (invMap.get('coal') || 0) + (invMap.get('charcoal') || 0);
  if (coalCount > 0 && sticksCount > 0 && (invMap.get('torch') || 0) < 16) {
    return { suggestion: 'torch', reason: 'Light up caves and prevent mob spawns' };
  }

  return null;
}

/**
 * Export a summary for logging/debugging
 */
export function logCraftingStatus(
  inventory: { name: string; count: number }[],
  hasCraftingTableNearby: boolean = false
): void {
  const context = buildCraftableItemsContext(inventory, hasCraftingTableNearby);
  const suggestion = getSuggestedCraft(inventory, hasCraftingTableNearby);

  logger.info('[CRAFTING] Status', {
    craftableContext: context,
    suggestion: suggestion?.suggestion,
    reason: suggestion?.reason,
  });
}
