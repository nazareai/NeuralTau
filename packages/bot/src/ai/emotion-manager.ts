import { EmotionType, EmotionalState, EmotionTrigger, Logger } from '@tau/shared';

const logger = new Logger('EmotionManager');

/**
 * Human-like expressions for each emotion
 */
const EMOTION_EXPRESSIONS: Record<EmotionType, string[]> = {
  joy: [
    "Yes! That worked perfectly!",
    "This is going great!",
    "Nice, got it!",
    "Awesome!",
    "Feeling good about this!",
  ],
  frustration: [
    "Ugh, come on...",
    "Why isn't this working?",
    "*sigh* Let me try again...",
    "This is getting annoying...",
    "Not again...",
  ],
  anger: [
    "This is really getting to me!",
    "I've had enough of this!",
    "Why does this keep happening?!",
    "Seriously?! Again?!",
    "I'm so done with this...",
  ],
  curiosity: [
    "Ooh, what's over there?",
    "That looks interesting...",
    "I wonder what's this way...",
    "Let me check this out...",
    "Hmm, curious...",
  ],
  fear: [
    "That was too close!",
    "I need to be careful here...",
    "This doesn't feel safe...",
    "Maybe I should back off...",
    "Getting a bad feeling about this...",
  ],
  satisfaction: [
    "Perfect, just what I needed!",
    "Mission accomplished!",
    "That's exactly what I wanted!",
    "Nailed it!",
    "Everything is coming together!",
  ],
  boredom: [
    "Same old, same old...",
    "There's got to be something else to do...",
    "This is getting repetitive...",
    "Hmm, what else could I try?",
    "*yawn* Need something new...",
  ],
  excitement: [
    "Whoa! Is that what I think it is?!",
    "No way! This is amazing!",
    "Oh wow! Look at this!",
    "This is incredible!",
    "I can't believe it!",
  ],
  determination: [
    "I'm not giving up!",
    "I'll figure this out!",
    "One more try...",
    "I can do this!",
    "Let's push through!",
  ],
};

/**
 * Emotion decay rates (per second)
 * Higher = faster decay
 */
const DECAY_RATES: Record<EmotionType, number> = {
  joy: 0.8,
  frustration: 0.3,       // Slow decay - frustration lingers
  anger: 0.5,             // Medium decay
  curiosity: 1.2,         // Fast decay - curiosity fades quickly
  fear: 1.5,              // Fast decay - fear fades when safe
  satisfaction: 0.4,      // Slow decay - satisfaction lasts
  boredom: 0.2,           // Very slow decay - boredom builds up
  excitement: 1.0,        // Medium decay
  determination: 0.3,     // Slow decay - determination persists
};

/**
 * Mood classification
 */
const POSITIVE_EMOTIONS: EmotionType[] = ['joy', 'satisfaction', 'excitement', 'curiosity'];
const NEGATIVE_EMOTIONS: EmotionType[] = ['frustration', 'anger', 'fear', 'boredom'];
const NEUTRAL_EMOTIONS: EmotionType[] = ['determination'];

/**
 * EmotionManager - Manages human-like emotional states for the bot
 *
 * Features:
 * - Multiple concurrent emotions with intensities
 * - Natural emotion decay over time
 * - Emotion triggers from game events
 * - Human-like expressions based on emotional state
 * - Mood tracking (positive/neutral/negative)
 */
export class EmotionManager {
  private emotions: Record<EmotionType, number>;
  private lastUpdate: number;
  private lastExpression: string = '';
  private expressionCooldown: number = 0;
  private consecutiveFailures: number = 0;
  private lastActionType: string = '';
  private repetitionCount: number = 0;

  constructor() {
    // Initialize all emotions at 0
    this.emotions = {
      joy: 0,
      frustration: 0,
      anger: 0,
      curiosity: 30,  // Start slightly curious
      fear: 0,
      satisfaction: 0,
      boredom: 0,
      excitement: 0,
      determination: 20,  // Start with some determination
    };
    this.lastUpdate = Date.now();

    logger.info('EmotionManager initialized');
  }

