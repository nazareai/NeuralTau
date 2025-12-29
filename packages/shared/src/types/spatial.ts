/**
 * Spatial Observation Types
 *
 * Based on GITM research: structured 3D representation for embodied AI agents
 * More efficient and precise than vision-based approaches
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Block {
  name: string;
  position: Vec3;
  distance?: number;
}

/**
 * 3x3x3 spatial grid around the bot
 * Helps with obstacle avoidance and pathfinding
 */
export interface SpatialGrid {
  // Y+1 layer (above bot's head)
  above: {
    nw: Block | null; n: Block | null; ne: Block | null;
    w: Block | null;  center: Block | null; e: Block | null;
    sw: Block | null; s: Block | null; se: Block | null;
  };

  // Y layer (bot's current level)
  current: {
    nw: Block | null; n: Block | null; ne: Block | null;
    w: Block | null;  center: Block | null; e: Block | null;
    sw: Block | null; s: Block | null; se: Block | null;
  };

  // Y-1 layer (below bot's feet)
  below: {
    nw: Block | null; n: Block | null; ne: Block | null;
    w: Block | null;  center: Block | null; e: Block | null;
    sw: Block | null; s: Block | null; se: Block | null;
  };
}

/**
 * Directional ray-casts for path awareness
 */
export interface DirectionalScan {
  front: Block[];   // Next 5 blocks ahead
  back: Block[];
  left: Block[];
  right: Block[];
  up: Block[];      // Next 5 blocks above
  down: Block[];
}

/**
 * High-level semantic understanding
 */
export interface SemanticFeatures {
  // Nearest resources
  nearestTree?: { position: Vec3; distance: number; type: string };
  nearestOre?: { position: Vec3; distance: number; type: string };
  nearestMob?: { position: Vec3; distance: number; type: string; hostile: boolean };

  // Environment assessment
  isUnderground: boolean;        // Y < 60
  canSeeSky: boolean;            // At surface
  inCave: boolean;               // Surrounded by stone
  inWater: boolean;              // Swimming

  // Escape analysis (when underground)
  escapePath?: {
    direction: 'up' | 'north' | 'south' | 'east' | 'west';
    blocksToSurface: number;
    pathClear: boolean;
    obstacles: string[];         // What's blocking the way
  };

  // Immediate threats
  threats: Array<{
    type: string;
    distance: number;
    position: Vec3;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;

  // Light-based exit detection (when underground/in cave)
  brightestDirection?: {
    direction: string;       // e.g., 'north', 'southeast'
    lightLevel: number;      // 0-15, 15 = full daylight
    distance: number;        // blocks away
    position: Vec3;          // exact position of bright spot
  };
}

/**
 * Complete spatial observation
 * This is what the AI receives for decision-making
 */
export interface SpatialObservation {
  grid: SpatialGrid;
  scan: DirectionalScan;
  semantic: SemanticFeatures;
  timestamp: number;
}
