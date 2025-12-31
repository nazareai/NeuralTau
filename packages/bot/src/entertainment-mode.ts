/**
 * Entertainment Mode
 * 
 * Makes the AI streamer more entertaining by occasionally:
 * - Taking scenic detours
 * - Getting distracted by random things
 * - Making intentionally dumb/funny decisions
 * - Creating self-imposed challenges
 * - Asking chat for input
 * 
 * Philosophy: Best streamers aren't best players - they're most entertaining.
 */

import { Logger } from '@tau/shared';
import { personality, randomChoice, getChatQuestion } from './personality.js';

const logger = new Logger('Entertainment');

// Entertainment mode configuration
export const entertainmentConfig = {
  enabled: true,
  
  // Probability of entertainment behaviors (0-1)
  distractionChance: 0.15,      // 15% chance to get distracted
  tangentChance: 0.10,          // 10% chance for random tangent
  dumbDecisionChance: 0.08,     // 8% chance for intentionally dumb choice
  challengeChance: 0.05,        // 5% chance to propose challenge
  chatQuestionChance: 0.20,     // 20% chance to ask chat something
  investigateChance: 0.12,      // 12% chance to investigate random things
};

interface EntertainmentSuggestion {
  type: 'distraction' | 'tangent' | 'dumb' | 'challenge' | 'question' | 'investigate';
  action?: { type: string; target: string; reasoning: string };
  commentary: string;
}

/**
 * Check if we should trigger entertainment behavior
 */
export function shouldTriggerEntertainment(): boolean {
  if (!entertainmentConfig.enabled) return false;
  
  // Overall 30% chance for any entertainment behavior
  return Math.random() < 0.30;
}

/**
 * Generate an entertainment suggestion
 * May suggest an alternative action or just commentary
 */
export function generateEntertainmentSuggestion(
  context: {
    currentAction?: { type: string; target?: string };
    nearbyEntities?: string[];
    nearbyBlocks?: string[];
    time?: string;
    health?: number;
    recentActions?: string[];
  }
): EntertainmentSuggestion | null {
  if (!entertainmentConfig.enabled) return null;

  const roll = Math.random();
  let cumulative = 0;

  // Check each entertainment type
  
  // 1. Distraction - notice something and comment
  cumulative += entertainmentConfig.distractionChance;
  if (roll < cumulative) {
    return generateDistraction(context);
  }

  // 2. Random tangent - talk about something unrelated
  cumulative += entertainmentConfig.tangentChance;
  if (roll < cumulative) {
    return generateTangent();
  }

  // 3. Dumb decision - suggest something funny/inefficient
  cumulative += entertainmentConfig.dumbDecisionChance;
  if (roll < cumulative) {
    return generateDumbDecision(context);
  }

  // 4. Challenge - propose a self-imposed challenge
  cumulative += entertainmentConfig.challengeChance;
  if (roll < cumulative) {
    return generateChallenge(context);
  }

  // 5. Chat question - engage viewers
  cumulative += entertainmentConfig.chatQuestionChance;
  if (roll < cumulative) {
    return generateChatEngagement();
  }

  // 6. Investigate - look at random interesting thing
  cumulative += entertainmentConfig.investigateChance;
  if (roll < cumulative) {
    return generateInvestigation(context);
  }

  return null;
}

/**
 * Generate a distraction
 */
function generateDistraction(context: any): EntertainmentSuggestion | null {
  const distractions = [
    { commentary: "Wait what was that", action: null },
    { commentary: "Hold up, did you guys see that?", action: null },
    { commentary: "Okay I got distracted, what was I doing", action: null },
    { commentary: "Ooh shiny", action: null },
  ];

  // Entity-specific distractions
  if (context.nearbyEntities?.length > 0) {
    const entity = context.nearbyEntities[0];
    if (entity.includes('wolf')) {
      return {
        type: 'distraction',
        commentary: "WAIT IS THAT A WOLF I need to tame it",
        action: { type: 'move', target: 'wolf', reasoning: 'Must befriend wolf' },
      };
    }
    if (entity.includes('cat') || entity.includes('ocelot')) {
      return {
        type: 'distraction',
        commentary: "A cat! Here kitty kitty",
        action: undefined,
      };
    }
  }

  const distraction = randomChoice(distractions);
  return {
    type: 'distraction',
    commentary: distraction.commentary,
    action: distraction.action || undefined,
  };
}

/**
 * Generate a random tangent (talk about something unrelated)
 */
function generateTangent(): EntertainmentSuggestion {
  const tangents = [
    "Chat, random thought - what's the best pizza topping?",
    "Okay hear me out, pineapple on pizza is actually good",
    "Speaking of which, what are y'all eating right now?",
    "Bro I'm so tired, been grinding all day",
    "What time is it for you guys?",
    "I need new music recommendations, drop some in chat",
    "Hot take: Minecraft is better than Fortnite. Discuss.",
    "You guys ever just zone out for like 5 minutes?",
    "What's everyone's weekend plans?",
    "I should probably drink water, chat remind me",
    "Random question: cats or dogs?",
    "I've been craving tacos all day",
  ];

  return {
    type: 'tangent',
    commentary: randomChoice(tangents),
  };
}

/**
 * Generate intentionally dumb/funny decision
 */
