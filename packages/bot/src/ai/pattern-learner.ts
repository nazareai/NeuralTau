/**
 * PATTERN LEARNER - Unified Pattern Extraction
 *
 * Purpose: Single source of truth for learned behavioral patterns
 * Features:
 * - Bayesian confidence intervals (not just success rate)
 * - Temporal decay (old patterns lose influence)
 * - Unified extraction algorithm (replaces duplicate logic)
 * - Pattern lineage tracking
 *
 * This replaces:
 * - decision-logger.ts extractPatterns()
 * - experience-memory.ts extractPatternsFromStats()
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@tau/shared';
import { WarmStorageEntry } from './warm-storage';
import { CompactContext } from './hot-memory';

const logger = new Logger('PatternLearner');

/**
 * Trigger conditions for a pattern
 */
export interface PatternTrigger {
  hasItems?: string[];           // Items that should be in inventory
  nearBlocks?: string[];         // Blocks that should be nearby
  nearEntities?: string[];       // Entities that should be nearby
  healthRange?: [number, number]; // Health range [min, max]
  foodRange?: [number, number];   // Food range [min, max]
  timeOfDay?: 'day' | 'night' | 'dawn' | 'dusk';
  underground?: boolean;
}

/**
 * A learned behavioral pattern with statistics
 */
export interface LearnedPattern {
  id: string;                    // Unique identifier
  trigger: PatternTrigger;
  action: {
    type: string;
    target: string;
  };
  stats: {
    attempts: number;
    successes: number;
    avgDurationMs: number;
    firstSeen: number;           // Timestamp
    lastSeen: number;            // Timestamp
    lastSuccess: number | null;  // Timestamp of last success
  };
  confidence: number;            // Bayesian confidence (0-1)
  decayedScore: number;          // Time-weighted score
  reliability: 'high' | 'medium' | 'low' | 'uncertain';
}

/**
 * Configuration for pattern extraction
 */
interface PatternConfig {
  minAttempts: number;           // Minimum attempts to create pattern
  minConfidence: number;         // Minimum confidence to use pattern
  decayHalfLifeDays: number;     // Days until pattern influence halves
  maxPatterns: number;           // Maximum patterns to keep
}

const DEFAULT_CONFIG: PatternConfig = {
  minAttempts: 5,                // Need 5+ attempts (statistically meaningful)
  minConfidence: 0.3,            // 30% confidence minimum
  decayHalfLifeDays: 7,          // Pattern loses half influence in 7 days
  maxPatterns: 200,              // Keep top 200 patterns
};

/**
 * Pattern Learner - Unified pattern extraction and management
 */
export class PatternLearner {
  private patterns: Map<string, LearnedPattern> = new Map();
  private readonly patternsFile: string;
  private readonly config: PatternConfig;
  private lastExtraction: number = 0;

  constructor(options?: {
    dataDir?: string;
    config?: Partial<PatternConfig>;
  }) {
    const dataDir = options?.dataDir ?? path.join(process.cwd(), 'data', 'learning');
    this.patternsFile = path.join(dataDir, 'patterns.json');
    this.config = { ...DEFAULT_CONFIG, ...options?.config };

    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    logger.info('PatternLearner initialized', {
      patternsFile: this.patternsFile,
      config: this.config,
    });
  }

  /**
   * Initialize - load existing patterns
   */
  async initialize(): Promise<void> {
    await this.loadPatterns();
    this.applyTemporalDecay();

    logger.info('PatternLearner ready', {
      patternsLoaded: this.patterns.size,
    });
  }

  /**
   * Extract patterns from warm storage entries
   */
  extractPatterns(entries: WarmStorageEntry[]): number {
    if (entries.length === 0) return 0;

    // Group entries by action signature
    const actionGroups = new Map<string, WarmStorageEntry[]>();

    for (const entry of entries) {
      const key = this.getActionSignature(entry);
      if (!actionGroups.has(key)) {
        actionGroups.set(key, []);
      }
      actionGroups.get(key)!.push(entry);
    }

    let newPatterns = 0;
    let updatedPatterns = 0;

    // Process each action group
    for (const [signature, groupEntries] of actionGroups) {
      if (groupEntries.length < this.config.minAttempts) continue;

      const pattern = this.createOrUpdatePattern(signature, groupEntries);
      if (pattern) {
        const existing = this.patterns.has(signature);
        this.patterns.set(signature, pattern);
        if (existing) {
          updatedPatterns++;
        } else {
          newPatterns++;
        }
      }
    }

    // Apply decay and prune
    this.applyTemporalDecay();
    this.prunePatterns();

    // Save
    this.savePatterns();
    this.lastExtraction = Date.now();

    logger.info('Pattern extraction complete', {
      entriesProcessed: entries.length,
      newPatterns,
      updatedPatterns,
      totalPatterns: this.patterns.size,
    });

    return newPatterns + updatedPatterns;
  }

