import * as fs from 'fs';
import * as path from 'path';
import { GameAction, Logger } from '@tau/shared';

const logger = new Logger('DecisionLogger');

/**
 * Logged decision entry for pattern learning
 */
export interface DecisionLogEntry {
  timestamp: string;
  // Context at decision time
  context: {
    position: { x: number; y: number; z: number };
    health: number;
    food: number;
    inventory: string[]; // Item names
    nearbyBlocks: string[];
    nearbyEntities: string[];
    time: string;
    recentActions: { type: string; target: string; success: boolean }[];
  };
  // The decision made
  decision: {
    type: string;
    target: string;
    reasoning: string;
  };
  // Outcome
  result: {
    success: boolean;
    message: string;
    inventoryChange?: string[]; // Items gained/lost
  };
}

/**
 * Pattern extracted from successful action sequences
 */
export interface ActionPattern {
  trigger: {
    hasItems?: string[];      // Required items in inventory
    nearBlocks?: string[];    // Blocks that should be nearby
    lowHealth?: boolean;      // Health below threshold
    lowFood?: boolean;        // Food below threshold
    timeOfDay?: string;       // day/night
  };
  action: {
    type: string;
    target: string;
  };
  successRate: number;
  occurrences: number;
}

/**
 * Decision Logger - saves autonomous decisions for pattern learning
 */
export class DecisionLogger {
  private logDir: string;
  private logFile: string;
  private entries: DecisionLogEntry[] = [];
  private patterns: ActionPattern[] = [];
  private saveInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Store in project folder: packages/bot/data/decision-logs/
    this.logDir = path.join(process.cwd(), 'data', 'decision-logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Create daily log file
    const date = new Date().toISOString().split('T')[0];
    this.logFile = path.join(this.logDir, `decisions-${date}.json`);

    // Load existing entries for today
    this.loadEntries();

    // Load extracted patterns
    this.loadPatterns();

    // Auto-save every 2 minutes
    this.saveInterval = setInterval(() => this.save(), 120000);

    logger.info(`Decision logger initialized`, { logFile: this.logFile });
  }

  /**
   * Log a decision with its context and result
   */
  logDecision(
    context: DecisionLogEntry['context'],
    decision: DecisionLogEntry['decision'],
    result: DecisionLogEntry['result']
  ): void {
    const entry: DecisionLogEntry = {
      timestamp: new Date().toISOString(),
      context,
      decision,
      result,
    };

    this.entries.push(entry);

    // Log successful patterns more prominently
    if (result.success) {
      logger.debug('[PATTERN] Successful action logged', {
        action: `${decision.type} ${decision.target}`,
        inventoryChange: result.inventoryChange,
      });
    }
  }

  /**
   * Get patterns that match current context (for manual mode)
   */
  getSuggestedAction(context: DecisionLogEntry['context']): ActionPattern | null {
    // Find matching patterns sorted by success rate
    const matches = this.patterns
      .filter(p => this.patternMatches(p, context))
      .sort((a, b) => (b.successRate * b.occurrences) - (a.successRate * a.occurrences));

    return matches[0] || null;
  }

  /**
   * Check if a pattern matches the current context
   */
  private patternMatches(pattern: ActionPattern, context: DecisionLogEntry['context']): boolean {
    const trigger = pattern.trigger;

    if (trigger.hasItems) {
      const hasAll = trigger.hasItems.every(item =>
        context.inventory.some(inv => inv.includes(item))
      );
      if (!hasAll) return false;
    }

    if (trigger.nearBlocks) {
      const hasNearby = trigger.nearBlocks.some(block =>
        context.nearbyBlocks.some(nb => nb.includes(block))
      );
      if (!hasNearby) return false;
    }

    if (trigger.lowHealth && context.health > 10) return false;
    if (trigger.lowFood && context.food > 10) return false;
    if (trigger.timeOfDay && context.time !== trigger.timeOfDay) return false;

    return true;
  }

  /**
   * Extract patterns from logged decisions (call periodically or on shutdown)
   */
  extractPatterns(): void {
    const patternMap = new Map<string, { success: number; total: number; trigger: ActionPattern['trigger'] }>();

    for (const entry of this.entries) {
      const key = `${entry.decision.type}:${entry.decision.target}`;

      const existing = patternMap.get(key) || {
        success: 0,
        total: 0,
        trigger: this.extractTrigger(entry.context),
      };

      existing.total++;
      if (entry.result.success) existing.success++;

      patternMap.set(key, existing);
    }

    // Convert to patterns (only keep patterns with >50% success and >2 occurrences)
    this.patterns = [];
    for (const [key, data] of patternMap) {
      const [type, target] = key.split(':');
      const successRate = data.success / data.total;

      if (successRate >= 0.5 && data.total >= 2) {
        this.patterns.push({
          trigger: data.trigger,
          action: { type, target },
          successRate,
          occurrences: data.total,
        });
      }
    }

    logger.info(`Extracted ${this.patterns.length} patterns from ${this.entries.length} decisions`);
    this.savePatterns();
  }

  /**
   * Extract trigger conditions from context
   */
  private extractTrigger(context: DecisionLogEntry['context']): ActionPattern['trigger'] {
    return {
      hasItems: context.inventory.length > 0 ? context.inventory.slice(0, 3) : undefined,
      nearBlocks: context.nearbyBlocks.length > 0 ? context.nearbyBlocks.slice(0, 3) : undefined,
      lowHealth: context.health < 10,
      lowFood: context.food < 10,
      timeOfDay: context.time,
    };
  }

  /**
   * Load existing entries from file
   */
  private loadEntries(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const data = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
        this.entries = data.entries || [];
        logger.info(`Loaded ${this.entries.length} existing decision entries`);
      }
    } catch (err) {
      logger.error('Failed to load decision entries', { error: err });
      this.entries = [];
    }
  }

  /**
   * Load extracted patterns
   */
  private loadPatterns(): void {
    try {
      const patternsFile = path.join(this.logDir, 'patterns.json');
      if (fs.existsSync(patternsFile)) {
        this.patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
        logger.info(`Loaded ${this.patterns.length} action patterns`);
      }
    } catch (err) {
      logger.error('Failed to load patterns', { error: err });
      this.patterns = [];
    }
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
   * Save entries to file
   */
  save(): void {
    try {
      const data = {
        lastUpdated: new Date().toISOString(),
        totalEntries: this.entries.length,
        entries: this.entries,
      };
      fs.writeFileSync(this.logFile, JSON.stringify(data, null, 2));
      logger.debug(`Saved ${this.entries.length} decision entries`);
    } catch (err) {
      logger.error('Failed to save decision log', { error: err });
    }
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.extractPatterns();
    this.save();
    logger.info('Decision logger shutdown complete');
  }

  /**
   * Get statistics
   */
  getStats(): { totalDecisions: number; patterns: number; successRate: number } {
    const successful = this.entries.filter(e => e.result.success).length;
    return {
      totalDecisions: this.entries.length,
      patterns: this.patterns.length,
      successRate: this.entries.length > 0 ? successful / this.entries.length : 0,
    };
  }
}

// Singleton instance
export const decisionLogger = new DecisionLogger();
