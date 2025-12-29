/**
 * Minecraft AI Decision-Making Brain
 *
 * This file contains all the intelligent decision-making logic for the Minecraft bot.
 * Separated from the main game file to allow easy review and updates to prompts/strategies.
 *
 * Based on optimal Minecraft survival strategies:
 * - Tool progression: wood -> stone -> iron -> diamond -> netherite
 * - Early game priorities: shelter, food, basic tools
 * - Smart mining: never dig straight down, use proper tools for blocks
 * - Underground survival: always dig up to surface when stuck
 * - Vision-based obstacle detection
 */

import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Logger } from '@tau/shared';

const logger = new Logger('MinecraftBrain');

// ============================================================================
// PROMPTS - Easy to review and update
// ============================================================================

export const MINECRAFT_PROMPTS = {
  // When bot spawns or starts
  INITIAL_STRATEGY: `You are in Minecraft survival mode. Your immediate priorities are:
1. Gather wood by punching trees (at least 8 logs)
2. Craft a crafting table and wooden pickaxe
3. Mine stone to make stone tools
4. Find or create shelter before nightfall
5. Gather food (hunt animals or find crops)
Never dig straight down. Always place torches to prevent mob spawns.`,

  // When stuck against a wall
  WALL_STUCK_STRATEGY: `You are stuck against a wall. Actions to try:
1. STOP and look around slowly (360 degrees) to understand your surroundings
2. If you can see sky/light above, dig UP to escape
3. If underground in darkness, place torches and analyze blocks around you
4. Use pickaxe to dig through stone/ores, shovel for dirt/gravel
5. Never dig straight down - dig stairs or ladder shafts
6. If you hit bedrock, you're at bottom - must go UP`,

  // When underground
  UNDERGROUND_STRATEGY: `You are underground (y < 60). Your goal is to reach surface:
1. Check your Y coordinate - if below 60, you need to go UP
2. Look for natural caves that lead upward
3. If no caves, dig a staircase UP at 45-degree angle
4. Place torches every 7 blocks to light your path
5. Listen for sounds: water/lava nearby, mobs spawning
6. If you find valuable ores (iron, coal, diamonds), mark location but prioritize escape first`,

  // When choosing what to mine
  MINING_DECISION: `Before mining a block, check:
1. What tool do I have? (hand, wood, stone, iron pickaxe/axe/shovel?)
2. What block am I mining? (dirt, stone, ore, wood?)
3. Is this efficient? (digging dirt with pickaxe wastes durability)

TOOL EFFICIENCY RULES:
- HAND: Only for wood logs, leaves, dirt (very slow)
- WOODEN PICKAXE: Stone, cobblestone (DO NOT waste on dirt!)
- WOODEN AXE: Wood logs (much faster than hand)
- SHOVEL: Dirt, sand, gravel, snow (very fast)
- STONE PICKAXE: Stone, ores (coal, iron), cobblestone
- IRON PICKAXE: All of above + diamond, gold, redstone

NEVER mine these with wrong tool:
- Stone/ores without pickaxe = nothing drops
- Dirt with pickaxe = wastes durability (use shovel or hand)`,

  // Tool progression
  TOOL_PROGRESSION: `Minecraft tool progression path:
1. HAND -> Punch trees (wood logs)
2. WOOD TOOLS -> Craft from wood planks (temporary, low durability)
3. STONE TOOLS -> Mine stone with wooden pickaxe, upgrade to stone tools (2x durability)
4. IRON TOOLS -> Mine iron ore with stone pickaxe, smelt in furnace, craft iron tools (3x durability)
5. DIAMOND TOOLS -> Mine diamond ore with iron pickaxe (RARE, y=5-16), craft diamond tools
6. NETHERITE -> Endgame, upgrade diamond tools in Nether

Current priority: If you have wood pickaxe, GET STONE TOOLS ASAP.
If you have stone tools, FIND IRON ORE (y=0-64, gray blocks with tan spots).`,

  // When lost or disoriented
  LOST_STRATEGY: `You seem lost or disoriented. Recovery steps:
1. Press F3 to check coordinates (Y level most important)
2. If Y > 60: you're near surface, look for high ground
3. If Y < 60: you're underground, follow UNDERGROUND_STRATEGY
4. Look for landmarks: trees (surface), stone (underground), water
5. If you spawned, you're probably near spawn point (x=0, z=0)
6. Build a dirt pillar to get high and scout (place blocks below you as you jump)`,

  // When night falls
  NIGHT_STRATEGY: `Night has fallen (hostile mobs spawn). Priority actions:
1. If you have shelter with door/walls: GO INSIDE immediately
2. If no shelter: dig 3 blocks down, cover hole with dirt block (temporary)
3. Place torches inside shelter (light level 8+ prevents spawns)
4. If you have bed: sleep to skip night (must be enclosed area)
5. DO NOT venture outside at night without armor/weapons
6. Use night time to: craft tools, smelt ores, organize inventory`,

  // When health is low
  LOW_HEALTH_STRATEGY: `Your health is low (< 6 hearts). Survival priority:
1. STOP moving and assess threats
2. Eat food immediately (cooked meat = 4 hunger, bread = 2.5)
3. Retreat to shelter or dig emergency hole
4. If being attacked: block with shield, run away, dig escape hole
5. DO NOT mine, explore, or fight until health regenerates
6. Health regenerates when hunger bar is full (eat to fill it)`,

  // Food sources
  FOOD_STRATEGY: `Food is critical (hunger bar = health regen). Priority sources:
EARLY GAME (first day):
1. Kill animals: cows (beef), pigs (porkchop), chickens (chicken), sheep (mutton)
2. Collect: apples from trees, berries from bushes, carrots/potatoes from villages
3. Cook raw meat in furnace (coal/wood fuel) = 2x hunger restored

MID GAME (sustainable):
1. Wheat farm: plant seeds, harvest, craft bread
2. Animal breeding: feed 2 cows wheat to breed baby cow
3. Fishing: craft fishing rod, fish in water

NEVER eat: rotten flesh (poison), raw chicken (poison), spider eyes (poison)`,
};

