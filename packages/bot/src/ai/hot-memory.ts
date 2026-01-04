/**
 * HOT MEMORY - Tier 1 of the Learning Architecture
 *
 * Purpose: Immediate decision-making, stuck detection, recent action tracking
 * Storage: In-memory with persistence to session file
 * Capacity: 50 entries (configurable)
 * Persistence: Saved every 30 seconds + on shutdown
 *
 * This replaces the old actionHistory array in brain.ts which was:
 * - Limited to 10 entries
 * - Lost on restart
 * - Not connected to warm storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@tau/shared';

const logger = new Logger('HotMemory');

/**
 * Compact context for fast storage and queries
 * Uses short field names to minimize memory footprint
 */
export interface CompactContext {
  pos: [number, number, number]; // Position [x, y, z]
  hp: number;                     // Health
  fd: number;                     // Food
  inv: string[];                  // Inventory item names (top 10)
  blk: string[];                  // Nearby block names (top 5)
  ent: string[];                  // Nearby entity names
  time: 'day' | 'night' | 'dawn' | 'dusk';
  underground: boolean;
}

/**
 * A single entry in hot memory
 */
export interface HotMemoryEntry {
  ts: number;                     // Timestamp (ms since epoch)
  action: {
    type: string;
    target: string;
  };
  ctx: CompactContext;
  success: boolean;
  durationMs: number;
  reason?: string;                // AI reasoning (truncated)
  errorMsg?: string;              // Error message if failed
}

/**
 * Statistics for a specific action type
 */
export interface ActionStats {
  type: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  lastAttempt: number;
  lastSuccess: number | null;
  recentErrors: string[];
}

/**
 * Session file format for persistence
 */
interface SessionFile {
  version: 1;
  sessionId: string;
  startTime: number;
  lastFlush: number;
  entries: HotMemoryEntry[];
}

/**
 * Hot Memory Manager - Tier 1 of Learning Architecture
 */
export class HotMemory {
  private entries: HotMemoryEntry[] = [];
  private readonly maxEntries: number;
  private readonly flushIntervalMs: number;
  private readonly sessionDir: string;
  private readonly sessionFile: string;
  private sessionId: string;
  private sessionStartTime: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private warmStorageCallback: ((entries: HotMemoryEntry[]) => void) | null = null;
  private lastFlushIndex: number = 0;

