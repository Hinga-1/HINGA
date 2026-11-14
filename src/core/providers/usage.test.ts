import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, UsageLedger } from './usage.ts';
import { GeminiModelProvider } from './gemini-provider.ts';

test('UsageLedger calculates cost from provider token usage', () => {
  const price = {
    version: 'fixture-1', source: 'test-fixture', effectiveAt: '2026-10-30',
    inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2,
  };
  assert.equal(estimateCostUsd({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }, price), 0.002);
  const ledger = new UsageLedger();
  ledger.record({
    requestId: 'req-1', providerId: 'gemini', modelId: 'fixture', tier: 'balanced',
    startedAt: new Date().toISOString(), usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    usageSource: 'provider', estimatedCostUsd: 0.002, priceVersion: price.version,
    fallbackUsed: false, status: 'succeeded',
  });
  assert.equal(ledger.totalTokens(), 1500);
  assert.equal(ledger.totalCostUsd(), 0.002);
});

test('Gemini provider marks fallback results explicitly when no API key is configured', async () => {
  const provider = new GeminiModelProvider(undefined);
  const result = await provider.generateText({ prompt: 'test' });
  assert.equal(result.fallback?.used, true);
  assert.equal(result.fallback?.reason, 'provider_unavailable');
  assert.ok(typeof result.latencyMs === 'number');
});