// ============================================================================
// DECISION MAKING LOGIC
// ============================================================================

export interface GameState {
  position: Vec3;
  health: number;
  food: number;
  timeOfDay: number; // 0-24000 (0=sunrise, 6000=noon, 12000=sunset, 18000=midnight)
  dimension: string; // 'overworld', 'nether', 'end'
  inventory: {
    wood: number;
    cobblestone: number;
    ironOre: number;
    coal: number;
    food: number;
    torches: number;
  };
  tools: {
    hasWoodenPickaxe: boolean;
    hasStonePickaxe: boolean;
    hasIronPickaxe: boolean;
    hasAxe: boolean;
    hasShovel: boolean;
  };
  surroundings: {
    isUnderground: boolean; // Y < 60
    isDeepUnderground: boolean; // Y < 0
    inWater: boolean;
    inLava: boolean;
    nearMobs: boolean;
    lightLevel: number; // 0-15
    blocksAhead: string[]; // What blocks are visible ahead
    canSeeSky: boolean;
  };
}

export interface Decision {
  action: 'navigate' | 'dig' | 'craft' | 'fight' | 'flee' | 'wait' | 'look_around' | 'dig_up_escape';
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  target?: { x: number; y: number; z: number } | string;
  tool?: string;
  prompt?: string; // Relevant prompt from MINECRAFT_PROMPTS
}

/**
 * Main decision-making function
 * Evaluates current game state and returns the best action to take
 */
