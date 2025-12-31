/**
 * Action Commentary System
 * 
 * Generates stream-of-consciousness commentary for every action,
 * making NeuralTau feel like a real streamer who talks constantly.
 * 
 * Includes voice collision prevention to avoid overlapping audio.
 */

import { Logger } from '@tau/shared';
import { personality, randomChoice, getActionCommentary, getCatchphrase, getChatQuestion, getOpinion, likes, dislikes } from './personality.js';

const logger = new Logger('Commentary');

// Track last commentary to avoid repetition
let lastCommentary: string = '';
let lastCommentaryTime: number = 0;
const MIN_COMMENTARY_GAP = 5000; // 5 seconds between commentaries

// Track voice state for collision prevention
let voiceInProgress: boolean = false;
let lastVoiceEnd: number = 0;
const VOICE_BUFFER = 3000; // 3 second buffer after voice ends

/**
 * Check if it's safe to generate new commentary (no voice collision)
 */
export function canGenerateCommentary(): boolean {
  const now = Date.now();
  
  // Don't interrupt ongoing voice
  if (voiceInProgress) {
    return false;
  }
  
  // Wait for buffer after voice ends
  if (now - lastVoiceEnd < VOICE_BUFFER) {
    return false;
  }
  
  // Respect minimum gap
  if (now - lastCommentaryTime < MIN_COMMENTARY_GAP) {
    return false;
  }
  
  return true;
}

/**
 * Mark that voice started (called by TTS system)
 */
export function markVoiceStart(): void {
  voiceInProgress = true;
}

/**
 * Mark that voice ended (called by TTS system)
 */
export function markVoiceEnd(): void {
  voiceInProgress = false;
  lastVoiceEnd = Date.now();
}

/**
 * Check if voice is currently playing
 */
export function isVoicePlaying(): boolean {
  return voiceInProgress;
}

/**
 * Generate commentary for an action
 * Returns null if commentary should be skipped (collision, repetition, etc.)
 */
export function generateActionCommentary(
  action: string,
  target: string | undefined,
  phase: 'start' | 'success' | 'fail',
  context?: {
    health?: number;
    time?: string;
    emotion?: string;
    consecutiveFailures?: number;
  }
): string | null {
  if (!canGenerateCommentary()) {
    return null;
  }

  // 70% chance to comment on actions (don't be annoying)
  if (Math.random() > 0.7) {
    return null;
  }

  let commentary: string | null = null;

  // Get base commentary from personality
  commentary = getActionCommentary(action, phase, target);

  // Add personality flavor based on context
  if (commentary) {
    // Add emotion-based prefix sometimes
    if (context?.emotion && Math.random() > 0.7) {
      const moodMap: Record<string, 'excited' | 'frustrated' | 'scared' | 'chill'> = {
        'joy': 'excited',
        'excitement': 'excited',
        'frustration': 'frustrated',
        'anger': 'frustrated',
        'fear': 'scared',
        'satisfaction': 'chill',
        'determination': 'excited',
      };
      const mood = moodMap[context.emotion];
      if (mood) {
        const prefix = getCatchphrase(mood);
        commentary = `${prefix}, ${commentary.toLowerCase()}`;
      }
    }

    // Add opinion about target sometimes
    if (target && Math.random() > 0.8) {
      const opinion = getOpinion(target);
      if (opinion) {
        commentary = `${commentary}. ${opinion}`;
      }
    }

    // Express preference sometimes
    if (target && Math.random() > 0.85) {
      if (likes(target)) {
        commentary = `${commentary}. Love this stuff`;
      } else if (dislikes(target)) {
        commentary = `${commentary}. Not a fan but whatever`;
      }
    }
  }

  // Handle consecutive failures with personality
  if (phase === 'fail' && context?.consecutiveFailures && context.consecutiveFailures >= 2) {
    const frustrationLines = [
      "Okay this is getting annoying",
      "Why does this keep happening",
      "Chat am I doing something wrong",
      "Bro I can't with this game",
      "Third time's the charm... hopefully",
    ];
    commentary = randomChoice(frustrationLines);
  }

  // Night-specific commentary
  if (context?.time === 'night' || context?.time === 'evening') {
    if (action === 'move' && Math.random() > 0.6) {
      commentary = randomChoice(personality.nightBehavior.comments);
    }
  }

  // Avoid repetition
  if (commentary && commentary === lastCommentary) {
    return null;
  }

  if (commentary) {
    lastCommentary = commentary;
    lastCommentaryTime = Date.now();
    logger.debug('[COMMENTARY] Generated', { action, phase, commentary: commentary.substring(0, 50) });
  }

  return commentary;
}

