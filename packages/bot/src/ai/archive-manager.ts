/**
 * ARCHIVE MANAGER - Tier 3 of the Learning Architecture
 *
 * Purpose: Long-term storage, fine-tuning dataset generation
 * Storage: Compressed JSONL archives (monthly)
 * Retention: Forever (external backup recommended)
 * Format: OpenAI fine-tuning compatible
 *
 * Key Features:
 * - Monthly archive rotation
 * - Gzip compression for storage efficiency
 * - Fine-tuning export with customizable system prompts
 * - Human-readable without bot running
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { Logger } from '@tau/shared';
import { WarmStorage, WarmStorageEntry, FineTuningEntry } from './warm-storage';

const logger = new Logger('ArchiveManager');

/**
 * Archive file metadata
 */
interface ArchiveMeta {
  filename: string;
  path: string;
  month: string;           // YYYY-MM format
  entries: number;
  sizeBytes: number;
  compressed: boolean;
  createdAt: number;
}

/**
 * Archive statistics
 */
interface ArchiveStats {
  totalArchives: number;
  totalEntries: number;
  totalSizeBytes: number;
  oldestMonth: string | null;
  newestMonth: string | null;
  compressedCount: number;
  uncompressedCount: number;
}

/**
 * Archive Manager - Tier 3 of Learning Architecture
 */
export class ArchiveManager {
  private readonly archiveDir: string;
  private readonly warmStorage: WarmStorage;

  constructor(warmStorage: WarmStorage, options?: {
    dataDir?: string;
  }) {
    this.warmStorage = warmStorage;
    this.archiveDir = options?.dataDir ?? path.join(process.cwd(), 'data', 'learning', 'archive');

    // Ensure directory exists
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    logger.info('ArchiveManager initialized', {
      archiveDir: this.archiveDir,
    });
  }