  constructor(options?: {
    maxEntries?: number;
    flushIntervalMs?: number;
    dataDir?: string;
  }) {
    this.maxEntries = options?.maxEntries ?? 50;
    this.flushIntervalMs = options?.flushIntervalMs ?? 30000; // 30 seconds
    this.sessionDir = options?.dataDir ?? path.join(process.cwd(), 'data', 'learning', 'hot');
    this.sessionId = `session-${Date.now()}`;
    this.sessionStartTime = Date.now();
    this.sessionFile = path.join(this.sessionDir, 'session-current.json');

    // Ensure directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    logger.info('HotMemory initialized', {
      maxEntries: this.maxEntries,
      flushIntervalMs: this.flushIntervalMs,
      sessionId: this.sessionId,
    });
  }

  /**
   * Initialize hot memory - load from session file if exists
   */
  async initialize(): Promise<void> {
    this.loadFromSessionFile();
    this.startFlushTimer();
    logger.info('HotMemory ready', { entriesLoaded: this.entries.length });
  }

  /**
   * Register callback for flushing to warm storage
   */
  setWarmStorageCallback(callback: (entries: HotMemoryEntry[]) => void): void {
    this.warmStorageCallback = callback;
  }

  /**
   * Record an action result
   */
  record(
    action: { type: string; target: string },
    context: CompactContext,
    success: boolean,
    durationMs: number,
    options?: {
      reason?: string;
      errorMsg?: string;
    }
  ): void {
    const entry: HotMemoryEntry = {
      ts: Date.now(),
      action: { type: action.type, target: action.target },
      ctx: context,
      success,
      durationMs,
      reason: options?.reason?.substring(0, 100), // Truncate reasoning
      errorMsg: options?.errorMsg?.substring(0, 200), // Truncate error
    };

    this.entries.push(entry);

    // Trim if over capacity
    if (this.entries.length > this.maxEntries) {
      // Flush oldest entries to warm storage before removing
      const toFlush = this.entries.slice(0, this.entries.length - this.maxEntries);
      if (this.warmStorageCallback && toFlush.length > 0) {
        this.warmStorageCallback(toFlush);
      }
      this.entries = this.entries.slice(-this.maxEntries);
      this.lastFlushIndex = 0;
    }

    logger.debug('Action recorded', {
      action: `${action.type}:${action.target}`,
      success,
      durationMs,
      totalEntries: this.entries.length,
    });
  }

  /**
   * Get recent entries (most recent first)
   */
  getRecent(limit: number = 10): HotMemoryEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /**
   * Get entries for a specific action type
   */
  getByActionType(actionType: string, limit: number = 10): HotMemoryEntry[] {
    return this.entries
      .filter(e => e.action.type === actionType)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get recent failures for a specific action type
   */
  getRecentFailures(actionType: string, limit: number = 5): HotMemoryEntry[] {
    return this.entries
      .filter(e => e.action.type === actionType && !e.success)
      .slice(-limit)
      .reverse();
  }

  /**
   * Count consecutive failures from most recent
   */
  getConsecutiveFailureCount(): number {
    let count = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (!this.entries[i].success) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Get the most recent failing action type
   */
  getMostRecentFailingActionType(): string | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (!this.entries[i].success) {
        return this.entries[i].action.type;
      }
    }
    return null;
  }

  /**
   * Get action types that have failed multiple times recently
   */
  getRecentlyFailedActionTypes(minFailures: number = 3): string[] {
    const failureCounts: Record<string, number> = {};

    for (const entry of this.entries) {
      if (!entry.success) {
        const actionType = entry.action.type;
        failureCounts[actionType] = (failureCounts[actionType] || 0) + 1;
      }
    }

    return Object.entries(failureCounts)
      .filter(([_, count]) => count >= minFailures)
      .map(([actionType, _]) => actionType);
  }

  /**
   * Check if bot is repeating the same failed action
   */
  isRepeatingFailedAction(): { isRepeating: boolean; actionType?: string; count?: number } {
    if (this.entries.length < 3) {
      return { isRepeating: false };
    }

    const lastThree = this.entries.slice(-3);
    const allFailed = lastThree.every(e => !e.success);
    const sameType = lastThree.every(e => e.action.type === lastThree[0].action.type);

    if (allFailed && sameType) {
      return {
        isRepeating: true,
        actionType: lastThree[0].action.type,
        count: 3,
      };
    }

    return { isRepeating: false };
  }

  /**
   * Get success rate for an action type
   */
  getActionSuccessRate(actionType: string): number {
    const actions = this.entries.filter(e => e.action.type === actionType);
    if (actions.length === 0) return 0;
    const successes = actions.filter(e => e.success).length;
    return successes / actions.length;
  }

  /**
   * Get comprehensive stats for an action type
   */
  getActionStats(actionType: string): ActionStats | null {
    const actions = this.entries.filter(e => e.action.type === actionType);
    if (actions.length === 0) return null;

    const successes = actions.filter(e => e.success);
    const failures = actions.filter(e => !e.success);
    const totalDuration = actions.reduce((sum, e) => sum + e.durationMs, 0);
    const lastSuccess = successes.length > 0 ? successes[successes.length - 1].ts : null;

    return {
      type: actionType,
      attempts: actions.length,
      successes: successes.length,
      failures: failures.length,
      successRate: successes.length / actions.length,
      avgDurationMs: totalDuration / actions.length,
      lastAttempt: actions[actions.length - 1].ts,
      lastSuccess,
      recentErrors: failures.slice(-3).map(e => e.errorMsg || 'Unknown error'),
    };
  }

  /**
   * Get all action stats
   */
  getAllActionStats(): ActionStats[] {
    const actionTypes = new Set(this.entries.map(e => e.action.type));
    const stats: ActionStats[] = [];

    for (const actionType of actionTypes) {
      const stat = this.getActionStats(actionType);
      if (stat) stats.push(stat);
    }

    return stats.sort((a, b) => b.attempts - a.attempts);
  }

  /**
   * Get stuck loop warning if same action failing repeatedly
   */
  getStuckLoopWarning(): string | null {
    if (this.entries.length < 5) return null;

    const lastFive = this.entries.slice(-5);
    const failedActions = lastFive.filter(e => !e.success);

    if (failedActions.length < 3) return null;

    // Count action signatures
    const signatureCounts: Record<string, number> = {};
    for (const entry of failedActions) {
      const sig = `${entry.action.type}:${entry.action.target || 'none'}`;
      signatureCounts[sig] = (signatureCounts[sig] || 0) + 1;
    }

    const entries = Object.entries(signatureCounts);
    const [mostRepeated, count] = entries.sort((a, b) => b[1] - a[1])[0];

    if (count >= 3) {
      const [actionType, target] = mostRepeated.split(':');
      logger.warn('[STUCK-LOOP] Same action failing repeatedly', {
        action: actionType,
        target,
        failCount: count,
      });

      return `🚨 STUCK LOOP: "${actionType} ${target}" failed ${count} times! Try something COMPLETELY DIFFERENT.`;
    }

    return null;
  }

  /**
   * Build context string for AI prompt
   */
  buildContextForAI(): string {
    const recentActions = this.getRecent(5);
    if (recentActions.length === 0) return '';

    const lines: string[] = ['RECENT ACTIONS:'];

    for (const entry of recentActions) {
      const status = entry.success ? '✓' : '✗';
      const time = Math.round((Date.now() - entry.ts) / 1000);
      lines.push(`  ${status} ${entry.action.type} ${entry.action.target || ''} (${time}s ago, ${entry.durationMs}ms)`);
      if (!entry.success && entry.errorMsg) {
        lines.push(`    Error: ${entry.errorMsg.substring(0, 50)}`);
      }
    }

    // Add stats for failed actions
    const failedTypes = this.getRecentlyFailedActionTypes(2);
    if (failedTypes.length > 0) {
      lines.push('');
      lines.push('ACTION SUCCESS RATES:');
      for (const actionType of failedTypes) {
        const stats = this.getActionStats(actionType);
        if (stats) {
          lines.push(`  ${actionType}: ${Math.round(stats.successRate * 100)}% (${stats.successes}/${stats.attempts})`);
        }
      }
    }

    // Add stuck warning if applicable
    const stuckWarning = this.getStuckLoopWarning();
    if (stuckWarning) {
      lines.unshift(stuckWarning);
      lines.unshift('');
    }

    return lines.join('\n');
  }

  /**
   * Start the flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flushToWarmStorage();
      this.saveSessionFile();
    }, this.flushIntervalMs);

    logger.debug('Flush timer started', { intervalMs: this.flushIntervalMs });
  }

  /**
   * Flush new entries to warm storage
   */
  flushToWarmStorage(): void {
    if (!this.warmStorageCallback) return;

    const newEntries = this.entries.slice(this.lastFlushIndex);
    if (newEntries.length === 0) return;

    this.warmStorageCallback(newEntries);
    this.lastFlushIndex = this.entries.length;

    logger.debug('Flushed to warm storage', { entriesFlushed: newEntries.length });
  }

  /**
   * Load from session file on startup
   */
  private loadFromSessionFile(): void {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        logger.debug('No session file found, starting fresh');
        return;
      }

      const data = fs.readFileSync(this.sessionFile, 'utf-8');
      const session: SessionFile = JSON.parse(data);

      if (session.version !== 1) {
        logger.warn('Session file version mismatch, starting fresh');
        return;
      }

      // Only load entries from last hour (stale data not useful)
      const oneHourAgo = Date.now() - 3600000;
      this.entries = session.entries.filter(e => e.ts > oneHourAgo);

      // Continue the session if recent enough
      if (session.lastFlush > oneHourAgo) {
        this.sessionId = session.sessionId;
        this.sessionStartTime = session.startTime;
      }

      logger.info('Loaded from session file', {
        totalEntries: session.entries.length,
        recentEntries: this.entries.length,
        sessionAge: Math.round((Date.now() - session.startTime) / 60000) + ' minutes',
      });
    } catch (err) {
      logger.error('Failed to load session file', { error: err });
      this.entries = [];
    }
  }

  /**
   * Save to session file
   */
  saveSessionFile(): void {
    try {
      const session: SessionFile = {
        version: 1,
        sessionId: this.sessionId,
        startTime: this.sessionStartTime,
        lastFlush: Date.now(),
        entries: this.entries,
      };

      // Write to temp file first, then rename (atomic)
      const tempFile = this.sessionFile + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(session, null, 2));
      fs.renameSync(tempFile, this.sessionFile);

      logger.debug('Session file saved', { entries: this.entries.length });
    } catch (err) {
      logger.error('Failed to save session file', { error: err });
    }
  }

  /**
   * Shutdown - flush everything and save
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush to warm storage
    this.flushToWarmStorage();

    // Save session file
    this.saveSessionFile();

    logger.info('HotMemory shutdown complete', {
      totalEntries: this.entries.length,
      sessionDuration: Math.round((Date.now() - this.sessionStartTime) / 60000) + ' minutes',
    });
  }

  /**
   * Get memory stats
   */
  getStats(): {
    entries: number;
    maxEntries: number;
    sessionId: string;
    sessionDurationMs: number;
    oldestEntryAge: number | null;
    newestEntryAge: number | null;
  } {
    const now = Date.now();
    return {
      entries: this.entries.length,
      maxEntries: this.maxEntries,
      sessionId: this.sessionId,
      sessionDurationMs: now - this.sessionStartTime,
      oldestEntryAge: this.entries.length > 0 ? now - this.entries[0].ts : null,
      newestEntryAge: this.entries.length > 0 ? now - this.entries[this.entries.length - 1].ts : null,
    };
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries = [];
    this.lastFlushIndex = 0;
    logger.info('HotMemory cleared');
  }
}

// Singleton instance
let hotMemoryInstance: HotMemory | null = null;

export function getHotMemory(): HotMemory {
  if (!hotMemoryInstance) {
    hotMemoryInstance = new HotMemory();
  }
  return hotMemoryInstance;
}

export function initializeHotMemory(options?: {
  maxEntries?: number;
  flushIntervalMs?: number;
  dataDir?: string;
}): HotMemory {
  hotMemoryInstance = new HotMemory(options);
  return hotMemoryInstance;
}
