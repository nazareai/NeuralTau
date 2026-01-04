/**
 * WARM STORAGE - Tier 2 of the Learning Architecture
 *
 * Purpose: Cross-session learning, pattern extraction, fine-tuning data
 * Storage: JSONL files (one line per decision, append-only)
 * Retention: 7 days of session files
 * Format: Fine-tuning ready format
 *
 * Key Features:
 * - JSONL format (streamable, grep-able, one line per entry)
 * - Session-based files (not daily)
 * - Max entries per file before rotation
 * - 7-day retention policy
 * - Fine-tuning export capability
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Logger } from '@tau/shared';
import { HotMemoryEntry, CompactContext } from './hot-memory';

const logger = new Logger('WarmStorage');

/**
 * Entry format stored in JSONL files
 * Compact field names for smaller file size
 */
export interface WarmStorageEntry {
  ts: number;                     // Timestamp
  ctx: CompactContext;            // Context at decision time
  act: { type: string; target: string };  // Action taken
  res: {
    ok: boolean;                  // Success
    msg: string;                  // Result message
    ms: number;                   // Duration
  };
  reason?: string;                // AI reasoning
}

/**
 * Fine-tuning format (OpenAI compatible)
 */
export interface FineTuningEntry {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  success: boolean;
  reward?: number;
}

/**
 * Session file metadata
 */
interface SessionMeta {
  filename: string;
  path: string;
  startTime: number;
  entries: number;
  size: number;
}

/**
 * Warm Storage Manager
 */
export class WarmStorage {
  private readonly sessionDir: string;
  private readonly maxEntriesPerFile: number;
  private readonly retentionDays: number;
  private currentFile: string | null = null;
  private currentEntryCount: number = 0;
  private writeStream: fs.WriteStream | null = null;

