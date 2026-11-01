import { GoogleGenAI } from '@google/genai';
import { AiModelProvider, ModelRequest, ModelResponse, TokenUsage } from '../types.ts';
import { MockModelProvider } from './mock-provider.ts';
import { resolveModelForTier } from './model-routing.ts';
import { estimateCostUsd, PriceSnapshot, ProviderAttempt, UsageLedger } from './usage.ts';

const DEFAULT_TIMEOUT_MS = 3000;

export interface GeminiProviderOptions {
  /** Ledger zinayo kila attempt ya provider: success, fallback, timeout na error. */
  ledger?: UsageLedger;
  /**
   * Price snapshots za soko. Snapshot yenye `modelId` inahesabiwa kwa model yake pekee;
   * snapshot bila `modelId` ni generic ya provider. Ikiwa hakuna pigo linalolingana,
   * attempt inabaki bila cost badala ya kubuni thamani.
   */
  prices?: PriceSnapshot[];
}

/**
 * Deadline inayobaki kwa request hii, kwa milliseconds.
 * - `request.deadlineAt` (epoch ms) ipo: tumia muda uliobaki.
 * - Haipo: tumia default.
 * Thamani <= 0 ina maana deadline tayari imepita; Infinity/NaN inarudisha default.
 */
export function deadlineTimeoutMs(request: Pick<ModelRequest, 'deadlineAt'>, now: number = Date.now()): number {
  const deadlineAt = request.deadlineAt;
  if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt)) {
    return DEFAULT_TIMEOUT_MS;
  }
  const remaining = deadlineAt - now;
  if (!Number.isFinite(remaining)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return remaining;
}

export class GeminiModelProvider implements AiModelProvider {
  readonly id = 'gemini-provider';
  readonly name = 'Google Gemini AI Provider';

  private ai: GoogleGenAI | null = null;
  private apiKey: string | undefined;
  private fallbackProvider: MockModelProvider;
  private circuitBreakerTrippedUntil: number = 0;
  private ledger: UsageLedger | null = null;
  private prices: PriceSnapshot[] = [];
  private attemptCounter = 0;