  /**
   * Process a game event and update emotional state
   */
  trigger(trigger: EmotionTrigger): void {
    const { type, intensity, source } = trigger;

    logger.debug('Emotion trigger received', { type, intensity, source });

    switch (type) {
      case 'success':
        this.adjustEmotion('joy', intensity * 0.8);
        this.adjustEmotion('satisfaction', intensity * 0.5);
        this.adjustEmotion('determination', intensity * 0.3);
        // Success reduces negative emotions
        this.adjustEmotion('frustration', -intensity * 0.6);
        this.adjustEmotion('anger', -intensity * 0.4);
        this.adjustEmotion('boredom', -intensity * 0.3);
        this.consecutiveFailures = 0;
        break;

      case 'failure':
        this.consecutiveFailures++;
        this.adjustEmotion('frustration', intensity * 0.6);

        // Multiple failures lead to anger
        if (this.consecutiveFailures >= 3) {
          this.adjustEmotion('anger', intensity * 0.5 * (this.consecutiveFailures / 3));
        }

        // But also builds determination
        this.adjustEmotion('determination', intensity * 0.3);
        this.adjustEmotion('joy', -intensity * 0.4);
        break;

      case 'danger':
        this.adjustEmotion('fear', intensity * 0.8);
        this.adjustEmotion('curiosity', -intensity * 0.3);
        this.adjustEmotion('boredom', -intensity * 0.5);
        break;

      case 'discovery':
        this.adjustEmotion('curiosity', intensity * 0.7);
        this.adjustEmotion('excitement', intensity * 0.6);
        this.adjustEmotion('boredom', -intensity * 0.8);
        break;

      case 'repetition':
        this.adjustEmotion('boredom', intensity * 0.5);
        this.adjustEmotion('curiosity', -intensity * 0.2);
        this.adjustEmotion('excitement', -intensity * 0.3);
        break;

      case 'damage':
        this.adjustEmotion('fear', intensity * 0.6);
        this.adjustEmotion('anger', intensity * 0.4);
        this.adjustEmotion('joy', -intensity * 0.5);
        break;

      case 'achievement':
        this.adjustEmotion('satisfaction', intensity * 1.0);
        this.adjustEmotion('joy', intensity * 0.8);
        this.adjustEmotion('excitement', intensity * 0.6);
        this.adjustEmotion('determination', intensity * 0.4);
        // Achievement clears most negative emotions
        this.adjustEmotion('frustration', -intensity * 0.8);
        this.adjustEmotion('anger', -intensity * 0.8);
        this.adjustEmotion('boredom', -intensity * 1.0);
        this.consecutiveFailures = 0;
        break;
    }

    this.lastUpdate = Date.now();
  }

  /**
   * Track action repetition for boredom detection
   */
  trackAction(actionType: string): void {
    if (actionType === this.lastActionType) {
      this.repetitionCount++;
      if (this.repetitionCount >= 5) {
        this.trigger({
          type: 'repetition',
          intensity: Math.min(50, this.repetitionCount * 5),
          source: `Repeated ${actionType} ${this.repetitionCount} times`,
        });
      }
    } else {
      this.lastActionType = actionType;
      this.repetitionCount = 1;
    }
  }

  /**
   * Adjust a specific emotion by amount (can be negative)
   */
  private adjustEmotion(emotion: EmotionType, amount: number): void {
    this.emotions[emotion] = Math.max(0, Math.min(100, this.emotions[emotion] + amount));
  }

  /**
   * Apply natural emotion decay over time
   */
  private applyDecay(): void {
    const now = Date.now();
    const deltaSeconds = (now - this.lastUpdate) / 1000;

    // Only decay if more than 1 second has passed
    if (deltaSeconds < 1) return;

    for (const emotion of Object.keys(this.emotions) as EmotionType[]) {
      const decayRate = DECAY_RATES[emotion];
      const decay = decayRate * deltaSeconds;

      // Decay towards baseline (slight curiosity and determination)
      const baseline = emotion === 'curiosity' ? 20 : emotion === 'determination' ? 15 : 0;

      if (this.emotions[emotion] > baseline) {
        this.emotions[emotion] = Math.max(baseline, this.emotions[emotion] - decay);
      } else if (this.emotions[emotion] < baseline) {
        this.emotions[emotion] = Math.min(baseline, this.emotions[emotion] + decay * 0.5);
      }
    }

    this.lastUpdate = now;
  }