  constructor(options?: {
    dataDir?: string;
    maxEntriesPerFile?: number;
    retentionDays?: number;
  }) {
    this.sessionDir = options?.dataDir ?? path.join(process.cwd(), 'data', 'learning', 'sessions');
    this.maxEntriesPerFile = options?.maxEntriesPerFile ?? 1000;
    this.retentionDays = options?.retentionDays ?? 7;

    // Ensure directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    logger.info('WarmStorage initialized', {
      sessionDir: this.sessionDir,
      maxEntriesPerFile: this.maxEntriesPerFile,
      retentionDays: this.retentionDays,
    });
  }

  /**
   * Initialize warm storage
   */
  async initialize(): Promise<void> {
    // Clean up old files
    await this.enforceRetentionPolicy();

    // Find or create current session file
    await this.openCurrentSession();

    logger.info('WarmStorage ready', {
      currentFile: this.currentFile,
      currentEntries: this.currentEntryCount,
    });
  }

  /**
   * Append entries from hot memory
   */
  async appendEntries(entries: HotMemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    for (const entry of entries) {
      await this.appendEntry(this.convertToWarmEntry(entry));
    }

    logger.debug('Appended entries to warm storage', {
      count: entries.length,
      file: path.basename(this.currentFile || ''),
    });
  }

  /**
   * Append a single entry
   */
  private async appendEntry(entry: WarmStorageEntry): Promise<void> {
    // Check if we need to rotate
    if (this.currentEntryCount >= this.maxEntriesPerFile) {
      await this.rotateFile();
    }

    // Ensure we have a write stream
    if (!this.writeStream) {
      await this.openCurrentSession();
    }

    // Write as single JSON line
    const line = JSON.stringify(entry) + '\n';
    this.writeStream!.write(line);
    this.currentEntryCount++;
  }

  /**
   * Convert hot memory entry to warm storage format
   */
  private convertToWarmEntry(entry: HotMemoryEntry): WarmStorageEntry {
    return {
      ts: entry.ts,
      ctx: entry.ctx,
      act: entry.action,
      res: {
        ok: entry.success,
        msg: entry.errorMsg || (entry.success ? 'Success' : 'Failed'),
        ms: entry.durationMs,
      },
      reason: entry.reason,
    };
  }

  /**
   * Open or create current session file
   */
  private async openCurrentSession(): Promise<void> {
    // Close existing stream
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    // Find most recent session file that's not full
    const sessions = await this.listSessionFiles();
    const recent = sessions[sessions.length - 1];

    if (recent && recent.entries < this.maxEntriesPerFile) {
      this.currentFile = recent.path;
      this.currentEntryCount = recent.entries;
    } else {
      // Create new session file
      const timestamp = Date.now();
      this.currentFile = path.join(this.sessionDir, `session-${timestamp}.jsonl`);
      this.currentEntryCount = 0;
    }

    // Open append stream
    this.writeStream = fs.createWriteStream(this.currentFile, { flags: 'a' });

    logger.debug('Opened session file', {
      file: path.basename(this.currentFile),
      existingEntries: this.currentEntryCount,
    });
  }

  /**
   * Rotate to a new file
   */
  private async rotateFile(): Promise<void> {
    logger.info('Rotating session file', {
      oldFile: path.basename(this.currentFile || ''),
      entries: this.currentEntryCount,
    });

    // Close current stream
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    // Create new file
    const timestamp = Date.now();
    this.currentFile = path.join(this.sessionDir, `session-${timestamp}.jsonl`);
    this.currentEntryCount = 0;

    // Open new stream
    this.writeStream = fs.createWriteStream(this.currentFile, { flags: 'a' });
  }

  /**
   * List all session files with metadata
   */
  async listSessionFiles(): Promise<SessionMeta[]> {
    const files = fs.readdirSync(this.sessionDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .sort();

    const sessions: SessionMeta[] = [];

    for (const filename of files) {
      const filepath = path.join(this.sessionDir, filename);
      const stats = fs.statSync(filepath);

      // Extract timestamp from filename
      const match = filename.match(/session-(\d+)\.jsonl/);
      const startTime = match ? parseInt(match[1]) : stats.birthtimeMs;

      // Count lines (entries)
      const entries = await this.countLines(filepath);

      sessions.push({
        filename,
        path: filepath,
        startTime,
        entries,
        size: stats.size,
      });
    }

    return sessions;
  }

  /**
   * Count lines in a file
   */
  private async countLines(filepath: string): Promise<number> {
    return new Promise((resolve) => {
      let count = 0;
      const stream = fs.createReadStream(filepath);
      stream.on('data', (chunk) => {
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === 10) count++; // newline
        }
      });
      stream.on('end', () => resolve(count));
      stream.on('error', () => resolve(0));
    });
  }

  /**
   * Enforce retention policy - delete files older than retentionDays
   */
  async enforceRetentionPolicy(): Promise<number> {
    const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    const sessions = await this.listSessionFiles();
    let deleted = 0;

    for (const session of sessions) {
      if (session.startTime < cutoffTime) {
        try {
          fs.unlinkSync(session.path);
          deleted++;
          logger.info('Deleted old session file', {
            file: session.filename,
            age: Math.round((Date.now() - session.startTime) / (24 * 60 * 60 * 1000)) + ' days',
          });
        } catch (err) {
          logger.error('Failed to delete old session file', { file: session.filename, error: err });
        }
      }
    }

    if (deleted > 0) {
      logger.info('Retention policy enforced', { filesDeleted: deleted });
    }

    return deleted;
  }

  /**
   * Load entries from recent sessions
   */
  async loadRecentEntries(maxEntries: number = 500, maxAgeDays: number = 7): Promise<WarmStorageEntry[]> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const sessions = await this.listSessionFiles();
    const entries: WarmStorageEntry[] = [];

    // Load from newest to oldest
    for (let i = sessions.length - 1; i >= 0 && entries.length < maxEntries; i--) {
      const session = sessions[i];
      if (session.startTime < cutoffTime) continue;

      const sessionEntries = await this.readSessionFile(session.path);
      entries.unshift(...sessionEntries);
    }

    // Trim to max and return most recent
    return entries.slice(-maxEntries);
  }

  /**
   * Read all entries from a session file
   */
  async readSessionFile(filepath: string): Promise<WarmStorageEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: WarmStorageEntry[] = [];
      const stream = fs.createReadStream(filepath);
      const rl = readline.createInterface({ input: stream });

      rl.on('line', (line) => {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line));
          } catch (err) {
            logger.warn('Failed to parse line in session file', { file: filepath });
          }
        }
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', reject);
    });
  }

  /**
   * Export entries in fine-tuning format
   */
  async exportForFineTuning(
    outputPath: string,
    options?: {
      systemPrompt?: string;
      onlySuccessful?: boolean;
      maxEntries?: number;
    }
  ): Promise<number> {
    const systemPrompt = options?.systemPrompt ??
      'You are a Minecraft survival AI. Given the game state, decide what action to take. Respond with JSON: {"type": "action_type", "target": "target", "reasoning": "brief explanation"}';

    const entries = await this.loadRecentEntries(options?.maxEntries ?? 10000);
    const filteredEntries = options?.onlySuccessful
      ? entries.filter(e => e.res.ok)
      : entries;

    const writeStream = fs.createWriteStream(outputPath);
    let count = 0;

    for (const entry of filteredEntries) {
      const ftEntry = this.convertToFineTuningFormat(entry, systemPrompt);
      writeStream.write(JSON.stringify(ftEntry) + '\n');
      count++;
    }

    writeStream.end();

    logger.info('Exported fine-tuning dataset', {
      outputPath,
      entries: count,
      format: 'OpenAI JSONL',
    });

    return count;
  }

  /**
   * Convert entry to fine-tuning format
   */
  private convertToFineTuningFormat(entry: WarmStorageEntry, systemPrompt: string): FineTuningEntry {
    // Build user prompt from context
    const ctx = entry.ctx;
    const userPrompt = [
      `Position: (${ctx.pos[0]}, ${ctx.pos[1]}, ${ctx.pos[2]})`,
      `Health: ${ctx.hp}/20`,
      `Food: ${ctx.fd}/20`,
      `Inventory: ${ctx.inv.length > 0 ? ctx.inv.join(', ') : 'empty'}`,
      `Nearby blocks: ${ctx.blk.length > 0 ? ctx.blk.join(', ') : 'none'}`,
      `Nearby entities: ${ctx.ent.length > 0 ? ctx.ent.join(', ') : 'none'}`,
      `Time: ${ctx.time}`,
      ctx.underground ? 'Location: Underground' : '',
      '',
      'What action should you take?',
    ].filter(Boolean).join('\n');

    // Build assistant response
    const assistantResponse = JSON.stringify({
      type: entry.act.type,
      target: entry.act.target,
      reasoning: entry.reason || 'No reasoning provided',
    });

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantResponse },
      ],
      success: entry.res.ok,
      reward: entry.res.ok ? 1.0 : 0.0,
    };
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalEntries: number;
    totalSizeBytes: number;
    oldestFile: string | null;
    newestFile: string | null;
    retentionDays: number;
  }> {
    const sessions = await this.listSessionFiles();

    return {
      totalFiles: sessions.length,
      totalEntries: sessions.reduce((sum, s) => sum + s.entries, 0),
      totalSizeBytes: sessions.reduce((sum, s) => sum + s.size, 0),
      oldestFile: sessions.length > 0 ? sessions[0].filename : null,
      newestFile: sessions.length > 0 ? sessions[sessions.length - 1].filename : null,
      retentionDays: this.retentionDays,
    };
  }

  /**
   * Shutdown - close write stream
   */
  async shutdown(): Promise<void> {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    logger.info('WarmStorage shutdown complete');
  }
}

// Singleton instance
let warmStorageInstance: WarmStorage | null = null;

export function getWarmStorage(): WarmStorage {
  if (!warmStorageInstance) {
    warmStorageInstance = new WarmStorage();
  }
  return warmStorageInstance;
}

export function initializeWarmStorage(options?: {
  dataDir?: string;
  maxEntriesPerFile?: number;
  retentionDays?: number;
}): WarmStorage {
  warmStorageInstance = new WarmStorage(options);
  return warmStorageInstance;
}