export function makeDecision(state: GameState): Decision {
  // CRITICAL: Life-threatening situations
  if (state.health < 6) {
    return {
      action: 'flee',
      priority: 'critical',
      reason: 'Health critically low - must retreat and eat',
      prompt: MINECRAFT_PROMPTS.LOW_HEALTH_STRATEGY
    };
  }

  if (state.surroundings.inLava) {
    return {
      action: 'flee',
      priority: 'critical',
      reason: 'IN LAVA - swim up and out immediately!',
      target: { x: state.position.x, y: state.position.y + 3, z: state.position.z }
    };
  }

  // CRITICAL: Underground and need to escape
  if (state.surroundings.isDeepUnderground && !state.tools.hasStonePickaxe) {
    return {
      action: 'dig_up_escape',
      priority: 'critical',
      reason: 'Deep underground without proper tools - must dig up to surface',
      target: { x: state.position.x, y: 70, z: state.position.z }, // Dig to surface level
      prompt: MINECRAFT_PROMPTS.UNDERGROUND_STRATEGY
    };
  }

  // HIGH: Night time without shelter
  const isNight = state.timeOfDay > 13000 && state.timeOfDay < 23000;
  if (isNight && !state.surroundings.isUnderground && state.surroundings.nearMobs) {
    return {
      action: 'dig',
      priority: 'high',
      reason: 'Night time - must create emergency shelter',
      target: 'emergency_shelter',
      prompt: MINECRAFT_PROMPTS.NIGHT_STRATEGY
    };
  }

  // HIGH: Stuck underground, need to escape
  if (state.surroundings.isUnderground && state.position.y < 60) {
    return {
      action: 'dig_up_escape',
      priority: 'high',
      reason: `Underground at Y=${state.position.y.toFixed(0)} - should return to surface`,
      target: { x: state.position.x, y: 70, z: state.position.z },
      prompt: MINECRAFT_PROMPTS.UNDERGROUND_STRATEGY
    };
  }

  // MEDIUM: No tools - must get wood first
  if (!state.tools.hasWoodenPickaxe && state.inventory.wood < 4) {
    return {
      action: 'navigate',
      priority: 'high',
      reason: 'Need wood to craft basic tools',
      target: 'nearest_tree',
      prompt: MINECRAFT_PROMPTS.INITIAL_STRATEGY
    };
  }

  // MEDIUM: Have wood tools but no stone tools
  if (state.tools.hasWoodenPickaxe && !state.tools.hasStonePickaxe) {
    return {
      action: 'dig',
      priority: 'high',
      reason: 'Need to mine cobblestone for stone tools (major upgrade)',
      target: 'stone',
      tool: 'wooden_pickaxe',
      prompt: MINECRAFT_PROMPTS.TOOL_PROGRESSION
    };
  }

  // MEDIUM: Hungry - need food
  if (state.food < 6) {
    return {
      action: 'navigate',
      priority: 'medium',
      reason: 'Hunger low - need to find and hunt animals',
      target: 'nearest_animal',
      prompt: MINECRAFT_PROMPTS.FOOD_STRATEGY
    };
  }

  // LOW: Standard exploration/progression
  if (state.tools.hasStonePickaxe && !state.tools.hasIronPickaxe) {
    return {
      action: 'navigate',
      priority: 'medium',
      reason: 'Have stone tools - should mine for iron ore (y=0-64)',
      target: 'iron_ore_level',
      prompt: MINECRAFT_PROMPTS.TOOL_PROGRESSION
    };
  }

  // DEFAULT: Look around to gather information
  return {
    action: 'look_around',
    priority: 'low',
    reason: 'No immediate threats - scanning environment',
    prompt: MINECRAFT_PROMPTS.INITIAL_STRATEGY
  };
}

/**
 * Determine if bot should dig a block based on tool efficiency
 */