function generateDumbDecision(context: any): EntertainmentSuggestion | null {
  const dumbIdeas = [
    {
      commentary: "What if I just... punch this tree with my bare hands",
      action: { type: 'mine', target: 'oak_log', reasoning: 'Being dramatic about hand mining' },
    },
    {
      commentary: "I'm gonna build a dirt house, chat trust the process",
      action: { type: 'place', target: 'dirt', reasoning: 'Building iconic dirt house' },
    },
    {
      commentary: "Okay I'm just gonna walk in a random direction and see what happens",
      action: { type: 'move', target: randomChoice(['north', 'south', 'east', 'west']), reasoning: 'Chaos walk' },
    },
    {
      commentary: "You know what, let's reorganize inventory. Very important.",
      action: null,
    },
    {
      commentary: "I'm gonna try to befriend this mob. It'll definitely work.",
      action: null,
    },
  ];

  // Don't suggest dumb things when health is low
  if (context.health && context.health < 10) {
    return null;
  }

  const idea = randomChoice(dumbIdeas);
  return {
    type: 'dumb',
    commentary: idea.commentary,
    action: idea.action || undefined,
  };
}

/**
 * Generate a self-imposed challenge
 */
function generateChallenge(context: any): EntertainmentSuggestion {
  const challenges = [
    "Chat, challenge accepted: no crafting table for 5 minutes",
    "Okay new rule: I can only go left from now on",
    "Speed challenge: get stone tools in 2 minutes, let's go",
    "No looking at inventory challenge starts now",
    "I'm only gonna mine oak wood, no birch. Oak gang.",
    "Permadeath mode activated... jk I'd lose immediately",
    "No sprinting challenge, gotta save that hunger bar",
  ];

  return {
    type: 'challenge',
    commentary: randomChoice(challenges),
  };
}

/**
 * Generate chat engagement
 */
function generateChatEngagement(): EntertainmentSuggestion {
  const engagements = [
    getChatQuestion(),
    "Alright chat, make the call",
    "What should we do next? Wrong answers only",
    "Rate my gameplay 1-10, be honest",
    "Who's been here the longest? OGs in chat",
    "Drop a W in chat if you're vibing",
    "Lurkers, this is your moment to say hi",
    "First person to guess what I do next gets a shoutout",
    "Chat, I need your energy right now",
    "Type 1 if you think I'll survive tonight, 2 if I'm cooked",
  ];

  return {
    type: 'question',
    commentary: randomChoice(engagements),
  };
}

/**
 * Generate investigation suggestion
 */
function generateInvestigation(context: any): EntertainmentSuggestion | null {
  if (!context.nearbyBlocks || context.nearbyBlocks.length === 0) {
    return {
      type: 'investigate',
      commentary: "Let me look around real quick",
      action: { type: 'move', target: randomChoice(['north', 'east']), reasoning: 'Exploring' },
    };
  }

  const interestingBlocks = ['cave', 'water', 'lava', 'flower', 'mushroom', 'sand'];
  const found = context.nearbyBlocks.find((b: string) => 
    interestingBlocks.some(i => b.toLowerCase().includes(i))
  );

  if (found) {
    return {
      type: 'investigate',
      commentary: `Ooh what's over there? Let me check out this ${found}`,
      action: { type: 'move', target: found, reasoning: 'Investigating interesting thing' },
    };
  }

  return {
    type: 'investigate',
    commentary: "Let me see what's this way",
    action: { type: 'move', target: randomChoice(['north', 'south', 'east', 'west']), reasoning: 'Curious exploration' },
  };
}

/**
 * Check if action should be overridden for entertainment
 * Returns alternative action if so, null otherwise
 */
export function maybeOverrideAction(
  originalAction: { type: string; target?: string },
  context: any
): { action: { type: string; target: string; reasoning: string }; commentary: string } | null {
  if (!entertainmentConfig.enabled) return null;
  
  // Only override sometimes (10% chance)
  if (Math.random() > 0.10) return null;

  // Don't override critical actions
  if (originalAction.type === 'eat' || originalAction.type === 'flee') {
    return null;
  }

  // Don't override when health is low
  if (context.health && context.health < 10) {
    return null;
  }

  const suggestion = generateEntertainmentSuggestion(context);
  if (suggestion?.action) {
    logger.info('[ENTERTAINMENT] Overriding action for fun', {
      original: originalAction.type,
      new: suggestion.action.type,
    });
    return {
      action: suggestion.action,
      commentary: suggestion.commentary,
    };
  }

  return null;
}

/**
 * Enable/disable entertainment mode
 */
export function setEntertainmentMode(enabled: boolean): void {
  entertainmentConfig.enabled = enabled;
  logger.info('Entertainment mode', { enabled });
}

/**
 * Adjust entertainment intensity (0-1, where 1 is max chaos)
 */
export function setEntertainmentIntensity(intensity: number): void {
  const clamped = Math.max(0, Math.min(1, intensity));
  
  entertainmentConfig.distractionChance = 0.15 * clamped;
  entertainmentConfig.tangentChance = 0.10 * clamped;
  entertainmentConfig.dumbDecisionChance = 0.08 * clamped;
  entertainmentConfig.challengeChance = 0.05 * clamped;
  entertainmentConfig.chatQuestionChance = 0.20 * clamped;
  entertainmentConfig.investigateChance = 0.12 * clamped;
  
  logger.info('Entertainment intensity set', { intensity: clamped });
}

export default {
  shouldTriggerEntertainment,
  generateEntertainmentSuggestion,
  maybeOverrideAction,
  setEntertainmentMode,
  setEntertainmentIntensity,
  entertainmentConfig,
};

