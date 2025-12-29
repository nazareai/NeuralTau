import { GameState, GameAction, GameMode, Logger } from '@tau/shared';
import { config } from '../config.js';
import { textAdventure } from './text-adventure.js';
import { minecraftGame } from './minecraft.js';

const logger = new Logger('GameManager');

export class GameManager {
  private currentMode: GameMode;

  constructor() {
    this.currentMode = config.game.mode;
    logger.info('Game Manager initialized', { mode: this.currentMode });
  }

  /**
   * Initialize the current game
   */
  async initialize(): Promise<void> {
    logger.info('Initializing game', { mode: this.currentMode });

    switch (this.currentMode) {
      case 'minecraft':
        await minecraftGame.connect();
        break;

      case 'text-adventure':
        // Text adventure doesn't need initialization
        break;

      case 'pokemon':
        throw new Error('Pokemon not implemented yet');

      default:
        throw new Error(`Unknown game mode: ${this.currentMode}`);
    }
  }

  /**
   * Get current game state
   */
  getState(): GameState {
    switch (this.currentMode) {
      case 'minecraft':
        return minecraftGame.getState();

      case 'text-adventure':
        return textAdventure.getState();

      case 'pokemon':
        throw new Error('Pokemon not implemented yet');

      default:
        throw new Error(`Unknown game mode: ${this.currentMode}`);
    }
  }

  /**
   * Execute action in current game
   */
  async executeAction(action: GameAction): Promise<string> {
    switch (this.currentMode) {
      case 'minecraft':
        return await minecraftGame.executeAction(action);

      case 'text-adventure':
        return textAdventure.executeAction(action);

      case 'pokemon':
        throw new Error('Pokemon not implemented yet');

      default:
        throw new Error(`Unknown game mode: ${this.currentMode}`);
    }
  }

  /**
   * Get game summary for AI context
   */
  getSummary(): string {
    const state = this.getState();

    switch (this.currentMode) {
      case 'minecraft':
        return this.getMinecraftSummary(state);

      case 'text-adventure':
        return textAdventure.getSummary();

      case 'pokemon':
        throw new Error('Pokemon not implemented yet');

      default:
        return 'Unknown game';
    }
  }

  /**
   * Get Minecraft-specific summary
   */
  private getMinecraftSummary(state: GameState): string {
    const meta = state.metadata;

    if (!meta.connected) {
      return 'Not connected to Minecraft server. Status: ' + (meta.error || 'idle');
    }

    const parts = [
      `You are playing Minecraft.`,
      `Position: (${(meta as any).position?.x}, ${(meta as any).position?.y}, ${(meta as any).position?.z})`,
      `Health: ${meta.health}/20 | Food: ${meta.food}/20`,
      `Time: ${meta.time} | Weather: ${meta.weather}`,
      `Nearby blocks: ${(meta.nearbyBlocks as string[])?.slice(0, 8).join(', ') || 'none'}`,
      `Nearby entities: ${(meta.nearbyEntities as string[])?.slice(0, 5).join(', ') || 'none'}`,
      `Inventory: ${(meta.inventory as any[])?.length || 0} items`,
    ];

    if ((meta.inventory as any[])?.length > 0) {
      const items = (meta.inventory as any[])
        .slice(0, 5)
        .map(i => `${i.name} (x${i.count})`)
        .join(', ');
      parts.push(`Top items: ${items}`);
    }

    return parts.join('\n');
  }

  /**
   * Shutdown current game
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down game', { mode: this.currentMode });

    switch (this.currentMode) {
      case 'minecraft':
        minecraftGame.disconnect();
        break;

      case 'text-adventure':
        // No cleanup needed
        break;

      case 'pokemon':
        // No cleanup needed
        break;
    }
  }

  /**
   * Switch to different game mode
   */
  async switchMode(newMode: GameMode): Promise<void> {
    if (newMode === this.currentMode) {
      logger.warn('Already in requested game mode', { mode: newMode });
      return;
    }

    logger.info('Switching game mode', {
      from: this.currentMode,
      to: newMode,
    });

    // Shutdown current game
    await this.shutdown();

    // Update mode
    this.currentMode = newMode;

    // Initialize new game
    await this.initialize();
  }

  /**
   * Get current mode
   */
  getCurrentMode(): GameMode {
    return this.currentMode;
  }

  /**
   * Enter batch mode - suppresses idle behavior between batch operations.
   * Only applicable for Minecraft.
   * @param durationMs Duration to stay in batch mode
   */
  enterBatchMode(durationMs?: number): void {
    if (this.currentMode === 'minecraft') {
      minecraftGame.enterBatchMode(durationMs);
    }
  }

  /**
   * Exit batch mode - allows idle behavior to resume.
   * Only applicable for Minecraft.
   */
  exitBatchMode(): void {
    if (this.currentMode === 'minecraft') {
      minecraftGame.exitBatchMode();
    }
  }
}

// Singleton instance
export const gameManager = new GameManager();
