import axios, { AxiosInstance } from 'axios';
import { AIMessage, AIResponse, VisionAnalysis, Logger, retry } from '@tau/shared';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = new Logger('OpenRouter');

// Prompt logging configuration - logs go to project folder
const PROMPT_LOG_ENABLED = process.env.LOG_PROMPTS === 'true';
const LOGS_DIR = path.join(process.cwd(), 'logs');
const PROMPT_LOG_FILE = path.join(LOGS_DIR, 'prompts.log');

// Ensure logs directory exists in project folder
if (PROMPT_LOG_ENABLED) {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    logger.info('Prompt logging enabled', { logFile: PROMPT_LOG_FILE });
  } catch (err) {
    logger.warn('Failed to create prompt log directory', { error: err });
  }
}

/**
 * Log prompts AND response to file for debugging
 */
function logPrompt(
  messages: AIMessage[],
  options: any,
  tokens?: { prompt: number; completion: number; total: number },
  response?: string
) {
  if (!PROMPT_LOG_ENABLED) return;

  try {
    const timestamp = new Date().toISOString();
    const totalChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);

    let logEntry = `\n${'='.repeat(80)}\n`;
    logEntry += `[${timestamp}]\n`;
    logEntry += `Model: ${options.model || config.ai.defaultModel}\n`;
    logEntry += `Max Tokens: ${options.maxTokens || config.ai.maxTokens}\n`;
    logEntry += `Temperature: ${options.temperature ?? config.ai.temperature}\n`;
    logEntry += `Total Chars: ${totalChars}\n`;
    if (tokens) {
      logEntry += `Tokens - Prompt: ${tokens.prompt}, Completion: ${tokens.completion}, Total: ${tokens.total}\n`;
    }
    logEntry += `${'='.repeat(80)}\n\n`;

    messages.forEach((msg, i) => {
      logEntry += `--- [${msg.role.toUpperCase()}] (${typeof msg.content === 'string' ? msg.content.length : 'multipart'} chars) ---\n`;
      logEntry += typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      logEntry += '\n\n';
    });

    // Log AI response
    if (response) {
      logEntry += `--- [RESPONSE] (${response.length} chars) ---\n`;
      logEntry += response;
      logEntry += '\n\n';
    }

    fs.appendFileSync(PROMPT_LOG_FILE, logEntry);
  } catch (err) {
    logger.warn('Failed to write prompt log', { error: err });
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterClient {
  private client: AxiosInstance;
  private defaultModel: string;
  private visionModel: string;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${config.ai.apiKey}`,
        'HTTP-Referer': 'https://github.com/tau-streamer',
        'X-Title': 'NeuralTau - Autonomous AI Streamer',
        'Content-Type': 'application/json',
      },
    });

    this.defaultModel = config.ai.defaultModel;
    this.visionModel = config.ai.visionModel;

    logger.info('OpenRouter client initialized', {
      defaultModel: this.defaultModel,
      visionModel: this.visionModel,
    });
  }

  /**
   * Send a chat completion request to OpenRouter
   */
  async chat(
    messages: AIMessage[],
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      reasoning?: {
        effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
        max_tokens?: number;
        exclude?: boolean;
        enabled?: boolean;
      };
    } = {}
  ): Promise<AIResponse> {
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || config.ai.maxTokens;
    const temperature = options.temperature ?? config.ai.temperature;

    logger.debug('Sending chat request', {
      model,
      messageCount: messages.length,
      maxTokens,
      temperature,
      reasoning: options.reasoning,
    });

    try {
      const response = await retry(
        async () => {
          const requestBody: any = {
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
          };

          // Add reasoning configuration if provided
          if (options.reasoning) {
            requestBody.reasoning = options.reasoning;
          }

          const res = await this.client.post<OpenRouterResponse>('/chat/completions', requestBody);
          return res.data;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: true,
          onRetry: (attempt, error) => {
            logger.warn(`Retry attempt ${attempt} after error`, {
              error: error.message,
            });
          },
        }
      );

      const content = response.choices[0]?.message?.content || '';
      const usage = response.usage;

      const duration = Date.now() - (Date.now() - 1); // Will be calculated properly in caller

      logger.info('Chat request successful', {
        model: response.model,
        tokensUsed: usage.total_tokens,
        finishReason: response.choices[0]?.finish_reason,
      });

      const tokens = {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
      };

      // Log prompt AND response for debugging
      logPrompt(messages, options, tokens, content);

      return {
        content,
        model: response.model,
        tokens,
      };
    } catch (error) {
      logger.error('Chat request failed', {
        error: error instanceof Error ? error.message : String(error),
        model,
      });
      throw error;
    }
  }

  /**
   * Analyze an image using vision model
   */
  async analyzeImage(
    imageUrl: string,
    prompt: string = 'Describe what you see in this image in detail.'
  ): Promise<VisionAnalysis> {
    logger.debug('Analyzing image with vision model', {
      model: this.visionModel,
      promptLength: prompt.length,
    });

    try {
      const messages: OpenRouterMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ];

      const response = await retry(
        async () => {
          const res = await this.client.post<OpenRouterResponse>('/chat/completions', {
            model: this.visionModel,
            messages,
            max_tokens: 1024,
            temperature: 0.7,
          });
          return res.data;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: true,
          onRetry: (attempt, error) => {
            logger.warn(`Vision retry attempt ${attempt}`, {
              error: error.message,
            });
          },
        }
      );

      const content = response.choices[0]?.message?.content || '';

      logger.info('Vision analysis successful', {
        model: response.model,
        tokensUsed: response.usage.total_tokens,
      });

      // Parse the response to extract structured information
      // For now, we'll return the raw content as description
      return {
        description: content,
        suggestions: [], // Could be enhanced to extract suggestions from content
        confidence: 0.8, // Could be enhanced with actual confidence scoring
      };
    } catch (error) {
      logger.error('Vision analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Analyze multiple images using vision model (for stuck recovery)
   * Sends all images in a single request for efficiency
   */
  async analyzeMultipleImages(
    images: { label: string; dataUrl: string }[],
    prompt: string,
    maxTokens: number = 1024
  ): Promise<VisionAnalysis> {
    logger.info('Analyzing multiple images with vision model', {
      model: this.visionModel,
      imageCount: images.length,
      promptLength: prompt.length,
    });

    try {
      // Build content array with text prompt followed by all images
      const content: any[] = [
        {
          type: 'text',
          text: prompt,
        },
      ];

      // Add each image with its label
      for (const img of images) {
        content.push({
          type: 'text',
          text: `[${img.label} view]:`,
        });
        content.push({
          type: 'image_url',
          image_url: {
            url: img.dataUrl,
          },
        });
      }

      const messages: OpenRouterMessage[] = [
        {
          role: 'user',
          content,
        },
      ];

      const response = await retry(
        async () => {
          const res = await this.client.post<OpenRouterResponse>('/chat/completions', {
            model: this.visionModel,
            messages,
            max_tokens: maxTokens,
            temperature: 0.3, // Lower temp for analytical/problem-solving
          });
          return res.data;
        },
        {
          maxAttempts: 2, // Only 2 attempts for vision (expensive)
          delayMs: 2000,
          backoff: true,
          onRetry: (attempt, error) => {
            logger.warn(`Multi-image vision retry attempt ${attempt}`, {
              error: error.message,
            });
          },
        }
      );

      const responseContent = response.choices[0]?.message?.content || '';

      logger.info('Multi-image vision analysis successful', {
        model: response.model,
        tokensUsed: response.usage.total_tokens,
        imageCount: images.length,
      });

      return {
        description: responseContent,
        suggestions: [],
        confidence: 0.85,
      };
    } catch (error) {
      logger.error('Multi-image vision analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        imageCount: images.length,
      });
      throw error;
    }
  }

  /**
   * Get available models from OpenRouter
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/models');
      const models = response.data.data.map((model: any) => model.id);
      logger.info(`Retrieved ${models.length} available models`);
      return models;
    } catch (error) {
      logger.error('Failed to get models', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Change the default model at runtime
   */
  setDefaultModel(model: string) {
    logger.info('Changing default model', {
      from: this.defaultModel,
      to: model,
    });
    this.defaultModel = model;
  }

  /**
   * Change the vision model at runtime
   */
  setVisionModel(model: string) {
    logger.info('Changing vision model', {
      from: this.visionModel,
      to: model,
    });
    this.visionModel = model;
  }

  /**
   * Get current model configuration
   */
  getModelConfig() {
    return {
      defaultModel: this.defaultModel,
      visionModel: this.visionModel,
    };
  }
}

// Singleton instance
export const openRouterClient = new OpenRouterClient();