  /**
   * Create monthly archive from warm storage entries older than retention period
   */
  async createMonthlyArchive(): Promise<string | null> {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get sessions from warm storage
    const sessions = await this.warmStorage.listSessionFiles();

    // Find sessions from previous months (not current month)
    const toArchive: Array<{ path: string; month: string }> = [];

    for (const session of sessions) {
      const sessionDate = new Date(session.startTime);
      const sessionMonth = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}`;

      if (sessionMonth < currentMonth) {
        toArchive.push({ path: session.path, month: sessionMonth });
      }
    }

    if (toArchive.length === 0) {
      logger.debug('No sessions to archive');
      return null;
    }

    // Group by month
    const byMonth = new Map<string, string[]>();
    for (const item of toArchive) {
      if (!byMonth.has(item.month)) {
        byMonth.set(item.month, []);
      }
      byMonth.get(item.month)!.push(item.path);
    }

    // Create archive for each month
    const archivesCreated: string[] = [];

    for (const [month, sessionPaths] of byMonth) {
      const archivePath = await this.archiveMonth(month, sessionPaths);
      if (archivePath) {
        archivesCreated.push(archivePath);

        // Delete original session files after successful archive
        for (const sessionPath of sessionPaths) {
          try {
            fs.unlinkSync(sessionPath);
            logger.debug('Deleted archived session file', { file: path.basename(sessionPath) });
          } catch (err) {
            logger.error('Failed to delete archived session file', { file: sessionPath, error: err });
          }
        }
      }
    }

    logger.info('Monthly archive complete', {
      monthsArchived: archivesCreated.length,
      sessionsProcessed: toArchive.length,
    });

    return archivesCreated.length > 0 ? archivesCreated.join(', ') : null;
  }

  /**
   * Archive sessions for a specific month
   */
  private async archiveMonth(month: string, sessionPaths: string[]): Promise<string | null> {
    const archiveFile = path.join(this.archiveDir, `training-${month}.jsonl`);
    const compressedFile = archiveFile + '.gz';

    // Check if archive already exists
    if (fs.existsSync(compressedFile)) {
      logger.warn('Archive already exists, appending', { month });
      // Decompress, append, recompress
      await this.appendToCompressedArchive(compressedFile, sessionPaths);
      return compressedFile;
    }

    // Create new archive
    const writeStream = fs.createWriteStream(archiveFile);
    let totalEntries = 0;

    for (const sessionPath of sessionPaths) {
      const entries = await this.warmStorage.readSessionFile(sessionPath);
      for (const entry of entries) {
        const ftEntry = this.convertToFineTuningFormat(entry);
        writeStream.write(JSON.stringify(ftEntry) + '\n');
        totalEntries++;
      }
    }

    writeStream.end();

    // Wait for write to complete
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Compress the archive
    await this.compressFile(archiveFile, compressedFile);

    // Delete uncompressed file
    fs.unlinkSync(archiveFile);

    logger.info('Created monthly archive', {
      month,
      entries: totalEntries,
      compressedFile: path.basename(compressedFile),
    });

    return compressedFile;
  }

  /**
   * Append new entries to an existing compressed archive
   */
  private async appendToCompressedArchive(
    compressedFile: string,
    sessionPaths: string[]
  ): Promise<void> {
    // Decompress to temp file
    const tempFile = compressedFile.replace('.gz', '.tmp');
    await this.decompressFile(compressedFile, tempFile);

    // Append new entries
    const appendStream = fs.createWriteStream(tempFile, { flags: 'a' });

    for (const sessionPath of sessionPaths) {
      const entries = await this.warmStorage.readSessionFile(sessionPath);
      for (const entry of entries) {
        const ftEntry = this.convertToFineTuningFormat(entry);
        appendStream.write(JSON.stringify(ftEntry) + '\n');
      }
    }

    appendStream.end();
    await new Promise<void>((resolve, reject) => {
      appendStream.on('finish', resolve);
      appendStream.on('error', reject);
    });

    // Recompress
    await this.compressFile(tempFile, compressedFile);

    // Delete temp file
    fs.unlinkSync(tempFile);
  }

  /**
   * Compress a file using gzip
   */
  private async compressFile(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(input);
      const writeStream = fs.createWriteStream(output);
      const gzip = zlib.createGzip({ level: 9 });

      readStream
        .pipe(gzip)
        .pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  /**
   * Decompress a gzipped file
   */
  private async decompressFile(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(input);
      const writeStream = fs.createWriteStream(output);
      const gunzip = zlib.createGunzip();

      readStream
        .pipe(gunzip)
        .pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  /**
   * Convert warm storage entry to fine-tuning format
   */
  private convertToFineTuningFormat(
    entry: WarmStorageEntry,
    systemPrompt?: string
  ): FineTuningEntry {
    const defaultPrompt = 'You are a Minecraft survival AI. Given the game state, decide what action to take. Respond with JSON: {"type": "action_type", "target": "target", "reasoning": "brief explanation"}';

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

    const assistantResponse = JSON.stringify({
      type: entry.act.type,
      target: entry.act.target,
      reasoning: entry.reason || 'No reasoning provided',
    });

    return {
      messages: [
        { role: 'system', content: systemPrompt ?? defaultPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: assistantResponse },
      ],
      success: entry.res.ok,
      reward: entry.res.ok ? 1.0 : 0.0,
    };
  }

  /**
   * List all archive files
   */
  async listArchives(): Promise<ArchiveMeta[]> {
    const files = fs.readdirSync(this.archiveDir)
      .filter(f => f.startsWith('training-') && (f.endsWith('.jsonl') || f.endsWith('.jsonl.gz')))
      .sort();

    const archives: ArchiveMeta[] = [];

    for (const filename of files) {
      const filepath = path.join(this.archiveDir, filename);
      const stats = fs.statSync(filepath);
      const compressed = filename.endsWith('.gz');

      // Extract month from filename
      const match = filename.match(/training-(\d{4}-\d{2})/);
      const month = match ? match[1] : 'unknown';

      // Count entries (expensive for compressed files, use estimate)
      let entries: number;
      if (compressed) {
        // Estimate: ~200 bytes per compressed entry
        entries = Math.round(stats.size / 200);
      } else {
        entries = await this.countLines(filepath);
      }

      archives.push({
        filename,
        path: filepath,
        month,
        entries,
        sizeBytes: stats.size,
        compressed,
        createdAt: stats.birthtimeMs,
      });
    }

    return archives;
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
          if (chunk[i] === 10) count++;
        }
      });
      stream.on('end', () => resolve(count));
      stream.on('error', () => resolve(0));
    });
  }

  /**
   * Export all archives to a single fine-tuning file
   */
  async exportCombinedDataset(
    outputPath: string,
    options?: {
      onlySuccessful?: boolean;
      systemPrompt?: string;
      maxEntries?: number;
    }
  ): Promise<number> {
    const archives = await this.listArchives();
    const writeStream = fs.createWriteStream(outputPath);
    let totalEntries = 0;
    const maxEntries = options?.maxEntries ?? Infinity;

    for (const archive of archives) {
      if (totalEntries >= maxEntries) break;

      const entries = await this.readArchive(archive.path);

      for (const entry of entries) {
        if (totalEntries >= maxEntries) break;
        if (options?.onlySuccessful && !entry.success) continue;

        // Re-format with custom system prompt if provided
        if (options?.systemPrompt && entry.messages[0].role === 'system') {
          entry.messages[0].content = options.systemPrompt;
        }

        writeStream.write(JSON.stringify(entry) + '\n');
        totalEntries++;
      }
    }

    writeStream.end();

    logger.info('Exported combined dataset', {
      outputPath,
      totalEntries,
      archivesProcessed: archives.length,
    });

    return totalEntries;
  }

  /**
   * Read entries from an archive file
   */
  async readArchive(archivePath: string): Promise<FineTuningEntry[]> {
    const entries: FineTuningEntry[] = [];
    const compressed = archivePath.endsWith('.gz');

    let readStream: NodeJS.ReadableStream;

    if (compressed) {
      const fileStream = fs.createReadStream(archivePath);
      readStream = fileStream.pipe(zlib.createGunzip());
    } else {
      readStream = fs.createReadStream(archivePath);
    }

    const rl = readline.createInterface({ input: readStream });

    return new Promise((resolve, reject) => {
      rl.on('line', (line) => {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line));
          } catch (err) {
            logger.warn('Failed to parse line in archive');
          }
        }
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', reject);
    });
  }

  /**
   * Get archive statistics
   */
  async getStats(): Promise<ArchiveStats> {
    const archives = await this.listArchives();

    return {
      totalArchives: archives.length,
      totalEntries: archives.reduce((sum, a) => sum + a.entries, 0),
      totalSizeBytes: archives.reduce((sum, a) => sum + a.sizeBytes, 0),
      oldestMonth: archives.length > 0 ? archives[0].month : null,
      newestMonth: archives.length > 0 ? archives[archives.length - 1].month : null,
      compressedCount: archives.filter(a => a.compressed).length,
      uncompressedCount: archives.filter(a => !a.compressed).length,
    };
  }

  /**
   * Delete archives older than a certain number of months
   */
  async deleteOldArchives(keepMonths: number): Promise<number> {
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - keepMonths, 1);
    const cutoffMonth = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;

    const archives = await this.listArchives();
    let deleted = 0;

    for (const archive of archives) {
      if (archive.month < cutoffMonth) {
        try {
          fs.unlinkSync(archive.path);
          deleted++;
          logger.info('Deleted old archive', { file: archive.filename, month: archive.month });
        } catch (err) {
          logger.error('Failed to delete archive', { file: archive.filename, error: err });
        }
      }
    }

    return deleted;
  }
}

// Singleton instance
let archiveManagerInstance: ArchiveManager | null = null;

export function getArchiveManager(warmStorage: WarmStorage): ArchiveManager {
  if (!archiveManagerInstance) {
    archiveManagerInstance = new ArchiveManager(warmStorage);
  }
  return archiveManagerInstance;
}

export function initializeArchiveManager(
  warmStorage: WarmStorage,
  options?: { dataDir?: string }
): ArchiveManager {
  archiveManagerInstance = new ArchiveManager(warmStorage, options);
  return archiveManagerInstance;
}
