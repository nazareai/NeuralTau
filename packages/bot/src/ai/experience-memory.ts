/**
 * Experience Memory System
 *
 * This module provides cross-session learning capabilities for the AI bot.
 * It loads historical decision patterns and enables experience-based decision making.
 *
 * ## Architecture
 *
 * The system has two main components:
 *
 * ### 1. Pattern Learning (Option 1)
 * - Loads all historical decision logs from ~/.tau/decision-logs/
 * - Aggregates patterns across ALL sessions (not just today)
 * - Extracts high-success-rate action patterns
 * - Provides top patterns to LLM context at decision time
 *
 * ### 2. Experience Retrieval (Option 2)
 * - Creates feature vectors for each past experience
 * - When making decisions, finds similar past situations
 * - Returns relevant experiences with outcomes
 * - Helps LLM learn from similar past scenarios
 *
 * ## Usage
 *
 * ```typescript
 * import { experienceMemory } from './experience-memory';
 *
 * // At startup - loads all historical data
 * await experienceMemory.initialize();
 *
 * // When building context for LLM
 * const patterns = experienceMemory.getTopPatterns(5);
 * const similar = experienceMemory.findSimilarExperiences(currentContext, 3);
 *
 * // Include in LLM prompt
 * const memoryContext = experienceMemory.buildMemoryContext(currentContext);
 * ```
 *
 * ## Storage
 *
 * All data is stored in packages/bot/data/decision-logs/:
 * - decisions-YYYY-MM-DD.json - Daily decision logs
 * - patterns.json - Extracted patterns (updated on shutdown)
 * - experience-index.json - Aggregated experience data
 *
 * ## Map Independence
 *
 * This system is map-agnostic - it learns "how to play" not "where things are".
 * Patterns like "mine wood when near trees" work on any map.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@tau/shared';
import { DecisionLogEntry, ActionPattern } from './decision-logger.js';

const logger = new Logger('ExperienceMemory');

/**
 * Aggregated experience statistics for an action type
 */
interface ActionStats {
  actionType: string;
  target: string;
  totalAttempts: number;
  successCount: number;
  successRate: number;
  avgHealthWhenUsed: number;
  avgFoodWhenUsed: number;
  commonNearbyBlocks: string[];
  commonInventoryItems: string[];
  lastUsed: string;
}

/**
 * Feature vector for experience similarity matching
 */
interface ExperienceFeatures {
  healthBucket: number;      // 0-3 (critical, low, medium, full)
  foodBucket: number;        // 0-3 (starving, low, medium, full)
  hasWood: boolean;
  hasStone: boolean;
  hasIron: boolean;
  hasTool: boolean;
  hasWeapon: boolean;
  hasFood: boolean;
  nearTree: boolean;
  nearStone: boolean;
  nearWater: boolean;
  nearHostile: boolean;
  nearAnimal: boolean;
  isUnderground: boolean;
  timeOfDay: 'day' | 'night';
}

/**
 * Experience entry with features for retrieval
 */
interface IndexedExperience {
  features: ExperienceFeatures;
  action: { type: string; target: string };
  success: boolean;
  reasoning: string;
  timestamp: string;
}

/**
 * Experience Memory - Cross-session learning system
 */
export class ExperienceMemory {
  private logDir: string;
  private patterns: ActionPattern[] = [];
  private actionStats: Map<string, ActionStats> = new Map();
  private experienceIndex: IndexedExperience[] = [];
  private initialized: boolean = false;
  private totalExperiencesLoaded: number = 0;

  constructor() {
    // Store in project folder: packages/bot/data/decision-logs/
    this.logDir = path.join(process.cwd(), 'data', 'decision-logs');
  }

  /**
   * Initialize the memory system - load all historical data
   * Call this at bot startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing experience memory...');
    const startTime = Date.now();

    // Ensure directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      logger.info('Created decision logs directory');
      this.initialized = true;
      return;
    }

    // Load all historical decision logs
    await this.loadAllDecisionLogs();

    // Load or extract patterns
    this.loadOrExtractPatterns();

    // Build experience index for similarity search
    this.buildExperienceIndex();

    this.initialized = true;
    const elapsed = Date.now() - startTime;

    logger.info('Experience memory initialized', {
      totalExperiences: this.totalExperiencesLoaded,
      patterns: this.patterns.length,
      actionTypes: this.actionStats.size,
      indexedExperiences: this.experienceIndex.length,
      loadTimeMs: elapsed,
    });
  }

  /**
   * Load all decision log files (not just today's)
   */
  private async loadAllDecisionLogs(): Promise<void> {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('decisions-') && f.endsWith('.json'))
        .sort(); // Sort by date (oldest first)

