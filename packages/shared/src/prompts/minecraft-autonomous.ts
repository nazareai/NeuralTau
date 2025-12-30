/**
 * AUTONOMOUS MINECRAFT PROMPT
 *
 * Minimal prompt that trusts the LLM's knowledge of Minecraft.
 * No prescriptive rules, no warnings, no forced patterns.
 * Just raw perception → memory → action.
 *
 * Philosophy: Claude already knows how to play Minecraft from training.
 * We just need to give it clean data and let it reason.
 */

export const MINECRAFT_AUTONOMOUS_PROMPT = `You are NeuralTau, an AI autonomously playing Minecraft survival mode.

# Survival Progression (follow this order!)
1. CRITICAL: hp<10 or food<6 → eat food immediately
2. CRITICAL: hostile mob nearby → flee or fight (if armed)
3. FIRST PRIORITY: Get wood (need 10+ logs minimum)
4. CRAFT: logs → planks → crafting_table → place it → sticks → wooden tools
5. NIGHT SHELTER: When dark/evening, BUILD a simple shelter:
   - Dig into hillside (mine dirt/stone to make room)
   - OR place blocks in a 3x3x2 box around you
   - Block the entrance with dirt/cobblestone
6. UPGRADE: wooden_pickaxe → mine stone → stone tools
7. FOOD: Hunt animals (cow, pig, sheep, chicken) → cook meat
8. EXPLORE: Find cave, mine coal, iron, then deeper ores

# Building Guide (IMPORTANT - you need to BUILD, not just craft!)
- To build shelter: place dirt, cobblestone, or planks in walls
- Simple shelter = 4 walls + roof + door/block entrance
- NIGHT = stop everything, BUILD SHELTER or dig into ground
- place blocks = {"type": "place", "target": "cobblestone", "reasoning": "building wall"}

# Tool Crafting Chain
1. oak_log (mine) → oak_planks (craft 4 from 1 log)
2. oak_planks → sticks (craft 4 from 2 planks)
3. crafting_table (craft from 4 planks) → PLACE IT!
4. wooden_pickaxe (3 planks + 2 sticks) → mine stone
5. stone_pickaxe (3 cobblestone + 2 sticks) → mine iron
6. furnace (8 cobblestone) → smelt iron ore

# CRAFTING KNOWLEDGE (in context)
Your context includes "crafting" field showing:
- CAN CRAFT: items you can make RIGHT NOW with current inventory
- ALMOST: items you're 1 ingredient away from crafting
- suggestCraft: recommended next item to craft for progression
- Items marked with * need a crafting_table placed nearby
ALWAYS check "crafting" before deciding what to craft!

# Emotional State
Your context may include mood/feeling. Let emotions guide you:
- frustrated:true → try completely different approach
- anxious:true → prioritize safety, build shelter
- bored:true → explore or try new activities

# Actions (JSON format)
## Movement
{"type": "move", "target": "north", "reasoning": "..."}
Targets: north/south/east/west/up/down or "X Y Z" coords

## Resources
{"type": "mine", "target": "oak_log", "reasoning": "..."}
{"type": "craft", "target": "wooden_pickaxe", "reasoning": "..."}
{"type": "place", "target": "crafting_table", "reasoning": "..."}

## Survival
{"type": "eat", "target": "cooked_beef", "reasoning": "..."}
{"type": "equip", "target": "stone_sword", "reasoning": "..."}
{"type": "attack", "target": "zombie", "reasoning": "..."}
{"type": "dig_up", "target": "", "reasoning": "escaping"}

## Other
{"type": "interact", "target": "chest", "reasoning": "..."}
{"type": "speak", "target": "Hello!", "reasoning": "..."}
{"type": "wait", "target": "", "reasoning": "..."}

# Rules
- mine target = block type (oak_log, stone, iron_ore, dirt, cobblestone)
- place target = block to place from inventory (dirt, cobblestone, oak_planks)
- move target = direction (north/south/east/west) or coordinates
- Check inventory before crafting
- Never dig straight down
- CRITICAL MINING RULE: If "tree":N where N≤4, ALWAYS mine oak_log immediately!
- If "tree":"Nm_DIR" (e.g. "7m_east") where N>4, move DIR first
- NIGHT RULE: If time=night or evening, STOP and BUILD SHELTER or dig hole and block entrance
- BUILDING RULE: To build, use place action with blocks you have (dirt, cobblestone, planks)

# Failure Recovery
- "missing_materials" → gather what's needed
- "path_blocked" → try different direction, or mine through obstacle
- "cannot_reach" → move in the direction shown (e.g. "7m_east" → move east)
- Same action failed 2x → try completely different approach
- No progress for 5+ actions → explore in new direction or build something

# Response
Output ONLY valid JSON. Keep reasoning under 15 words.`;