  constructor(apiKey?: string, options?: GeminiProviderOptions) {
    this.fallbackProvider = new MockModelProvider();
    this.ledger = options?.ledger ?? null;
    this.prices = options?.prices ?? [];
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

  /**
   * Bei ya attempt hii kwa cost. Snapshot yenye `modelId` inatumika kwa model yake pekee;
   * snapshot bila `modelId` ni generic ya provider. Model isiyo na pigo lolote
   * inabaki bila cost badala ya kubuni thamani kutoka bei ya model nyingine.
   */
  private priceForModel(modelId: string): PriceSnapshot | undefined {
    const exact = this.prices.find(
      (price) => price.modelId && price.modelId.toLowerCase() === modelId.toLowerCase(),
    );
    if (exact) return exact;
    return this.prices.find((price) => !price.modelId);
  }

  /**
   * Inarekodi attempt moja kwenye ledger, ikiwa imetolewa. Fallback attempts
   * hazigushi usage/cost: tokens za mock provider si za kweli, hivyo kuongeza
   * cost kutoka kwazo kungehesabu gharama isiyo halisi.
   */
  private recordAttempt(
    request: ModelRequest,
    startedAt: number,
    status: ProviderAttempt['status'],
    attempt: {
      modelId: string;
      usage?: TokenUsage;
      usageSource: ProviderAttempt['usageSource'];
      fallbackUsed: boolean;
      fallbackReason?: string;
    },
  ): void {
    if (!this.ledger) return;
    const price = attempt.usage ? this.priceForModel(attempt.modelId) : undefined;
    const estimatedCostUsd = estimateCostUsd(attempt.usage, price);
    this.attemptCounter += 1;
    this.ledger.record({
      requestId: request.requestId || `auto_${startedAt}_${this.attemptCounter}`,
      providerId: this.id,
      modelId: attempt.modelId,
      tier: request.tier,
      startedAt: new Date(startedAt).toISOString(),
      latencyMs: Date.now() - startedAt,
      usage: attempt.usage,
      usageSource: attempt.usageSource,
      estimatedCostUsd,
      priceVersion: estimatedCostUsd !== undefined ? price?.version : undefined,
      fallbackUsed: attempt.fallbackUsed,
      fallbackReason: attempt.fallbackReason,
      status,
    });
  }

  async generateText(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    // If circuit breaker is tripped due to recent network failure, fail fast to fallback
    if (Date.now() < this.circuitBreakerTrippedUntil || !this.ai) {
      const fallbackReason = this.ai ? 'circuit_open' : 'provider_unavailable';
      let failFastModel = '';
      if (this.ai) {
        try {
          failFastModel = resolveModelForTier(request.tier);
        } catch {
          // Tier isiyojulikana: attempt inarekodiwa bila model, kosa linaendelea kwa fallback.
        }
      }
      const fallback = await this.fallbackProvider.generateText(request);
      this.recordAttempt(request, startedAt, 'failed', {
        modelId: failFastModel,
        usageSource: 'unknown',
        fallbackUsed: true,
        fallbackReason,
      });
      return {
        ...fallback,
        latencyMs: Date.now() - startedAt,
        fallback: { used: true, providerId: this.id, reason: fallbackReason },
      };
    }

    let attemptedModel = '';
    let timedOut = false;
    try {
      attemptedModel = resolveModelForTier(request.tier);
      const timeoutMs = deadlineTimeoutMs(request, startedAt);
      if (timeoutMs <= 0) {
        // Deadline ya caller tayari imepita; usianze call ya mtandao kabisa.
        throw new Error(`Deadline ya Gemini request imepita kabla call ianze (${Math.round(timeoutMs)}ms)`);
      }

      // Cancellation moja inounga deadline na signal ya nje: badala ya Promise.race
      // inayoiacha call ya SDK ikiendelea nyuma, abortSignal inaifuta underlying fetch.
      const controller = new AbortController();
      const signal = controller.signal;
      const abortForDeadline = () => {
        timedOut = true;
        controller.abort();
      };
      const externalSignal = request.signal;
      const abortFromExternal = () => controller.abort();
      if (externalSignal?.aborted) {
        throw new Error('Gemini request ilighairiwa (signal ya nje ilikuwa aborted kabla call ianze)');
      }
      externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

      const timer = setTimeout(abortForDeadline, timeoutMs);
      try {
        const response = await this.ai.models.generateContent({
          model: attemptedModel,
          contents: request.prompt,
          config: {
            systemInstruction: request.systemPrompt,
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxTokens ?? 1500,
            abortSignal: signal,
          },
        });

        const usage: TokenUsage = {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        };
        const modelResponse: ModelResponse = {
          content: response.text || '',
          model: attemptedModel,
          latencyMs: Date.now() - startedAt,
          fallback: { used: false },
          usage,
          metadata: {
            modelVersion: response.modelVersion,
          },
        };
        this.recordAttempt(request, startedAt, 'succeeded', {
          modelId: attemptedModel,
          usage,
          usageSource: 'provider',
          fallbackUsed: false,
        });
        return modelResponse;
      } catch (err: unknown) {
        if (timedOut) {
          throw new Error(`Timeout ya mtandao wa Gemini API (deadline ya ${Math.round(timeoutMs)}ms imepita, call imekatwa)`);
        }
        if (externalSignal?.aborted) {
          throw new Error('Gemini request ilighairiwa na signal ya nje (call imekatwa)');
        }
        throw err;
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abortFromExternal);
      }
    } catch (err: unknown) {
      // Trip circuit breaker for 60 seconds to provide instant failover on subsequent requests
      this.circuitBreakerTrippedUntil = Date.now() + 60000;
      console.warn('⚠️ Gemini API haikupatikana (Circuit Breaker Activated):', (err as Error).message);
      this.recordAttempt(request, startedAt, timedOut ? 'timed_out' : 'failed', {
        modelId: attemptedModel,
        usageSource: 'unknown',
        fallbackUsed: true,
        fallbackReason: 'provider_error',
      });
      const fallback = await this.fallbackProvider.generateText(request);
      return {
        ...fallback,
        latencyMs: Date.now() - startedAt,
        fallback: { used: true, providerId: this.id, reason: 'provider_error' },
      };
    }
  }
}
