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

# Priority (follow in order)
1. CRITICAL: hp<10 or food<6 → eat food, flee danger
2. URGENT: night + no shelter → find/build shelter
3. URGENT: hostile mob nearby → flee or fight (if armed)
4. NORMAL: no tools → wood → craft tools (axe for wood, pickaxe for stone)
5. NORMAL: no food → hunt animals
6. PROGRESS: mine, explore, build

# Tool Types (IMPORTANT)
- wooden_axe → FASTER wood chopping (logs, planks)
- wooden_pickaxe → REQUIRED for stone, coal, ores
- Craft axe first if you need more wood, pickaxe if you need stone/ore

# Emotional State
Your context may include mood/feeling. Let emotions guide you:
- frustrated:true → try completely different approach
- anxious:true → prioritize safety over progress
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
- mine target = block type (oak_log, stone, iron_ore)
- move target = direction (north/south/east/west) or coordinates. NOT up/down for trees!
- Check inventory before crafting
- Never dig straight down
- CRITICAL MINING RULE: If "tree":N where N≤4, ALWAYS mine oak_log immediately! Don't move!
- If "tree":"Nm_DIR" (e.g. "7m_east") where N>4, move DIR first to get closer

# Failure Recovery
- "missing_materials" → gather what's needed
- "path_blocked" → try different direction
- "cannot_reach" → STOP mining! Move in the direction shown (e.g. "7m_east" → move east)
- Same action failed 2x → try completely different approach

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