/**
 * Generate idle/filler commentary
 * For when nothing specific is happening
 */
export function generateIdleCommentary(context: {
  time?: string;
  health?: number;
  inventory?: any[];
  recentAction?: string;
}): string | null {
  if (!canGenerateCommentary()) {
    return null;
  }

  // 50% chance to generate idle commentary
  if (Math.random() > 0.5) {
    return null;
  }

  const options: string[] = [];

  // Time-based commentary
  if (context.time === 'night') {
    options.push(...personality.nightBehavior.comments);
  } else if (context.time === 'morning') {
    options.push("New day, new opportunities", "Morning vibes", "Fresh start");
  }

  // Health commentary
  if (context.health && context.health < 10) {
    options.push("I really need food", "Running low here", "Getting dangerous");
  }

  // Random tangent
  if (Math.random() > 0.7) {
    const topic = randomChoice(personality.tangentTopics);
    options.push(`Chat, random question about ${topic}`);
  }

  // Ask chat something
  if (Math.random() > 0.6) {
    options.push(getChatQuestion());
  }

  // Running joke reference
  if (Math.random() > 0.85) {
    options.push(`You know, ${randomChoice(personality.runningJokes)}`);
  }

  // Pet peeve
  if (Math.random() > 0.9) {
    options.push(`I hate when ${randomChoice(personality.petPeeves)}`);
  }

  if (options.length === 0) {
    options.push(
      "Just vibing",
      "We're chilling",
      "Making progress",
      "Chat how we doing",
    );
  }

  const commentary = randomChoice(options);
  
  if (commentary === lastCommentary) {
    return null;
  }

  lastCommentary = commentary;
  lastCommentaryTime = Date.now();
  
  return commentary;
}

/**
 * Generate reaction to seeing something interesting
 */
export function generateReaction(thing: string, distance?: number): string | null {
  if (!canGenerateCommentary()) {
    return null;
  }

  const thingLower = thing.toLowerCase();
  let reaction: string | null = null;

  // Hostile mob reactions
  if (['zombie', 'skeleton', 'creeper', 'spider', 'enderman'].some(m => thingLower.includes(m))) {
    if (thingLower.includes('creeper')) {
      reaction = randomChoice([
        "CREEPER! Nonono",
        "Is that a creeper? We're leaving",
        "Creeper spotted, I'm out",
      ]);
    } else {
      reaction = randomChoice([
        `Oh there's a ${thing}`,
        `${thing} over there, staying away`,
        "Mob spotted, being careful",
      ]);
    }
  }

  // Passive mob reactions
  if (['cow', 'pig', 'sheep', 'chicken'].some(m => thingLower.includes(m))) {
    reaction = randomChoice([
      "Food!",
      `Oh nice, ${thing}`,
      "Dinner spotted",
      "We eating good tonight",
    ]);
  }

  // Wolf reaction (favorite!)
  if (thingLower.includes('wolf')) {
    reaction = randomChoice([
      "A WOLF! I want to tame it",
      "Wolves are the best, need bones",
      "Puppy!",
    ]);
  }

  // Ore reactions
  if (thingLower.includes('diamond')) {
    reaction = "DIAMONDS?! CHAT DO YOU SEE THIS";
  } else if (thingLower.includes('iron')) {
    reaction = "Iron! We need this";
  } else if (thingLower.includes('coal')) {
    reaction = "Coal, always useful";
  } else if (thingLower.includes('gold')) {
    reaction = "Gold! Fancy";
  }

  // Cave/structure reactions
  if (thingLower.includes('cave')) {
    reaction = randomChoice([
      "A cave... scary but tempting",
      "Should we go in chat?",
      "Cave time? Or nah",
    ]);
  }

  if (thingLower.includes('village')) {
    reaction = "VILLAGE! Free stuff maybe";
  }

  if (reaction && reaction !== lastCommentary) {
    lastCommentary = reaction;
    lastCommentaryTime = Date.now();
    return reaction;
  }

  return null;
}

/**
 * Generate death commentary
 */
export function generateDeathCommentary(): string {
  lastCommentaryTime = Date.now();
  return randomChoice(personality.deathReactions);
}

/**
 * Generate milestone commentary
 */
export function generateMilestoneCommentary(milestone: string): string | null {
  const reactions = personality.milestoneReactions as Record<string, string>;
  if (reactions[milestone]) {
    lastCommentaryTime = Date.now();
    return reactions[milestone];
  }
  return null;
}

export default {
  canGenerateCommentary,
  markVoiceStart,
  markVoiceEnd,
  isVoicePlaying,
  generateActionCommentary,
  generateIdleCommentary,
  generateReaction,
  generateDeathCommentary,
  generateMilestoneCommentary,
};