export function shouldDigBlock(
  blockName: string,
  currentTool: string | null
): { shouldDig: boolean; reason: string; recommendedTool?: string } {
  // Blocks that should NEVER be mined
  const impossibleBlocks = ['bedrock', 'barrier', 'command_block', 'end_portal_frame'];
  if (impossibleBlocks.includes(blockName)) {
    return { shouldDig: false, reason: 'Block cannot be mined (unbreakable)' };
  }

  // Dirt, sand, gravel - use shovel or hand (NOT pickaxe)
  const shovelBlocks = ['dirt', 'grass_block', 'sand', 'gravel', 'soul_sand', 'snow', 'clay'];
  if (shovelBlocks.includes(blockName)) {
    if (currentTool === 'pickaxe') {
      return {
        shouldDig: false,
        reason: 'Do NOT use pickaxe on dirt/sand (wastes durability)',
        recommendedTool: 'shovel or hand'
      };
    }
    return { shouldDig: true, reason: 'Shovel block - efficient to dig' };
  }

  // Wood - use axe (or hand if desperate)
  const woodBlocks = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'oak_planks'];
  if (woodBlocks.some(w => blockName.includes(w)) || blockName.includes('_log') || blockName.includes('_wood')) {
    if (!currentTool || currentTool === 'hand') {
      return { shouldDig: true, reason: 'Wood block - can punch but axe is much faster', recommendedTool: 'axe' };
    }
    return { shouldDig: true, reason: 'Wood block - good to chop' };
  }

  // Stone, ores - REQUIRE pickaxe (must actually be holding a pickaxe, not just "not holding something else")
  const pickaxeRequired = [
    'stone', 'cobblestone', 'andesite', 'diorite', 'granite',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'redstone_ore', 'lapis_ore',
    'netherrack', 'obsidian'
  ];
  if (pickaxeRequired.some(b => blockName.includes(b))) {
    // Check if actually holding a pickaxe (wooden_pickaxe, stone_pickaxe, iron_pickaxe, etc.)
    const hasPickaxe = currentTool && currentTool.includes('pickaxe');

    if (!hasPickaxe) {
      return {
        shouldDig: false,
        reason: `Stone/ore requires pickaxe - will drop nothing with ${currentTool || 'bare hands'}`,
        recommendedTool: 'pickaxe'
      };
    }

    // Special case: Diamond/obsidian require IRON pickaxe minimum
    if ((blockName.includes('diamond') || blockName.includes('obsidian')) && !currentTool.includes('iron')) {
      return {
        shouldDig: false,
        reason: 'Diamond/obsidian requires iron pickaxe or better',
        recommendedTool: 'iron_pickaxe'
      };
    }

    return { shouldDig: true, reason: 'Stone/ore block - correct tool equipped' };
  }

  // Default: probably safe to mine
  return { shouldDig: true, reason: 'Block appears mineable' };
}

/**
 * Analyze surroundings and determine if stuck/blocked
 */
export function analyzeStuckSituation(
  bot: Bot,
  lastPositions: Vec3[]
): { isStuck: boolean; stuckType: string; recommendedAction: Decision | null } {
  if (lastPositions.length < 3) {
    return { isStuck: false, stuckType: 'none', recommendedAction: null };
  }

  const current = bot.entity.position;
  const previous = lastPositions[lastPositions.length - 1];
  const movedDist = current.distanceTo(previous);

  // Not stuck if moving
  if (movedDist > 0.1) {
    return { isStuck: false, stuckType: 'none', recommendedAction: null };
  }

  // Check what's blocking
  const blockAhead = bot.blockAtCursor(3);
  const blockAbove = bot.blockAt(current.offset(0, 2, 0));
  const blockBelow = bot.blockAt(current.offset(0, -1, 0));

  // Stuck underground (most common)
  if (current.y < 60 && blockAbove && blockAbove.name !== 'air') {
    return {
      isStuck: true,
      stuckType: 'underground_trapped',
      recommendedAction: {
        action: 'dig_up_escape',
        priority: 'high',
        reason: 'Trapped underground - must dig staircase up',
        target: { x: current.x, y: 70, z: current.z },
        prompt: MINECRAFT_PROMPTS.UNDERGROUND_STRATEGY
      }
    };
  }

  // Stuck against wall
  if (blockAhead && blockAhead.name !== 'air' && blockAhead.name !== 'water') {
    return {
      isStuck: true,
      stuckType: 'wall_blocked',
      recommendedAction: {
        action: 'look_around',
        priority: 'high',
        reason: 'Hit wall - need to look around and find path',
        prompt: MINECRAFT_PROMPTS.WALL_STUCK_STRATEGY
      }
    };
  }

  // Stuck in hole
  if (blockBelow && blockBelow.name === 'air') {
    return {
      isStuck: true,
      stuckType: 'falling_or_hole',
      recommendedAction: {
        action: 'wait',
        priority: 'medium',
        reason: 'In air or hole - wait for landing or build up'
      }
    };
  }

  return { isStuck: true, stuckType: 'unknown', recommendedAction: null };
}

/**
 * Calculate optimal digging direction when underground
 * Returns yaw and pitch to dig at 45-degree angle upward (staircase)
 */
