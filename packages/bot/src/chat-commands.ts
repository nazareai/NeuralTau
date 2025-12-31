/**
 * Chat Commands System
 * 
 * Allows viewers to interact with gameplay through chat commands:
 * - !left / !right / !forward / !back - Direction voting
 * - !goal <text> - Suggest an objective
 * - !name <text> - Name items/pets
 * - !chaos - Toggle entertainment mode
 * - !stats - Show current stats
 */

import { Logger } from '@tau/shared';
import { EventEmitter } from 'events';

const logger = new Logger('ChatCommands');

// Vote tracking
interface DirectionVote {
  direction: 'left' | 'right' | 'forward' | 'back';
  votes: Map<string, boolean>; // username -> voted
  startTime: number;
  endTime: number;
}

interface GoalSuggestion {
  text: string;
  suggestedBy: string;
  timestamp: number;
  votes: number;
}

export class ChatCommandHandler extends EventEmitter {
  private currentVote: DirectionVote | null = null;
  private goalSuggestions: GoalSuggestion[] = [];
  private pendingNames: Map<string, { name: string; suggestedBy: string }> = new Map();
  private voteDurationMs: number = 30000; // 30 second votes
  private voteCheckInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    logger.info('Chat command handler initialized');
  }

  /**
   * Process a chat message for commands
   * Returns true if a command was handled
   */
  processMessage(username: string, message: string, isMod: boolean = false): boolean {
    const trimmed = message.trim().toLowerCase();
    
    // Direction commands
    if (trimmed === '!left' || trimmed === '!l') {
      this.handleDirectionVote(username, 'left');
      return true;
    }
    if (trimmed === '!right' || trimmed === '!r') {
      this.handleDirectionVote(username, 'right');
      return true;
    }
    if (trimmed === '!forward' || trimmed === '!f' || trimmed === '!up') {
      this.handleDirectionVote(username, 'forward');
      return true;
    }
    if (trimmed === '!back' || trimmed === '!b' || trimmed === '!down') {
      this.handleDirectionVote(username, 'back');
      return true;
    }

    // Goal suggestion
    if (trimmed.startsWith('!goal ')) {
      const goalText = message.slice(6).trim();
      if (goalText.length > 0 && goalText.length < 100) {
        this.handleGoalSuggestion(username, goalText);
        return true;
      }
    }

    // Name suggestion
    if (trimmed.startsWith('!name ')) {
      const name = message.slice(6).trim();
      if (name.length > 0 && name.length < 30) {
        this.handleNameSuggestion(username, name);
        return true;
      }
    }

    // Stats command
    if (trimmed === '!stats') {
      this.emit('requestStats', username);
      return true;
    }

    // Chaos mode toggle (mods only)
    if ((trimmed === '!chaos' || trimmed === '!entertainment') && isMod) {
      this.emit('toggleChaos', username);
      return true;
    }

    return false;
  }

  /**
   * Handle direction vote
   */
  private handleDirectionVote(username: string, direction: 'left' | 'right' | 'forward' | 'back'): void {
    const now = Date.now();

    // Start new vote if none exists or current one expired
    if (!this.currentVote || now > this.currentVote.endTime) {
      this.currentVote = {
        direction,
        votes: new Map([[username, true]]),
        startTime: now,
        endTime: now + this.voteDurationMs,
      };
      
      this.emit('voteStarted', {
        direction,
        startedBy: username,
        endsIn: this.voteDurationMs / 1000,
      });

      // Schedule vote resolution
      if (this.voteCheckInterval) clearTimeout(this.voteCheckInterval);
      this.voteCheckInterval = setTimeout(() => this.resolveVote(), this.voteDurationMs);
      
      logger.info('[COMMAND] Direction vote started', { direction, by: username });
      return;
    }

    // Add vote to existing
    if (!this.currentVote.votes.has(username)) {
      // If voting for a different direction, switch it
      if (direction !== this.currentVote.direction) {
        this.currentVote.direction = direction;
        this.currentVote.votes.clear();
      }
      this.currentVote.votes.set(username, true);
      
      this.emit('voteUpdated', {
        direction: this.currentVote.direction,
        voteCount: this.currentVote.votes.size,
        voter: username,
      });
      
      logger.debug('[COMMAND] Vote added', { direction, by: username, total: this.currentVote.votes.size });
    }
  }

  /**
   * Resolve direction vote
   */
  private resolveVote(): void {
    if (!this.currentVote) return;

    const result = {
      direction: this.currentVote.direction,
      voteCount: this.currentVote.votes.size,
    };

    this.emit('voteResolved', result);
    logger.info('[COMMAND] Vote resolved', result);

    // Clear the vote
    this.currentVote = null;
  }

  /**
   * Handle goal suggestion
   */
  private handleGoalSuggestion(username: string, goalText: string): void {
    const suggestion: GoalSuggestion = {
      text: goalText,
      suggestedBy: username,
      timestamp: Date.now(),
      votes: 1,
    };

    this.goalSuggestions.push(suggestion);
    
    // Keep only last 10 suggestions
    if (this.goalSuggestions.length > 10) {
      this.goalSuggestions.shift();
    }

    this.emit('goalSuggested', suggestion);
    logger.info('[COMMAND] Goal suggested', { goal: goalText, by: username });
  }

  /**
   * Handle name suggestion
   */
  private handleNameSuggestion(username: string, name: string): void {
    this.pendingNames.set('current', { name, suggestedBy: username });
    this.emit('nameSuggested', { name, suggestedBy: username });
    logger.info('[COMMAND] Name suggested', { name, by: username });
  }

  /**
   * Get current direction vote status
   */
  getCurrentVote(): { direction: string; voteCount: number; timeLeft: number } | null {
    if (!this.currentVote) return null;
    
    return {
      direction: this.currentVote.direction,
      voteCount: this.currentVote.votes.size,
      timeLeft: Math.max(0, this.currentVote.endTime - Date.now()),
    };
  }

  /**
   * Get recent goal suggestions
   */
  getGoalSuggestions(): GoalSuggestion[] {
    return [...this.goalSuggestions];
  }

  /**
   * Get pending name
   */
  getPendingName(): { name: string; suggestedBy: string } | null {
    return this.pendingNames.get('current') || null;
  }

  /**
   * Clear pending name after use
   */
  clearPendingName(): void {
    this.pendingNames.delete('current');
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    if (this.voteCheckInterval) {
      clearTimeout(this.voteCheckInterval);
    }
    this.removeAllListeners();
  }
}

// Singleton
export const chatCommands = new ChatCommandHandler();
export default chatCommands;

