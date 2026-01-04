/**
 * LEARNING SYSTEM - Unified Interface for Three-Tier Learning Architecture
 *
 * This is the main entry point for all learning operations.
 * It orchestrates:
 * - Tier 1: Hot Memory (in-process, fast access)
 * - Tier 2: Warm Storage (JSONL session files)
 * - Tier 3: Cold Archive (compressed monthly archives)
 * - Pattern Learner (unified pattern extraction)
 *
 * Usage:
 *   const learningSystem = await initializeLearningSystem();
 *   learningSystem.recordAction(action, context, success, duration);
 *   const patterns = learningSystem.getRelevantPatterns(context);
 */

import { Logger } from '@tau/shared';
import { HotMemory, HotMemoryEntry, CompactContext, initializeHotMemory } from './hot-memory';
import { WarmStorage, WarmStorageEntry, initializeWarmStorage } from './warm-storage';
import { PatternLearner, LearnedPattern, initializePatternLearner } from './pattern-learner';
import { ArchiveManager, initializeArchiveManager } from './archive-manager';

const logger = new Logger('LearningSystem');

/**
 * Configuration for the learning system
 */
export interface LearningSystemConfig {
  hotMemory?: {
    maxEntries?: number;
    flushIntervalMs?: number;
  };
  warmStorage?: {
    maxEntriesPerFile?: number;
    retentionDays?: number;
  };
  patternLearner?: {
    minAttempts?: number;
    minConfidence?: number;
    decayHalfLifeDays?: number;
    maxPatterns?: number;
  };
  dataDir?: string;
}

/**
 * Learning System Statistics
 */
export interface LearningStats {
  hotMemory: {
    entries: number;
    maxEntries: number;
    sessionDurationMs: number;
  };
  warmStorage: {
    totalFiles: number;
    totalEntries: number;
    totalSizeBytes: number;
    retentionDays: number;
  };
  patterns: {
    totalPatterns: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    lastExtraction: number | null;
  };
  archive: {
    totalArchives: number;
    totalEntries: number;
    totalSizeBytes: number;
    oldestMonth: string | null;
    newestMonth: string | null;
  };
}

/**
 * Learning System - Unified interface for all learning operations
 */
export class LearningSystem {
  private hotMemory: HotMemory;
  private warmStorage: WarmStorage;
  private patternLearner: PatternLearner;
  private archiveManager: ArchiveManager;
  private initialized: boolean = false;
  private patternExtractionInterval: NodeJS.Timeout | null = null;

  constructor(config?: LearningSystemConfig) {
    const dataDir = config?.dataDir ?? 'data/learning';

    // Initialize all components
    this.hotMemory = initializeHotMemory({
      maxEntries: config?.hotMemory?.maxEntries ?? 50,
      flushIntervalMs: config?.hotMemory?.flushIntervalMs ?? 30000,
      dataDir: `${dataDir}/hot`,
    });

    this.warmStorage = initializeWarmStorage({
      maxEntriesPerFile: config?.warmStorage?.maxEntriesPerFile ?? 1000,
      retentionDays: config?.warmStorage?.retentionDays ?? 7,
      dataDir: `${dataDir}/sessions`,
    });

    this.patternLearner = initializePatternLearner({
      dataDir,
      config: config?.patternLearner,
    });

    this.archiveManager = initializeArchiveManager(this.warmStorage, {
      dataDir: `${dataDir}/archive`,
    });

    logger.info('LearningSystem created', { dataDir });
  }

  /**
   * Initialize the learning system
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('LearningSystem already initialized');
      return;
    }

    // Initialize all components
    await this.hotMemory.initialize();
    await this.warmStorage.initialize();
    await this.patternLearner.initialize();

    // Connect hot memory to warm storage
    this.hotMemory.setWarmStorageCallback((entries) => {
      this.warmStorage.appendEntries(entries).catch(err => {
        logger.error('Failed to append to warm storage', { error: err });
      });
    });

    // Set up periodic pattern extraction (every 5 minutes)
    this.patternExtractionInterval = setInterval(async () => {
      await this.extractPatterns();
    }, 5 * 60 * 1000);

    // Initial pattern extraction
    await this.extractPatterns();

    this.initialized = true;
    logger.info('LearningSystem initialized');
  }

  /**
   * Record an action with its result
   */
  recordAction(
    action: { type: string; target: string },
    context: CompactContext,
    success: boolean,
    durationMs: number,
    options?: {
      reason?: string;
      errorMsg?: string;
    }
  ): void {
    if (!this.initialized) {
      logger.warn('LearningSystem not initialized, skipping record');
      return;
    }

    this.hotMemory.record(action, context, success, durationMs, options);
  }

