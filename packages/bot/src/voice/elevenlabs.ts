import axios, { AxiosInstance } from 'axios';
import { Logger, retry } from '@tau/shared';
import { config } from '../config.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

const logger = new Logger('ElevenLabs');

export class ElevenLabsClient {
  private client: AxiosInstance;
  private voiceId: string;
  private outputDir: string;

  constructor() {
    if (!config.voice.apiKey) {
      logger.warn('ElevenLabs API key not provided, TTS will be disabled');
    }

    this.client = axios.create({
      baseURL: 'https://api.elevenlabs.io/v1',
      headers: {
        'xi-api-key': config.voice.apiKey,
        'Content-Type': 'application/json',
      },
    });

    this.voiceId = config.voice.voiceId || '';
    this.outputDir = join(process.cwd(), 'audio');

    logger.info('ElevenLabs client initialized', {
      voiceId: this.voiceId ? 'configured' : 'not configured',
    });
  }

  /**
   * Convert text to speech and return audio buffer
   */
  async textToSpeech(text: string): Promise<Buffer> {
    if (!config.voice.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    if (!this.voiceId) {
      throw new Error('Voice ID not configured');
    }

    logger.debug('Converting text to speech', {
      textLength: text.length,
      voiceId: this.voiceId,
    });

    try {
      const response = await retry(
        async () => {
          const res = await this.client.post(
            `/text-to-speech/${this.voiceId}`,
            {
              text,
              model_id: 'eleven_monolingual_v1',
              voice_settings: {
                stability: config.voice.stability,
                similarity_boost: config.voice.similarityBoost,
              },
            },
            {
              responseType: 'arraybuffer',
            }
          );
          return res.data;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: true,
          onRetry: (attempt, error) => {
            logger.warn(`TTS retry attempt ${attempt}`, {
              error: error.message,
            });
          },
        }
      );

      logger.info('Text-to-speech conversion successful', {
        audioSize: response.byteLength,
      });

      return Buffer.from(response);
    } catch (error) {
      logger.error('Text-to-speech conversion failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Convert text to speech and save to file
   */
  async textToSpeechFile(text: string, filename: string): Promise<string> {
    const audioBuffer = await this.textToSpeech(text);
    const outputPath = join(this.outputDir, filename);

    await writeFile(outputPath, audioBuffer);

    logger.info('Audio file saved', { path: outputPath });

    return outputPath;
  }

  /**
   * Get available voices from ElevenLabs
   */
  async getVoices(): Promise<any[]> {
    if (!config.voice.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    try {
      const response = await this.client.get('/voices');
      const voices = response.data.voices;

      logger.info(`Retrieved ${voices.length} available voices`);

      return voices;
    } catch (error) {
      logger.error('Failed to get voices', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Set voice ID at runtime
   */
  setVoiceId(voiceId: string) {
    logger.info('Changing voice ID', {
      from: this.voiceId,
      to: voiceId,
    });
    this.voiceId = voiceId;
  }

  /**
   * Get current voice ID
   */
  getVoiceId(): string {
    return this.voiceId;
  }

  /**
   * Check if TTS is configured and ready
   */
  isConfigured(): boolean {
    return !!(config.voice.apiKey && this.voiceId);
  }
}

// Singleton instance
export const elevenLabsClient = new ElevenLabsClient();
