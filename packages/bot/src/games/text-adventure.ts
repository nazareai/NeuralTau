import { GameState, GameAction, Logger } from '@tau/shared';

const logger = new Logger('TextAdventure');

interface Room {
  name: string;
  description: string;
  exits: { [direction: string]: string };
  items: string[];
}

const ROOMS: { [key: string]: Room } = {
  start: {
    name: 'Starting Room',
    description: 'You are in a dimly lit room. There is a door to the north and a chest in the corner.',
    exits: { north: 'hallway' },
    items: ['chest', 'torch'],
  },
  hallway: {
    name: 'Long Hallway',
    description: 'A long hallway stretches before you. There are doors to the east and west, and you can go back south.',
    exits: { east: 'library', west: 'kitchen', south: 'start' },
    items: ['painting'],
  },
  library: {
    name: 'Library',
    description: 'Shelves of ancient books surround you. A mysterious book glows on a pedestal.',
    exits: { west: 'hallway' },
    items: ['glowing-book', 'ladder'],
  },
  kitchen: {
    name: 'Kitchen',
    description: 'An old kitchen with a fireplace. Something smells delicious.',
    exits: { east: 'hallway' },
    items: ['bread', 'knife'],
  },
};

export class TextAdventureGame {
  private currentRoom: string = 'start';
  private inventory: string[] = [];
  private score: number = 0;
  private moves: number = 0;

  constructor() {
    logger.info('Text Adventure game initialized');
  }

  /**
   * Get current game state
   */
  getState(): GameState {
    const room = ROOMS[this.currentRoom];

    return {
      name: 'Text Adventure',
      mode: 'text-adventure',
      status: 'playing',
      currentAction: null,
      lastUpdate: new Date(),
      metadata: {
        currentRoom: this.currentRoom,
        roomName: room.name,
        description: room.description,
        availableExits: Object.keys(room.exits),
        itemsInRoom: room.items,
        inventory: this.inventory,
        score: this.score,
        moves: this.moves,
      },
    };
  }

  /**
   * Execute a game action
   */
  executeAction(action: GameAction): string {
    this.moves++;

    logger.debug('Executing action', {
      type: action.type,
      target: action.target,
      moves: this.moves,
    });

    switch (action.type) {
      case 'move':
        return this.move(action.target || '');

      case 'interact':
        return this.interact(action.target || '');

      case 'speak':
        return this.speak(action.target || '');

      case 'analyze':
        return this.analyze();

      case 'wait':
        return 'You wait and observe your surroundings.';

      default:
        return 'You ponder what to do next.';
    }
  }

  /**
   * Move in a direction
   */
  private move(direction: string): string {
    const room = ROOMS[this.currentRoom];
    const normalizedDirection = direction.toLowerCase();

    if (room.exits[normalizedDirection]) {
      this.currentRoom = room.exits[normalizedDirection];
      const newRoom = ROOMS[this.currentRoom];

      logger.info('Moved to new room', {
        direction,
        newRoom: newRoom.name,
      });

      return `You move ${direction}. ${newRoom.description}`;
    }

    return `You can't go ${direction} from here.`;
  }

  /**
   * Interact with an item
   */
  private interact(itemName: string): string {
    const room = ROOMS[this.currentRoom];
    const normalizedItem = itemName.toLowerCase();

    // Check if item is in room
    if (room.items.includes(normalizedItem)) {
      // Remove from room and add to inventory
      room.items = room.items.filter(item => item !== normalizedItem);
      this.inventory.push(normalizedItem);
      this.score += 10;

      logger.info('Item collected', {
        item: normalizedItem,
        score: this.score,
      });

      return `You pick up the ${normalizedItem}. You now have it in your inventory. (+10 points)`;
    }

    // Check if item is in inventory
    if (this.inventory.includes(normalizedItem)) {
      return `You examine the ${normalizedItem} in your inventory. It might be useful.`;
    }

    return `There is no ${normalizedItem} here.`;
  }

  /**
   * Speak or narrate
   */
  private speak(message: string): string {
    logger.debug('AI spoke', { message });
    return `You say: "${message}"`;
  }

  /**
   * Analyze current situation
   */
  private analyze(): string {
    const room = ROOMS[this.currentRoom];

    const parts = [
      `Current location: ${room.name}`,
      `Description: ${room.description}`,
      `Exits: ${Object.keys(room.exits).join(', ')}`,
      `Items here: ${room.items.length > 0 ? room.items.join(', ') : 'none'}`,
      `Inventory: ${this.inventory.length > 0 ? this.inventory.join(', ') : 'empty'}`,
      `Score: ${this.score}`,
      `Moves: ${this.moves}`,
    ];

    return parts.join('\n');
  }

  /**
   * Reset the game
   */
  reset() {
    this.currentRoom = 'start';
    this.inventory = [];
    this.score = 0;
    this.moves = 0;

    // Reset room items
    ROOMS.start.items = ['chest', 'torch'];
    ROOMS.hallway.items = ['painting'];
    ROOMS.library.items = ['glowing-book', 'ladder'];
    ROOMS.kitchen.items = ['bread', 'knife'];

    logger.info('Game reset');
  }

  /**
   * Get game summary for AI context
   */
  getSummary(): string {
    const room = ROOMS[this.currentRoom];

    return `You are in the ${room.name}. ${room.description}\n` +
      `Available exits: ${Object.keys(room.exits).join(', ')}\n` +
      `Items you can see: ${room.items.join(', ') || 'none'}\n` +
      `Your inventory: ${this.inventory.join(', ') || 'empty'}\n` +
      `Score: ${this.score} | Moves: ${this.moves}`;
  }
}

// Singleton instance
export const textAdventure = new TextAdventureGame();