  /**
   * Build compact context from game state metadata
   */
  buildCompactContext(metadata: any): CompactContext {
    const pos = metadata.position || { x: 0, y: 64, z: 0 };
    const inventory = metadata.inventory || [];
    const nearbyBlocks = metadata.nearbyBlocks || metadata.blocks || [];
    const nearbyEntities = metadata.nearbyEntities || metadata.entities || [];

    // Determine time of day
    let time: 'day' | 'night' | 'dawn' | 'dusk' = 'day';
    if (metadata.time) {
      const timeStr = String(metadata.time).toLowerCase();
      if (timeStr.includes('night')) time = 'night';
      else if (timeStr.includes('dawn') || timeStr.includes('morning')) time = 'dawn';
      else if (timeStr.includes('dusk') || timeStr.includes('evening')) time = 'dusk';
    }

    return {
      pos: [Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)],
      hp: metadata.health ?? 20,
      fd: metadata.food ?? 20,
      inv: inventory.slice(0, 10).map((i: any) => typeof i === 'string' ? i : i.name),
      blk: this.extractBlockNames(nearbyBlocks).slice(0, 5),
      ent: this.extractEntityNames(nearbyEntities).slice(0, 5),
      time,
      underground: (pos.y ?? 64) < 50,
    };
  }

  /**
   * Extract block names from various formats
   */
  private extractBlockNames(blocks: any): string[] {
    if (!blocks) return [];
    if (Array.isArray(blocks)) {
      return blocks.map(b => typeof b === 'string' ? b : b.name || b.type || 'unknown');
    }
    // Handle object format { north: "stone", south: "air", ... }
    if (typeof blocks === 'object') {
      return Object.values(blocks).filter(v => v && v !== 'air') as string[];
    }
    return [];
  }

  /**
   * Extract entity names from various formats
   */
  private extractEntityNames(entities: any): string[] {
    if (!entities) return [];
    if (Array.isArray(entities)) {
      return entities.map(e => typeof e === 'string' ? e : e.name || e.type || 'unknown');
    }
    return [];
  }

  /**
   * Get patterns relevant to current context
   */
  getRelevantPatterns(context: CompactContext, limit: number = 10): LearnedPattern[] {
    return this.patternLearner.getRelevantPatterns(context, limit);
  }

  /**
   * Get top patterns by score
   */
  getTopPatterns(limit: number = 20): LearnedPattern[] {
    return this.patternLearner.getTopPatterns(limit);
  }

  /**
   * Get high confidence patterns
   */
  getHighConfidencePatterns(minConfidence: number = 0.6): LearnedPattern[] {
    return this.patternLearner.getHighConfidencePatterns(minConfidence);
  }

  /**
   * Build context string for AI prompt (combines hot memory and patterns)
   */
  buildContextForAI(context: CompactContext): string {
    const parts: string[] = [];

    // Hot memory context (recent actions)
    const hotContext = this.hotMemory.buildContextForAI();
    if (hotContext) parts.push(hotContext);

    // Pattern context (learned patterns)
    const patternContext = this.patternLearner.buildContextForAI(context);
    if (patternContext) parts.push(patternContext);

    return parts.join('\n\n');
  }

  /**
   * Get recent actions from hot memory
   */
  getRecentActions(limit: number = 10): HotMemoryEntry[] {
    return this.hotMemory.getRecent(limit);
  }

  /**
   * Get consecutive failure count
   */
  getConsecutiveFailureCount(): number {
    return this.hotMemory.getConsecutiveFailureCount();
  }

  /**
   * Get recently failed action types
   */
  getRecentlyFailedActionTypes(minFailures: number = 3): string[] {
    return this.hotMemory.getRecentlyFailedActionTypes(minFailures);
  }

  /**
   * Get most recent failing action type
   */
  getMostRecentFailingActionType(): string | null {
    return this.hotMemory.getMostRecentFailingActionType();
  }

  /**
   * Check if repeating failed action
   */
  isRepeatingFailedAction(): { isRepeating: boolean; actionType?: string; count?: number } {
    return this.hotMemory.isRepeatingFailedAction();
  }

  /**
   * Get stuck loop warning
   */
  getStuckLoopWarning(): string | null {
    return this.hotMemory.getStuckLoopWarning();
  }

  /**
   * Get action success rate from hot memory
   */
  getActionSuccessRate(actionType: string): number {
    return this.hotMemory.getActionSuccessRate(actionType);
  }

  /**
   * Extract patterns from warm storage
   */
  async extractPatterns(): Promise<number> {
    try {
      const entries = await this.warmStorage.loadRecentEntries(500, 7);
      if (entries.length === 0) return 0;

      return this.patternLearner.extractPatterns(entries);
    } catch (err) {
      logger.error('Pattern extraction failed', { error: err });
      return 0;
    }
  }

  /**
   * Create monthly archive
   */
  async createMonthlyArchive(): Promise<string | null> {
    return this.archiveManager.createMonthlyArchive();
  }

  /**
   * Export fine-tuning dataset
   */
  async exportFineTuningDataset(
    outputPath: string,
    options?: {
      onlySuccessful?: boolean;
      systemPrompt?: string;
      maxEntries?: number;
    }
  ): Promise<number> {
    // Export from warm storage (recent data)
    const warmCount = await this.warmStorage.exportForFineTuning(
      outputPath.replace('.jsonl', '-recent.jsonl'),
      options
    );

    // Export from archives (historical data)
    const archiveCount = await this.archiveManager.exportCombinedDataset(
      outputPath.replace('.jsonl', '-archive.jsonl'),
      options
    );

    logger.info('Fine-tuning dataset exported', {
      recentEntries: warmCount,
      archiveEntries: archiveCount,
      totalEntries: warmCount + archiveCount,
    });

    return warmCount + archiveCount;
  }

  /**
   * Get comprehensive statistics
   */
  async getStats(): Promise<LearningStats> {
    const hotStats = this.hotMemory.getStats();
    const warmStats = await this.warmStorage.getStats();
    const patternStats = this.patternLearner.getStats();
    const archiveStats = await this.archiveManager.getStats();

    return {
      hotMemory: {
        entries: hotStats.entries,
        maxEntries: hotStats.maxEntries,
        sessionDurationMs: hotStats.sessionDurationMs,
      },
      warmStorage: {
        totalFiles: warmStats.totalFiles,
        totalEntries: warmStats.totalEntries,
        totalSizeBytes: warmStats.totalSizeBytes,
        retentionDays: warmStats.retentionDays,
      },
      patterns: {
        totalPatterns: patternStats.totalPatterns,
        highConfidence: patternStats.highConfidence,
        mediumConfidence: patternStats.mediumConfidence,
        lowConfidence: patternStats.lowConfidence,
        lastExtraction: patternStats.lastExtraction,
      },
      archive: {
        totalArchives: archiveStats.totalArchives,
        totalEntries: archiveStats.totalEntries,
        totalSizeBytes: archiveStats.totalSizeBytes,
        oldestMonth: archiveStats.oldestMonth,
        newestMonth: archiveStats.newestMonth,
      },
    };
  }

  /**
   * Shutdown the learning system
   */
  async shutdown(): Promise<void> {
    if (this.patternExtractionInterval) {
      clearInterval(this.patternExtractionInterval);
      this.patternExtractionInterval = null;
    }

    // Final pattern extraction
    await this.extractPatterns();

    // Shutdown components
    await this.hotMemory.shutdown();
    await this.warmStorage.shutdown();
    this.patternLearner.savePatterns();

    // Create monthly archive if needed
    await this.archiveManager.createMonthlyArchive();

    this.initialized = false;
    logger.info('LearningSystem shutdown complete');
  }
}

// Singleton instance
let learningSystemInstance: LearningSystem | null = null;

export function getLearningSystem(): LearningSystem | null {
  return learningSystemInstance;
}

export async function initializeLearningSystem(
  config?: LearningSystemConfig
): Promise<LearningSystem> {
  if (learningSystemInstance) {
    logger.warn('LearningSystem already exists, returning existing instance');
    return learningSystemInstance;
  }

  learningSystemInstance = new LearningSystem(config);
  await learningSystemInstance.initialize();
  return learningSystemInstance;
}

export async function shutdownLearningSystem(): Promise<void> {
  if (learningSystemInstance) {
    await learningSystemInstance.shutdown();
    learningSystemInstance = null;
  }
}