  /**
   * Create or update a pattern from entries
   */
  private createOrUpdatePattern(
    signature: string,
    entries: WarmStorageEntry[]
  ): LearnedPattern | null {
    const successes = entries.filter(e => e.res.ok);
    const failures = entries.filter(e => !e.res.ok);

    // Calculate statistics
    const attempts = entries.length;
    const successCount = successes.length;
    const avgDuration = entries.reduce((sum, e) => sum + e.res.ms, 0) / attempts;
    const firstSeen = Math.min(...entries.map(e => e.ts));
    const lastSeen = Math.max(...entries.map(e => e.ts));
    const lastSuccess = successes.length > 0
      ? Math.max(...successes.map(e => e.ts))
      : null;

    // Calculate Bayesian confidence using Wilson score interval
    const confidence = this.calculateBayesianConfidence(successCount, attempts);

    // Skip if confidence too low
    if (confidence < this.config.minConfidence) {
      return null;
    }

    // Extract trigger from most common context features
    const trigger = this.extractTrigger(entries);

    // Parse action from signature
    const [actionType, actionTarget] = signature.split(':');

    // Calculate time-weighted score
    const decayedScore = this.calculateDecayedScore(confidence, lastSeen);

    // Determine reliability
    const reliability = this.classifyReliability(confidence, attempts);

    return {
      id: signature,
      trigger,
      action: {
        type: actionType,
        target: actionTarget || '',
      },
      stats: {
        attempts,
        successes: successCount,
        avgDurationMs: Math.round(avgDuration),
        firstSeen,
        lastSeen,
        lastSuccess,
      },
      confidence,
      decayedScore,
      reliability,
    };
  }

  /**
   * Calculate Bayesian confidence using Wilson score interval
   * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
   */
  private calculateBayesianConfidence(successes: number, attempts: number): number {
    if (attempts === 0) return 0;

    // Using 95% confidence (z = 1.96)
    const z = 1.96;
    const p = successes / attempts;
    const n = attempts;

    // Wilson score lower bound
    const denominator = 1 + z * z / n;
    const center = p + z * z / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);

    // Lower bound of confidence interval
    const lowerBound = (center - margin) / denominator;

