import { LogLevel, LogEntry } from './types';

// ============================================================================
// Logger Utility
// ============================================================================

// Log level priority (higher = more severe, always shown)
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Global log level - set via LOG_LEVEL env var (default: info, skips debug)
const getMinLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return 'info'; // Default: skip debug logs
};

export class Logger {
  private context: string;
  private static minLevel: LogLevel = getMinLogLevel();

  constructor(context: string) {
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[Logger.minLevel];
  }

  private formatMeta(meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) return '';

    // Compact format: key=value pairs, truncate long values
    const parts: string[] = [];
    for (const [key, value] of Object.entries(meta)) {
      let strVal: string;
      if (typeof value === 'string') {
        strVal = value.length > 60 ? value.slice(0, 57) + '...' : value;
      } else if (typeof value === 'number') {
        strVal = Number.isInteger(value) ? String(value) : value.toFixed(2);
      } else if (typeof value === 'boolean') {
        strVal = value ? 'Y' : 'N';
      } else if (value === null || value === undefined) {
        strVal = '-';
      } else if (value instanceof Error) {
        // Error objects don't serialize well with JSON.stringify
        strVal = `${value.name}: ${value.message}`;
        if (strVal.length > 100) strVal = strVal.slice(0, 97) + '...';
      } else if (typeof value === 'object' && value !== null && 'message' in value) {
        // Duck-type Error-like objects (from different contexts)
        const errLike = value as { name?: string; message: string; stack?: string };
        strVal = `${errLike.name || 'Error'}: ${errLike.message}`;
        if (strVal.length > 100) strVal = strVal.slice(0, 97) + '...';
      } else {
        strVal = JSON.stringify(value);
        if (strVal.length > 60) strVal = strVal.slice(0, 57) + '...';
      }
      parts.push(`${key}=${strVal}`);
    }
    return parts.join(' ');
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    // Compact timestamp: HH:MM:SS only
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);

    // Compact format: [TIME] [LEVEL] [CONTEXT] message key=value
    const metaStr = this.formatMeta(meta);
    const logMessage = `[${time}] [${level.toUpperCase().charAt(0)}] [${this.context}] ${message}${metaStr ? ' ' + metaStr : ''}`;

    switch (level) {
      case 'debug':
        console.debug(logMessage);
        break;
      case 'info':
        console.info(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'error':
        console.error(logMessage);
        break;
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.log('error', message, meta);
  }
}

// ============================================================================
// Delay Utility
// ============================================================================

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Retry Utility
// ============================================================================

export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = true,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        if (onRetry) {
          onRetry(attempt, lastError);
        }

        const waitTime = backoff ? delayMs * attempt : delayMs;
        await delay(waitTime);
      }
    }
  }

  throw lastError!;
}

// ============================================================================
// Rate Limiter Utility
// ============================================================================

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(tokens: number = 1): Promise<void> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Wait until we have enough tokens
    const tokensNeeded = tokens - this.tokens;
    const waitTime = (tokensNeeded / this.refillRate) * 1000; // ms

    await delay(waitTime);
    this.tokens = 0;
  }

  canAcquire(tokens: number = 1): boolean {
    this.refill();
    return this.tokens >= tokens;
  }
}

// ============================================================================
// Format Utilities
// ============================================================================

export function formatEth(wei: string | bigint): string {
  const value = typeof wei === 'string' ? BigInt(wei) : wei;
  const eth = Number(value) / 1e18;
  return eth.toFixed(4);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

// ============================================================================
// Validation Utilities
// ============================================================================

export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidTransactionHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

// ============================================================================
// Text Utilities
// ============================================================================

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ============================================================================
// Random Utilities
// ============================================================================

export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================================
// ID Generation
// ============================================================================

export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 9);
  return prefix ? `${prefix}_${timestamp}${randomStr}` : `${timestamp}${randomStr}`;
}
