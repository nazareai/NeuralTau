/**
 * Viewer Memory System
 * 
 * Remembers viewers who interact with the stream,
 * enabling personalized greetings and callbacks.
 */

import { Logger } from '@tau/shared';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('ViewerMemory');

interface ViewerData {
  username: string;
  displayName: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  totalBits: number;
  subMonths: number;
  isSubscriber: boolean;
  isModerator: boolean;
  memorable: string[]; // Memorable interactions
}

class ViewerMemory {
  private viewers: Map<string, ViewerData> = new Map();
  private dataFile: string;
  private saveInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFile = path.join(dataDir, 'viewer-memory.json');
    this.load();
    
    // Auto-save every 5 minutes
    this.saveInterval = setInterval(() => this.save(), 5 * 60 * 1000);
  }

  /**
   * Load viewer data from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
        this.viewers = new Map(Object.entries(data));
        logger.info('Loaded viewer memory', { viewers: this.viewers.size });
      }
    } catch (error) {
      logger.warn('Failed to load viewer memory', { error });
    }
  }

  /**
   * Save viewer data to disk
   */
  save(): void {
    try {
      const data = Object.fromEntries(this.viewers);
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
      logger.debug('Saved viewer memory', { viewers: this.viewers.size });
    } catch (error) {
      logger.warn('Failed to save viewer memory', { error });
    }
  }

  /**
   * Record a viewer interaction
   */
  recordInteraction(
    username: string,
    displayName: string,
    options?: {
      isSubscriber?: boolean;
      isModerator?: boolean;
      bits?: number;
      subMonths?: number;
      memorable?: string;
    }
  ): { isNew: boolean; isReturning: boolean; daysSinceLastSeen: number } {
    const usernameLower = username.toLowerCase();
    const now = Date.now();
    const existing = this.viewers.get(usernameLower);

    if (existing) {
      // Returning viewer
      const daysSince = Math.floor((now - existing.lastSeen) / (1000 * 60 * 60 * 24));
      
      existing.lastSeen = now;
      existing.messageCount++;
      existing.displayName = displayName;
      
      if (options?.isSubscriber !== undefined) existing.isSubscriber = options.isSubscriber;
      if (options?.isModerator !== undefined) existing.isModerator = options.isModerator;
      if (options?.bits) existing.totalBits += options.bits;
      if (options?.subMonths) existing.subMonths = options.subMonths;
      if (options?.memorable) {
        existing.memorable.push(options.memorable);
        // Keep only last 5 memorable interactions
        if (existing.memorable.length > 5) {
          existing.memorable = existing.memorable.slice(-5);
        }
      }

      this.viewers.set(usernameLower, existing);

      return {
        isNew: false,
        isReturning: daysSince > 0,
        daysSinceLastSeen: daysSince,
      };
    } else {
      // New viewer
      const newViewer: ViewerData = {
        username: usernameLower,
        displayName,
        firstSeen: now,
        lastSeen: now,
        messageCount: 1,
        totalBits: options?.bits || 0,
        subMonths: options?.subMonths || 0,
        isSubscriber: options?.isSubscriber || false,
        isModerator: options?.isModerator || false,
        memorable: options?.memorable ? [options.memorable] : [],
      };

      this.viewers.set(usernameLower, newViewer);
      logger.info('New viewer recorded', { username: displayName });

      return {
        isNew: true,
        isReturning: false,
        daysSinceLastSeen: 0,
      };
    }
  }

  /**
   * Get viewer data
   */
  getViewer(username: string): ViewerData | null {
    return this.viewers.get(username.toLowerCase()) || null;
  }

  /**
   * Generate a personalized greeting for a viewer
   */
  getPersonalizedGreeting(username: string): string | null {
    const viewer = this.getViewer(username);
    if (!viewer) return null;

    const greetings: string[] = [];
    const name = viewer.displayName;

    // Check if returning after absence
    const daysSince = Math.floor((Date.now() - viewer.lastSeen) / (1000 * 60 * 60 * 24));
    
    if (daysSince > 7) {
      greetings.push(
        `Yo ${name}! Haven't seen you in a minute`,
        `${name}! Where you been?`,
        `Oh snap ${name} is back!`,
      );
    } else if (daysSince > 1) {
      greetings.push(
        `${name}! Good to see you again`,
        `Ayy ${name} what's good`,
        `${name} back in the chat`,
      );
    }

    // Loyal viewer (many messages)
    if (viewer.messageCount > 50) {
      greetings.push(
        `${name}! One of the real ones`,
        `My guy ${name}!`,
        `${name} always comes through`,
      );
    }

    // Subscriber appreciation
    if (viewer.isSubscriber && viewer.subMonths > 3) {
      greetings.push(
        `${name}! ${viewer.subMonths} months, you're a legend`,
        `Appreciate you ${name}, been here since day one basically`,
      );
    }

    // Bits supporter
    if (viewer.totalBits > 1000) {
      greetings.push(
        `${name}! Appreciate all the support fr`,
        `${name} the homie with the bits`,
      );
    }

    if (greetings.length === 0) {
      // Default greetings
      greetings.push(
        `Hey ${name}`,
        `What's up ${name}`,
        `${name}!`,
      );
    }

    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  /**
   * Check if viewer is a regular (many interactions)
   */
  isRegular(username: string): boolean {
    const viewer = this.getViewer(username);
    if (!viewer) return false;
    return viewer.messageCount >= 20 || viewer.subMonths >= 2 || viewer.totalBits >= 500;
  }

  /**
   * Check if viewer is new (first time)
   */
  isFirstTime(username: string): boolean {
    const viewer = this.getViewer(username);
    return !viewer || viewer.messageCount === 1;
  }

  /**
   * Get top supporters
   */
  getTopSupporters(limit: number = 5): ViewerData[] {
    const viewers = Array.from(this.viewers.values());
    return viewers
      .sort((a, b) => (b.totalBits + b.subMonths * 100) - (a.totalBits + a.subMonths * 100))
      .slice(0, limit);
  }

  /**
   * Get viewer stats
   */
  getStats(): { totalViewers: number; subscribers: number; regulars: number } {
    const viewers = Array.from(this.viewers.values());
    return {
      totalViewers: viewers.length,
      subscribers: viewers.filter(v => v.isSubscriber).length,
      regulars: viewers.filter(v => this.isRegular(v.username)).length,
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.save();
  }
}

// Singleton instance
export const viewerMemory = new ViewerMemory();
export default viewerMemory;