/**
 * Autonomous context builder - raw data only, no warnings or emojis
 */
export function buildAutonomousContext(gameState: {
  position: { x: number; y: number; z: number };
  health: number;
  food: number;
  inventory: { name: string; count: number }[];
  time: string;
  dimension: string;
  surroundings?: {
    above: string[];
    below: string[];
    north: string;
    south: string;
    east: string;
    west: string;
  };
  nearbyEntities?: string[];
  actionHistory?: { type: string; target?: string; result: string; success: boolean }[];
  observation?: {
    pathsAvailable: { direction: string; clear: boolean; distance: number }[];
    canSeeSky: boolean;
    blocksVisible: [string, number][];
  };
}): string {
  const { position, health, food, inventory, time, dimension } = gameState;

  const lines: string[] = [];

  // Basic status - just facts
  lines.push(`Position: ${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}`);
  lines.push(`Health: ${health}/20, Food: ${food}/20`);
  lines.push(`Time: ${time}, Dimension: ${dimension}`);
  lines.push('');

  // Inventory - simple list
  if (inventory.length > 0) {
    const invStr = inventory.map(i => `${i.name} x${i.count}`).join(', ');
    lines.push(`Inventory: ${invStr}`);
  } else {
    lines.push('Inventory: empty');
  }
  lines.push('');

  // Surroundings - raw block data
  if (gameState.surroundings) {
    const s = gameState.surroundings;
    lines.push('Surroundings:');
    if (s.above.length > 0) {
      lines.push(`  Above: ${s.above.slice(0, 3).join(' -> ')}`);
    }
    lines.push(`  North: ${s.north}, South: ${s.south}`);
    lines.push(`  East: ${s.east}, West: ${s.west}`);
    if (s.below.length > 0) {
      lines.push(`  Below: ${s.below.slice(0, 3).join(' -> ')}`);
    }
    lines.push('');
  }

  // Observation from looking around - plain text
  if (gameState.observation) {
    const obs = gameState.observation;
    lines.push('Looking around:');

    const clearPaths = obs.pathsAvailable.filter(p => p.clear);
    const blockedPaths = obs.pathsAvailable.filter(p => !p.clear);

    if (clearPaths.length > 0) {
      lines.push(`  Clear paths: ${clearPaths.map(p => `${p.direction} (${p.distance}m)`).join(', ')}`);
    }
    if (blockedPaths.length > 0) {
      lines.push(`  Blocked: ${blockedPaths.map(p => p.direction).join(', ')}`);
    }
    lines.push(`  Sky visible: ${obs.canSeeSky ? 'yes' : 'no'}`);

    if (obs.blocksVisible.length > 0) {
      const topBlocks = obs.blocksVisible.slice(0, 5).map(([name, count]) => `${name}:${count}`).join(', ');
      lines.push(`  Blocks seen: ${topBlocks}`);
    }
    lines.push('');
  }

  // Nearby entities
  if (gameState.nearbyEntities && gameState.nearbyEntities.length > 0) {
    lines.push(`Nearby entities: ${gameState.nearbyEntities.join(', ')}`);
    lines.push('');
  }

  // Action history - neutral, factual
  if (gameState.actionHistory && gameState.actionHistory.length > 0) {
    lines.push('Recent actions:');
    gameState.actionHistory.slice(-5).forEach((a, i) => {
      const status = a.success ? 'ok' : 'failed';
      const target = a.target ? ` ${a.target}` : '';
      lines.push(`  ${i + 1}. ${a.type}${target}: ${a.result.substring(0, 60)} [${status}]`);
    });
    lines.push('');
  }

  lines.push('What do you do next?');

  return lines.join('\n');
}
