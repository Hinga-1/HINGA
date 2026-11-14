import { ModelTier, TokenUsage } from '../types.ts';

export interface PriceSnapshot {
  version: string;
  /** Model ambayo bei hii inamhusu; kutokuwepo kwake kuna maana snapshot hii ni generic kwa provider. */
  modelId?: string;
  source: string;
  effectiveAt: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface ProviderAttempt {
  requestId: string;
  providerId: string;
  modelId: string;
  tier?: ModelTier;
  startedAt: string;
  latencyMs?: number;
  usage?: TokenUsage;
  usageSource: 'provider' | 'estimated' | 'unknown';
  estimatedCostUsd?: number;
  priceVersion?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  status: 'succeeded' | 'failed' | 'timed_out';
}

export function estimateCostUsd(usage: TokenUsage | undefined, price: PriceSnapshot | undefined): number | undefined {
  if (!usage || !price) return undefined;
  const input = (usage.promptTokens / 1_000_000) * price.inputUsdPerMillionTokens;
  const output = (usage.completionTokens / 1_000_000) * price.outputUsdPerMillionTokens;
  return Number((input + output).toFixed(8));
}

export class UsageLedger {
  private attempts: ProviderAttempt[] = [];

  record(attempt: ProviderAttempt): void {
    this.attempts.push({ ...attempt });
  }

  getAttempts(): ProviderAttempt[] {
    return this.attempts.map((attempt) => ({ ...attempt }));
  }

  totalCostUsd(): number | undefined {
    const priced = this.attempts.filter((attempt) => attempt.estimatedCostUsd !== undefined);
    if (priced.length === 0) return undefined;
    return Number(priced.reduce((total, attempt) => total + (attempt.estimatedCostUsd ?? 0), 0).toFixed(8));
  }

  totalTokens(): number {
    return this.attempts.reduce((total, attempt) => total + (attempt.usage?.totalTokens ?? 0), 0);
  }
}