      let totalEntries = 0;
      const allEntries: DecisionLogEntry[] = [];

      for (const file of files) {
        try {
          const filePath = path.join(this.logDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const entries = data.entries || [];
          allEntries.push(...entries);
          totalEntries += entries.length;
        } catch (err) {
          logger.warn(`Failed to load ${file}`, { error: err });
        }
      }

      this.totalExperiencesLoaded = totalEntries;

      // Build action statistics from all entries
      this.buildActionStats(allEntries);

      logger.info(`Loaded ${totalEntries} experiences from ${files.length} log files`);
    } catch (err) {
      logger.error('Failed to load decision logs', { error: err });
    }
  }

  /**
   * Build aggregated statistics for each action type
   */
  private buildActionStats(entries: DecisionLogEntry[]): void {
    const statsMap = new Map<string, {
      total: number;
      success: number;
      healthSum: number;
      foodSum: number;
      nearbyBlocks: Map<string, number>;
      inventoryItems: Map<string, number>;
      lastUsed: string;
    }>();

    for (const entry of entries) {
      const key = `${entry.decision.type}:${entry.decision.target || 'none'}`;

      const existing = statsMap.get(key) || {
        total: 0,
        success: 0,
        healthSum: 0,
        foodSum: 0,
        nearbyBlocks: new Map(),
        inventoryItems: new Map(),
        lastUsed: entry.timestamp,
      };

      existing.total++;
      if (entry.result.success) existing.success++;
      existing.healthSum += entry.context.health;
      existing.foodSum += entry.context.food;
      existing.lastUsed = entry.timestamp;

      // Track nearby blocks
      for (const block of entry.context.nearbyBlocks || []) {
        existing.nearbyBlocks.set(block, (existing.nearbyBlocks.get(block) || 0) + 1);
      }

      // Track inventory items
      for (const item of entry.context.inventory || []) {
        existing.inventoryItems.set(item, (existing.inventoryItems.get(item) || 0) + 1);
      }

      statsMap.set(key, existing);
    }

    // Convert to ActionStats
    for (const [key, data] of statsMap) {
      const [actionType, target] = key.split(':');

      // Get top 3 common blocks and items
      const topBlocks = [...data.nearbyBlocks.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([block]) => block);

      const topItems = [...data.inventoryItems.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([item]) => item);

      this.actionStats.set(key, {
        actionType,
        target,
        totalAttempts: data.total,
        successCount: data.success,
        successRate: data.total > 0 ? data.success / data.total : 0,
        avgHealthWhenUsed: data.total > 0 ? data.healthSum / data.total : 20,
        avgFoodWhenUsed: data.total > 0 ? data.foodSum / data.total : 20,
        commonNearbyBlocks: topBlocks,
        commonInventoryItems: topItems,
        lastUsed: data.lastUsed,
      });
    }
  }

  /**
   * Load existing patterns or extract from logs
   */
  private loadOrExtractPatterns(): void {
    const patternsFile = path.join(this.logDir, 'patterns.json');

    try {
      if (fs.existsSync(patternsFile)) {
        this.patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
        logger.info(`Loaded ${this.patterns.length} existing patterns`);
      }
    } catch (err) {
      logger.warn('Failed to load patterns, will extract from stats');
    }

    // If no patterns or few patterns, extract from action stats
    if (this.patterns.length < 5 && this.actionStats.size > 0) {
      this.extractPatternsFromStats();
    }
  }

  /**
   * Extract patterns from aggregated action statistics
   */
  private extractPatternsFromStats(): void {
    this.patterns = [];

    for (const [, stats] of this.actionStats) {
      // Only include patterns with decent sample size and success rate
      if (stats.totalAttempts >= 3 && stats.successRate >= 0.4) {
        this.patterns.push({
          trigger: {
            hasItems: stats.commonInventoryItems.length > 0 ? stats.commonInventoryItems : undefined,
            nearBlocks: stats.commonNearbyBlocks.length > 0 ? stats.commonNearbyBlocks : undefined,
            lowHealth: stats.avgHealthWhenUsed < 10,
            lowFood: stats.avgFoodWhenUsed < 10,
          },
          action: {
            type: stats.actionType,
            target: stats.target,
          },
          successRate: stats.successRate,
          occurrences: stats.totalAttempts,
        });
      }
    }

    // Sort by success rate * occurrences (confidence score)
    this.patterns.sort((a, b) =>
      (b.successRate * b.occurrences) - (a.successRate * a.occurrences)
    );

    logger.info(`Extracted ${this.patterns.length} patterns from action stats`);
    this.savePatterns();
  }

  /**
   * Build experience index for similarity search
   */
  private buildExperienceIndex(): void {
    // Load recent experiences for indexing (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const files = fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('decisions-') && f.endsWith('.json'))
      .filter(f => {
        const dateStr = f.replace('decisions-', '').replace('.json', '');
        return new Date(dateStr) >= sevenDaysAgo;
      });

    this.experienceIndex = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.logDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        for (const entry of (data.entries || []) as DecisionLogEntry[]) {
          const features = this.extractFeatures(entry.context);
          this.experienceIndex.push({
            features,
            action: {
              type: entry.decision.type,
              target: entry.decision.target,
            },
            success: entry.result.success,
            reasoning: entry.decision.reasoning,
            timestamp: entry.timestamp,
          });
        }
      } catch (err) {
        // Skip corrupted files
      }
    }

    // Keep only last 500 experiences for memory efficiency
    if (this.experienceIndex.length > 500) {
      this.experienceIndex = this.experienceIndex.slice(-500);
    }
  }

  /**
   * Extract feature vector from context
   */
  private extractFeatures(context: DecisionLogEntry['context']): ExperienceFeatures {
    const inventory = context.inventory || [];
    const nearbyBlocks = context.nearbyBlocks || [];
    const nearbyEntities = context.nearbyEntities || [];

    return {
      healthBucket: this.getBucket(context.health, [5, 10, 15]),
      foodBucket: this.getBucket(context.food, [5, 10, 15]),
      hasWood: inventory.some(i => i.includes('log') || i.includes('planks')),
      hasStone: inventory.some(i => i.includes('cobblestone') || i.includes('stone')),
      hasIron: inventory.some(i => i.includes('iron')),
      hasTool: inventory.some(i => i.includes('pickaxe') || i.includes('axe') || i.includes('shovel')),
      hasWeapon: inventory.some(i => i.includes('sword') || i.includes('bow')),
      hasFood: inventory.some(i =>
        i.includes('beef') || i.includes('pork') || i.includes('chicken') ||
        i.includes('bread') || i.includes('apple') || i.includes('carrot')
      ),
      nearTree: nearbyBlocks.some(b => b.includes('log') || b.includes('leaves')),
      nearStone: nearbyBlocks.some(b => b.includes('stone') || b.includes('granite') || b.includes('diorite')),
      nearWater: nearbyBlocks.some(b => b.includes('water')),
      nearHostile: nearbyEntities.some(e =>
        e.includes('zombie') || e.includes('skeleton') || e.includes('spider') || e.includes('creeper')
      ),
      nearAnimal: nearbyEntities.some(e =>
        e.includes('cow') || e.includes('pig') || e.includes('sheep') || e.includes('chicken')
      ),
      isUnderground: (context.position?.y || 64) < 50,
      timeOfDay: (context.time === 'night' ? 'night' : 'day') as 'day' | 'night',
    };
  }

  /**
   * Get bucket index for a value
   */
  private getBucket(value: number, thresholds: number[]): number {
    for (let i = 0; i < thresholds.length; i++) {
      if (value <= thresholds[i]) return i;
    }
    return thresholds.length;
  }

  /**
   * Calculate similarity between two feature vectors (0-1)
   */
  private calculateSimilarity(a: ExperienceFeatures, b: ExperienceFeatures): number {
    let matches = 0;
    let total = 0;

    // Numeric buckets (weighted more heavily)
    if (a.healthBucket === b.healthBucket) matches += 2;
    if (a.foodBucket === b.foodBucket) matches += 2;
    total += 4;

    // Boolean features
    const booleanFeatures: (keyof ExperienceFeatures)[] = [
      'hasWood', 'hasStone', 'hasIron', 'hasTool', 'hasWeapon', 'hasFood',
      'nearTree', 'nearStone', 'nearWater', 'nearHostile', 'nearAnimal', 'isUnderground'
    ];

    for (const feature of booleanFeatures) {
      if (a[feature] === b[feature]) matches++;
      total++;
    }

    // Time of day
    if (a.timeOfDay === b.timeOfDay) matches++;
    total++;

    return matches / total;
  }

  /**
   * Find similar past experiences to the current context
   */
  findSimilarExperiences(
    context: DecisionLogEntry['context'],
    limit: number = 3
  ): Array<{ experience: IndexedExperience; similarity: number }> {
    if (!this.initialized || this.experienceIndex.length === 0) {
      return [];
    }

    const currentFeatures = this.extractFeatures(context);

    // Calculate similarity for all indexed experiences
    const scored = this.experienceIndex.map(exp => ({
      experience: exp,
      similarity: this.calculateSimilarity(currentFeatures, exp.features),
    }));

    // Sort by similarity and return top matches
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .filter(s => s.similarity >= 0.5); // Only return if at least 50% similar
  }

  /**
   * Get top learned patterns (sorted by confidence)
   */
  getTopPatterns(limit: number = 5): ActionPattern[] {
    return this.patterns.slice(0, limit);
  }

  /**
   * Get action statistics for a specific action type
   */
  getActionStats(actionType: string, target?: string): ActionStats | undefined {
    const key = `${actionType}:${target || 'none'}`;
    return this.actionStats.get(key);
  }

  /**
   * Get all action statistics sorted by success rate
   */
  getAllActionStats(): ActionStats[] {
    return [...this.actionStats.values()]
      .filter(s => s.totalAttempts >= 3)
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Build memory context string for LLM prompt
   * This is the main method to include in decision-making
   */
  buildMemoryContext(context: DecisionLogEntry['context']): string {
    if (!this.initialized) {
      return '';
    }

    const lines: string[] = [];

    // 1. Top learned patterns
    const topPatterns = this.getTopPatterns(5);
    if (topPatterns.length > 0) {
      lines.push('LEARNED PATTERNS (from past sessions):');
      for (const pattern of topPatterns) {
        const successPct = Math.round(pattern.successRate * 100);
        lines.push(`- "${pattern.action.type} ${pattern.action.target}": ${successPct}% success (${pattern.occurrences} tries)`);
      }
      lines.push('');
    }

    // 2. Similar past experiences
    const similar = this.findSimilarExperiences(context, 3);
    if (similar.length > 0) {
      lines.push('SIMILAR PAST SITUATIONS:');
      for (const { experience, similarity } of similar) {
        const simPct = Math.round(similarity * 100);
        const outcome = experience.success ? 'SUCCESS' : 'FAILED';
        lines.push(`- [${simPct}% similar] Did "${experience.action.type} ${experience.action.target}" -> ${outcome}`);
        if (experience.reasoning) {
          lines.push(`  Reasoning: ${experience.reasoning.slice(0, 80)}...`);
        }
      }
      lines.push('');
    }

    // 3. Action success rates for common actions
    const relevantStats = this.getRelevantActionStats(context);
    if (relevantStats.length > 0) {
      lines.push('ACTION SUCCESS RATES:');
      for (const stat of relevantStats.slice(0, 5)) {
        const successPct = Math.round(stat.successRate * 100);
        lines.push(`- ${stat.actionType} ${stat.target}: ${successPct}% (${stat.totalAttempts} tries)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get action stats relevant to current context
   */
  private getRelevantActionStats(context: DecisionLogEntry['context']): ActionStats[] {
    const nearbyBlocks = context.nearbyBlocks || [];
    const inventory = context.inventory || [];

    return [...this.actionStats.values()]
      .filter(stat => {
        // Include if:
        // 1. Has enough attempts
        if (stat.totalAttempts < 3) return false;

        // 2. Related to nearby blocks
        const relatedToNearby = stat.commonNearbyBlocks.some(b =>
          nearbyBlocks.some(nb => nb.includes(b) || b.includes(nb))
        );

        // 3. Related to inventory
        const relatedToInventory = stat.commonInventoryItems.some(i =>
          inventory.some(inv => inv.includes(i) || i.includes(inv))
        );

        // 4. Basic survival actions always relevant
        const basicAction = ['eat', 'move', 'look', 'wait'].includes(stat.actionType);

        return relatedToNearby || relatedToInventory || basicAction;
      })
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Save patterns to file
   */
  private savePatterns(): void {
    try {
      const patternsFile = path.join(this.logDir, 'patterns.json');
      fs.writeFileSync(patternsFile, JSON.stringify(this.patterns, null, 2));
    } catch (err) {
      logger.error('Failed to save patterns', { error: err });
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    initialized: boolean;
    totalExperiences: number;
    patterns: number;
    actionTypes: number;
    indexedExperiences: number;
  } {
    return {
      initialized: this.initialized,
      totalExperiences: this.totalExperiencesLoaded,
      patterns: this.patterns.length,
      actionTypes: this.actionStats.size,
      indexedExperiences: this.experienceIndex.length,
    };
  }

  /**
   * Force refresh of all data
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.patterns = [];
    this.actionStats.clear();
    this.experienceIndex = [];
    await this.initialize();
  }
}

// Singleton instance
export const experienceMemory = new ExperienceMemory();
