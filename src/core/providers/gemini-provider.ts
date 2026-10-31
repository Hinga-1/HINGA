import { GoogleGenAI } from '@google/genai';
import { AiModelProvider, ModelRequest, ModelResponse } from '../types.ts';
import { MockModelProvider } from './mock-provider.ts';
import { resolveModelForTier } from './model-routing.ts';

export class GeminiModelProvider implements AiModelProvider {
  readonly id = 'gemini-provider';
  readonly name = 'Google Gemini AI Provider';

  private ai: GoogleGenAI | null = null;
  private apiKey: string | undefined;
  private fallbackProvider: MockModelProvider;
  private circuitBreakerTrippedUntil: number = 0;

  constructor(apiKey?: string) {
    this.fallbackProvider = new MockModelProvider();
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    if (this.apiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err) {
        console.warn('⚠️ Gemini initialization warning:', err);
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    if (Date.now() < this.circuitBreakerTrippedUntil) {
      return false;
    }
    return Boolean(this.ai && this.apiKey);
  }

  async generateText(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    // If circuit breaker is tripped due to recent network failure, fail fast to fallback
    if (Date.now() < this.circuitBreakerTrippedUntil || !this.ai) {
      const fallback = await this.fallbackProvider.generateText(request);
      return {
        ...fallback,
        latencyMs: Date.now() - startedAt,
        fallback: { used: true, providerId: this.id, reason: this.ai ? 'circuit_open' : 'provider_unavailable' },
      };
    }

    try {
      const modelName = resolveModelForTier(request.tier);

      const apiCall = this.ai.models.generateContent({
        model: modelName,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemPrompt,
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? 1500,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout ya mtandao wa Gemini API (> 3000ms)')), 3000)
      );

      const response = await Promise.race([apiCall, timeoutPromise]);

      return {
        content: response.text || '',
        model: modelName,
        latencyMs: Date.now() - startedAt,
        fallback: { used: false },
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        metadata: {
          modelVersion: response.modelVersion,
        },
      };
    } catch (err: unknown) {
      // Trip circuit breaker for 60 seconds to provide instant failover on subsequent requests
      this.circuitBreakerTrippedUntil = Date.now() + 60000;
      console.warn('⚠️ Gemini API haikupatikana (Circuit Breaker Activated):', (err as Error).message);
      const fallback = await this.fallbackProvider.generateText(request);
      return {
        ...fallback,
        latencyMs: Date.now() - startedAt,
        fallback: { used: true, providerId: this.id, reason: 'provider_error' },
      };
    }
  }
}