export function calculateEscapeDigDirection(currentPos: Vec3, targetY: number): { yaw: number; pitch: number; reason: string } {
  // Dig up at 45-degree angle to create stairs
  // This is safer than straight up (blocks can fall on you)
  const pitch = -Math.PI / 4; // 45 degrees up

  // Yaw: pick a direction away from nearest wall
  // For now, just pick north (0) for consistency
  const yaw = 0;

  return {
    yaw,
    pitch,
    reason: `Digging staircase up from Y=${currentPos.y.toFixed(0)} to Y=${targetY} at 45° angle`
  };
}

/**
 * Get current game state from bot
 */
export function getCurrentGameState(bot: Bot): GameState {
  const pos = bot.entity.position;
  const inventory = bot.inventory.items();

  // Count resources
  const wood = inventory.filter(i => i.name.includes('log')).reduce((sum, i) => sum + i.count, 0);
  const cobblestone = inventory.filter(i => i.name === 'cobblestone').reduce((sum, i) => sum + i.count, 0);
  const ironOre = inventory.filter(i => i.name === 'iron_ore').reduce((sum, i) => sum + i.count, 0);
  const coal = inventory.filter(i => i.name === 'coal').reduce((sum, i) => sum + i.count, 0);
  const torches = inventory.filter(i => i.name === 'torch').reduce((sum, i) => sum + i.count, 0);

  // Count food items
  const foodItems = ['cooked_beef', 'cooked_porkchop', 'bread', 'apple', 'cooked_chicken', 'cooked_mutton'];
  const food = inventory.filter(i => foodItems.includes(i.name)).reduce((sum, i) => sum + i.count, 0);

  // Check tools
  const hasWoodenPickaxe = inventory.some(i => i.name === 'wooden_pickaxe');
  const hasStonePickaxe = inventory.some(i => i.name === 'stone_pickaxe');
  const hasIronPickaxe = inventory.some(i => i.name === 'iron_pickaxe');
  const hasAxe = inventory.some(i => i.name.includes('_axe'));
  const hasShovel = inventory.some(i => i.name.includes('_shovel'));

  // Analyze surroundings
  const isUnderground = pos.y < 60;
  const isDeepUnderground = pos.y < 0;
  const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
  const canSeeSky = !blockAbove || blockAbove.name === 'air';

  // Check for water/lava
  const blockAtFeet = bot.blockAt(pos);
  const inWater = blockAtFeet?.name === 'water';
  const inLava = blockAtFeet?.name === 'lava';

  // Get light level
  const lightLevel = blockAtFeet?.light || 0;

  // Check for nearby entities (mobs) - ONLY within field of view
  // Human-like: can only see what's in front of you
  const botYaw = bot.entity.yaw;
  const FOV_HALF_RADIANS = Math.PI * 0.39; // ~70 degrees
  
  const nearbyEntities = Object.values(bot.entities).filter(e => {
    if (!e.position || e.type !== 'mob') return false;
    const dist = e.position.distanceTo(pos);
    if (dist > 10 || dist < 0.5) return false;
    
    // Check if within field of view
    const dx = e.position.x - pos.x;
    const dz = e.position.z - pos.z;
    const angleToEntity = Math.atan2(-dx, -dz);
    let angleDiff = angleToEntity - botYaw;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    return Math.abs(angleDiff) < FOV_HALF_RADIANS;
  });
  const nearMobs = nearbyEntities.length > 0;

  // Look ahead
  const blocksAhead: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const block = bot.blockAtCursor(i);
    if (block && block.name !== 'air') {
      blocksAhead.push(block.name);
    }
  }

  return {
    position: pos,
    health: bot.health,
    food: bot.food,
    timeOfDay: bot.time.timeOfDay,
    dimension: bot.game.dimension,
    inventory: { wood, cobblestone, ironOre, coal, food, torches },
    tools: { hasWoodenPickaxe, hasStonePickaxe, hasIronPickaxe, hasAxe, hasShovel },
    surroundings: {
      isUnderground,
      isDeepUnderground,
      inWater,
      inLava,
      nearMobs,
      lightLevel,
      blocksAhead,
      canSeeSky
    }
  };
}