    return Math.max(0, Math.min(1, lowerBound));
  }

  /**
   * Calculate time-weighted score (exponential decay)
   */
  private calculateDecayedScore(confidence: number, lastSeen: number): number {
    const ageMs = Date.now() - lastSeen;
    const halfLifeMs = this.config.decayHalfLifeDays * 24 * 60 * 60 * 1000;
    const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
    return confidence * decayFactor;
  }

  /**
   * Classify reliability based on confidence and sample size
   */
  private classifyReliability(
    confidence: number,
    attempts: number
  ): 'high' | 'medium' | 'low' | 'uncertain' {
    if (attempts < 5) return 'uncertain';
    if (confidence >= 0.7 && attempts >= 10) return 'high';
    if (confidence >= 0.5 && attempts >= 7) return 'medium';
    if (confidence >= 0.3) return 'low';
    return 'uncertain';
  }

  /**
   * Extract trigger conditions from entries
   */
  private extractTrigger(entries: WarmStorageEntry[]): PatternTrigger {
    const trigger: PatternTrigger = {};

    // Count item occurrences
    const itemCounts = new Map<string, number>();
    const blockCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();
    const timeCounts = new Map<string, number>();
    let undergroundCount = 0;
    const healthValues: number[] = [];
    const foodValues: number[] = [];

    for (const entry of entries) {
      const ctx = entry.ctx;

      // Items
      for (const item of ctx.inv) {
        itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
      }

      // Blocks
      for (const block of ctx.blk) {
        blockCounts.set(block, (blockCounts.get(block) || 0) + 1);
      }

      // Entities
      for (const entity of ctx.ent) {
        entityCounts.set(entity, (entityCounts.get(entity) || 0) + 1);
      }

      // Time
      timeCounts.set(ctx.time, (timeCounts.get(ctx.time) || 0) + 1);

      // Underground
      if (ctx.underground) undergroundCount++;

      // Health/Food
      healthValues.push(ctx.hp);
      foodValues.push(ctx.fd);
    }

    const threshold = entries.length * 0.6; // Must appear in 60% of entries

    // Extract common items (top 3 that appear in >60% of entries)
    const commonItems = [...itemCounts.entries()]
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([item, _]) => item);
    if (commonItems.length > 0) trigger.hasItems = commonItems;

    // Extract common blocks (top 3)
    const commonBlocks = [...blockCounts.entries()]
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([block, _]) => block);
    if (commonBlocks.length > 0) trigger.nearBlocks = commonBlocks;

    // Extract common entities
    const commonEntities = [...entityCounts.entries()]
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([entity, _]) => entity);
    if (commonEntities.length > 0) trigger.nearEntities = commonEntities;

    // Extract dominant time
    const dominantTime = [...timeCounts.entries()]
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])[0];
    if (dominantTime) trigger.timeOfDay = dominantTime[0] as any;

    // Underground
    if (undergroundCount >= threshold) trigger.underground = true;

    // Health range (if consistently low or high)
    const avgHealth = healthValues.reduce((a, b) => a + b, 0) / healthValues.length;
    if (avgHealth < 10) trigger.healthRange = [0, 10];
    else if (avgHealth > 15) trigger.healthRange = [15, 20];

    // Food range
    const avgFood = foodValues.reduce((a, b) => a + b, 0) / foodValues.length;
    if (avgFood < 10) trigger.foodRange = [0, 10];
    else if (avgFood > 15) trigger.foodRange = [15, 20];

    return trigger;
  }

  /**
   * Get action signature from entry
   */
  private getActionSignature(entry: WarmStorageEntry): string {
    return `${entry.act.type}:${entry.act.target || ''}`;
  }

  /**
   * Apply temporal decay to all patterns
   */
  applyTemporalDecay(): void {
    for (const [id, pattern] of this.patterns) {
      pattern.decayedScore = this.calculateDecayedScore(
        pattern.confidence,
        pattern.stats.lastSeen
      );
    }
  }

  /**
   * Prune patterns to keep only top N by decayed score
   */
  private prunePatterns(): void {
    if (this.patterns.size <= this.config.maxPatterns) return;

    const sorted = [...this.patterns.entries()]
      .sort((a, b) => b[1].decayedScore - a[1].decayedScore);

    const toKeep = sorted.slice(0, this.config.maxPatterns);
    const removed = this.patterns.size - toKeep.length;

    this.patterns = new Map(toKeep);

    logger.info('Pruned old patterns', {
      removed,
      remaining: this.patterns.size,
    });
  }

  /**
   * Get patterns relevant to current context
   */
  getRelevantPatterns(context: CompactContext, limit: number = 10): LearnedPattern[] {
    const matches: Array<{ pattern: LearnedPattern; matchScore: number }> = [];

    for (const pattern of this.patterns.values()) {
      const matchScore = this.calculateTriggerMatch(pattern.trigger, context);
      if (matchScore > 0) {
        matches.push({ pattern, matchScore });
      }
    }

    // Sort by combined score (match quality × decayed confidence)
    return matches
      .sort((a, b) => (b.matchScore * b.pattern.decayedScore) - (a.matchScore * a.pattern.decayedScore))
      .slice(0, limit)
      .map(m => m.pattern);
  }

  /**
   * Calculate how well a trigger matches context
   */
  private calculateTriggerMatch(trigger: PatternTrigger, context: CompactContext): number {
    let matches = 0;
    let checks = 0;

    // Items
    if (trigger.hasItems && trigger.hasItems.length > 0) {
      checks++;
      const hasAll = trigger.hasItems.every(item =>
        context.inv.some(i => i.includes(item))
      );
      if (hasAll) matches++;
    }

    // Blocks
    if (trigger.nearBlocks && trigger.nearBlocks.length > 0) {
      checks++;
      const hasNearby = trigger.nearBlocks.some(block =>
        context.blk.some(b => b.includes(block))
      );
      if (hasNearby) matches++;
    }

    // Entities
    if (trigger.nearEntities && trigger.nearEntities.length > 0) {
      checks++;
      const hasNearby = trigger.nearEntities.some(entity =>
        context.ent.some(e => e.includes(entity))
      );
      if (hasNearby) matches++;
    }

    // Time
    if (trigger.timeOfDay) {
      checks++;
      if (context.time === trigger.timeOfDay) matches++;
    }

    // Underground
    if (trigger.underground !== undefined) {
      checks++;
      if (context.underground === trigger.underground) matches++;
    }

    // Health range
    if (trigger.healthRange) {
      checks++;
      if (context.hp >= trigger.healthRange[0] && context.hp <= trigger.healthRange[1]) {
        matches++;
      }
    }

    // Food range
    if (trigger.foodRange) {
      checks++;
      if (context.fd >= trigger.foodRange[0] && context.fd <= trigger.foodRange[1]) {
        matches++;
      }
    }

    return checks > 0 ? matches / checks : 0;
  }

  /**
   * Get top patterns by decayed score
   */
  getTopPatterns(limit: number = 20): LearnedPattern[] {
    return [...this.patterns.values()]
      .sort((a, b) => b.decayedScore - a.decayedScore)
      .slice(0, limit);
  }

  /**
   * Get high confidence patterns only
   */
  getHighConfidencePatterns(minConfidence: number = 0.6): LearnedPattern[] {
    return [...this.patterns.values()]
      .filter(p => p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get pattern by ID
   */
  getPattern(id: string): LearnedPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Build context string for AI prompt
   */
  buildContextForAI(context: CompactContext): string {
    const relevant = this.getRelevantPatterns(context, 5);
    if (relevant.length === 0) return '';

    const lines: string[] = ['LEARNED PATTERNS (from past sessions):'];

    for (const pattern of relevant) {
      const successRate = Math.round(
        (pattern.stats.successes / pattern.stats.attempts) * 100
      );
      const age = Math.round((Date.now() - pattern.stats.lastSeen) / (1000 * 60 * 60));
      const ageStr = age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;

      lines.push(
        `  ${pattern.reliability === 'high' ? '✓' : pattern.reliability === 'medium' ? '○' : '?'} ` +
        `"${pattern.action.type} ${pattern.action.target}": ` +
        `${successRate}% success (${pattern.stats.attempts} tries, ${ageStr})`
      );
    }

    return lines.join('\n');
  }

  /**
   * Load patterns from file
   */
  private async loadPatterns(): Promise<void> {
    try {
      if (!fs.existsSync(this.patternsFile)) {
        logger.debug('No patterns file found, starting fresh');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.patternsFile, 'utf-8'));

      // Handle both old format (array) and new format (object with patterns array)
      const patternsArray: LearnedPattern[] = Array.isArray(data) ? data : (data.patterns || []);

      for (const pattern of patternsArray) {
        // Migrate old format if needed
        if (!pattern.id && pattern.action) {
          pattern.id = `${pattern.action.type}:${pattern.action.target || ''}`;
        }
        if (pattern.id) {
          this.patterns.set(pattern.id, pattern);
        }
      }

      logger.info('Loaded patterns', { count: this.patterns.size });
    } catch (err) {
      logger.error('Failed to load patterns', { error: err });
    }
  }

  /**
   * Save patterns to file
   */
  savePatterns(): void {
    try {
      const data = {
        version: 2,
        lastUpdated: new Date().toISOString(),
        config: this.config,
        patterns: [...this.patterns.values()],
      };

      fs.writeFileSync(this.patternsFile, JSON.stringify(data, null, 2));
      logger.debug('Patterns saved', { count: this.patterns.size });
    } catch (err) {
      logger.error('Failed to save patterns', { error: err });
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    uncertain: number;
    lastExtraction: number | null;
  } {
    const patterns = [...this.patterns.values()];
    return {
      totalPatterns: patterns.length,
      highConfidence: patterns.filter(p => p.reliability === 'high').length,
      mediumConfidence: patterns.filter(p => p.reliability === 'medium').length,
      lowConfidence: patterns.filter(p => p.reliability === 'low').length,
      uncertain: patterns.filter(p => p.reliability === 'uncertain').length,
      lastExtraction: this.lastExtraction || null,
    };
  }

  /**
   * Clear all patterns (for testing)
   */
  clear(): void {
    this.patterns.clear();
    this.savePatterns();
    logger.info('Patterns cleared');
  }
}

// Singleton instance
let patternLearnerInstance: PatternLearner | null = null;

export function getPatternLearner(): PatternLearner {
  if (!patternLearnerInstance) {
    patternLearnerInstance = new PatternLearner();
  }
  return patternLearnerInstance;
}

export function initializePatternLearner(options?: {
  dataDir?: string;
  config?: Partial<PatternConfig>;
}): PatternLearner {
  patternLearnerInstance = new PatternLearner(options);
  return patternLearnerInstance;
}