  /**
   * Get the current dominant emotion
   */
  getDominant(): { type: EmotionType; intensity: number } {
    this.applyDecay();

    let dominant: EmotionType = 'curiosity';
    let maxIntensity = 0;

    for (const [emotion, intensity] of Object.entries(this.emotions) as [EmotionType, number][]) {
      if (intensity > maxIntensity) {
        maxIntensity = intensity;
        dominant = emotion;
      }
    }

    return { type: dominant, intensity: maxIntensity };
  }

  /**
   * Get the current mood (positive/neutral/negative)
   */
  getMood(): 'positive' | 'neutral' | 'negative' {
    this.applyDecay();

    let positiveSum = 0;
    let negativeSum = 0;

    for (const emotion of POSITIVE_EMOTIONS) {
      positiveSum += this.emotions[emotion];
    }
    for (const emotion of NEGATIVE_EMOTIONS) {
      negativeSum += this.emotions[emotion];
    }

    const threshold = 30;
    if (positiveSum - negativeSum > threshold) return 'positive';
    if (negativeSum - positiveSum > threshold) return 'negative';
    return 'neutral';
  }

  /**
   * Get a human-like expression based on current emotional state
   * Returns null if on cooldown to avoid spamming
   */
  getExpression(): string | null {
    const now = Date.now();

    // Cooldown between expressions (8-15 seconds randomly)
    if (now < this.expressionCooldown) {
      return null;
    }

    const { type: dominant, intensity } = this.getDominant();

    // Only express if emotion is strong enough (>30)
    if (intensity < 30) {
      return null;
    }

    // Get expressions for this emotion
    const expressions = EMOTION_EXPRESSIONS[dominant];

    // Pick a random expression, avoiding the last one
    let expression: string;
    do {
      expression = expressions[Math.floor(Math.random() * expressions.length)];
    } while (expression === this.lastExpression && expressions.length > 1);

    this.lastExpression = expression;

    // Set cooldown (longer for less intense emotions)
    const cooldownMs = 8000 + Math.random() * 7000 + (100 - intensity) * 50;
    this.expressionCooldown = now + cooldownMs;

    return expression;
  }

  /**
   * Get the full emotional state for broadcasting/display
   */
  getState(): EmotionalState {
    this.applyDecay();

    const { type: dominant, intensity: dominantIntensity } = this.getDominant();
    const mood = this.getMood();

    // Get an expression (or use a neutral one)
    let expression = this.getExpression();
    if (!expression) {
      expression = this.lastExpression || '';
    }

    return {
      emotions: { ...this.emotions },
      dominant,
      dominantIntensity,
      mood,
      expression,
      timestamp: Date.now(),
    };
  }

  /**
   * Get emotional context for AI decision making
   */
  getContextForAI(): string {
    const state = this.getState();
    const lines: string[] = [];

    lines.push(`Current mood: ${state.mood}`);
    lines.push(`Feeling: ${state.dominant} (${Math.round(state.dominantIntensity)}%)`);

    // Add relevant emotional context
    if (state.emotions.frustration > 40) {
      lines.push(`Frustrated - should try a different approach`);
    }
    if (state.emotions.anger > 50) {
      lines.push(`Angry - recent failures are really bothering me`);
    }
    if (state.emotions.fear > 40) {
      lines.push(`Anxious - should prioritize safety`);
    }
    if (state.emotions.boredom > 50) {
      lines.push(`Bored - looking for something new to do`);
    }
    if (state.emotions.excitement > 40) {
      lines.push(`Excited - want to explore more!`);
    }
    if (state.emotions.determination > 60) {
      lines.push(`Determined - won't give up easily`);
    }

    return lines.join('\n');
  }

  /**
   * Force set an emotion (for testing/special events)
   */
  setEmotion(emotion: EmotionType, intensity: number): void {
    this.emotions[emotion] = Math.max(0, Math.min(100, intensity));
    this.lastUpdate = Date.now();
    logger.info('Emotion manually set', { emotion, intensity });
  }

  /**
   * Reset all emotions to baseline
   */
  reset(): void {
    this.emotions = {
      joy: 0,
      frustration: 0,
      anger: 0,
      curiosity: 30,
      fear: 0,
      satisfaction: 0,
      boredom: 0,
      excitement: 0,
      determination: 20,
    };
    this.consecutiveFailures = 0;
    this.repetitionCount = 0;
    this.lastUpdate = Date.now();
    logger.info('Emotions reset to baseline');
  }
}

// Singleton instance
export const emotionManager = new EmotionManager();
