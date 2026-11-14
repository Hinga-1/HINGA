import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiModelProvider, deadlineTimeoutMs } from './gemini-provider.ts';
import { PriceSnapshot, UsageLedger } from './usage.ts';

type FakeConfig = { config?: { abortSignal?: AbortSignal } };
type FakeGenAI = { models: { generateContent: (cfg: FakeConfig) => Promise<unknown> } };

function providerWith(fakeAi: FakeGenAI, callLog: string[] = []): GeminiModelProvider {
  const provider = new GeminiModelProvider('test-key');
  (provider as unknown as { ai: FakeGenAI }).ai = fakeAi;
  void callLog;
  return provider;
}

/** Provider iliyo-attachiwa ledger (na bei zinazoruhusiwa) pamoja na fake SDK. */
function ledgerProvider(fakeAi: FakeGenAI, ledger: UsageLedger, prices: PriceSnapshot[] = []): GeminiModelProvider {
  const provider = new GeminiModelProvider('test-key', { ledger, prices });
  (provider as unknown as { ai: FakeGenAI }).ai = fakeAi;
  return provider;
}

/** Fake SDK inayorudisha jibu lenye usage metadata kamili. */
function successfulCall(): FakeGenAI {
  return {
    models: {
      generateContent: async () => ({
        text: 'jibu',
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 },
        modelVersion: 'gemini-2.5-flash-001',
      }),
    },
  };
}

/** Fake SDK call inayokaa bila kurudisha kitu hadhi abortSignal itulipe. */
function hangingCall(seen: { called: number; aborted: boolean }): FakeGenAI {
  return {
    models: {
      generateContent: (cfg: FakeConfig) =>
        new Promise((_resolve, reject) => {
          seen.called += 1;
          cfg.config?.abortSignal?.addEventListener('abort', () => {
            seen.aborted = true;
            reject(new Error('aborted'));
          });
        }),
    },
  };
}

const FLASH_PRICE: PriceSnapshot = {
  version: 'price-test-1',
  modelId: 'gemini-2.5-flash',
  source: 'test-fixture',
  effectiveAt: '2026-10-30',
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
};

test('deadlineTimeoutMs: default bila deadlineAt, baki kwa deadlineAt ya baadaye, <=0 kwa iliyoisha', () => {
  const now = 1_000_000;
  assert.equal(deadlineTimeoutMs({}, now), 3000);
  assert.equal(deadlineTimeoutMs({ deadlineAt: now + 400 }, now), 400);
  assert.equal(deadlineTimeoutMs({ deadlineAt: now - 50 }, now), -50);
  assert.equal(deadlineTimeoutMs({ deadlineAt: Number.POSITIVE_INFINITY }, now), 3000);
  assert.equal(deadlineTimeoutMs({ deadlineAt: Number.NaN }, now), 3000);
});

test('generateText: mafanikio yanarudisha response ya SDK na fallback.used = false', async () => {
  const provider = providerWith(successfulCall());
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast' });
  assert.equal(response.content, 'jibu');
  assert.equal(response.model, 'gemini-2.5-flash');
  assert.equal(response.fallback?.used, false);
  assert.equal(response.usage?.totalTokens, 1500);
  assert.equal((response.metadata as Record<string, unknown>)?.modelVersion, 'gemini-2.5-flash-001');
});

test('generateText: deadline inakata call iliyo-hang na SDK inaona abort, fallback inatumika', async () => {
  const seen = { called: 0, aborted: false };
  const provider = providerWith(hangingCall(seen));
  const startedAt = Date.now();
  const response = await provider.generateText({
    prompt: 'swali',
    tier: 'fast',
    deadlineAt: startedAt + 80,
  });
  const elapsed = Date.now() - startedAt;
  assert.equal(seen.called, 1);
  assert.equal(seen.aborted, true, 'SDK call lazima ionekane ime-abort, si kuachwa tu');
  assert.equal(response.fallback?.used, true);
  assert.equal(response.fallback?.reason, 'provider_error');
  assert.ok(elapsed < 2000, `haipaswi kusubiri default 3000ms (elapsed ${elapsed}ms)`);
});

test('generateText: deadline iliyoisha inarudi fallback bila kuanza call ya mtandao', async () => {
  const seen = { called: 0, aborted: false };
  const provider = providerWith(hangingCall(seen));
  const response = await provider.generateText({
    prompt: 'swali',
    tier: 'fast',
    deadlineAt: Date.now() - 1000,
  });
  assert.equal(seen.called, 0, 'SDK haipaswi kuitwa kabisa');
  assert.equal(response.fallback?.used, true);
});

test('generateText: signal ya nje inagharimu call na SDK inaona abort', async () => {
  const seen = { called: 0, aborted: false };
  const provider = providerWith(hangingCall(seen));
  const external = new AbortController();
  setTimeout(() => external.abort(), 40);
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast', signal: external.signal });
  assert.equal(seen.called, 1);
  assert.equal(seen.aborted, true, 'abort ya nje lazima ipitie kwa abortSignal ya SDK');
  assert.equal(response.fallback?.used, true);
});

test('generateText: circuit breaker iliyofunguka inarudi fallback ya haraka bila call mpya', async () => {
  const seen = { called: 0, aborted: false };
  const provider = providerWith(hangingCall(seen));
  await provider.generateText({ prompt: 'swali', tier: 'fast', deadlineAt: Date.now() + 30 });
  const callsAfterFirst = seen.called;
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast' });
  assert.equal(seen.called, callsAfterFirst, 'hakuna call ya SDK wakati circuit iko wazi');
  assert.equal(response.fallback?.used, true);
  assert.equal(response.fallback?.reason, 'circuit_open');
});

test('generateText: signal ya nje iliyokwisha abort kabla call ianze inarudi fallback bila call', async () => {
  const seen = { called: 0, aborted: false };
  const provider = providerWith(hangingCall(seen));
  const external = new AbortController();
  external.abort();
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast', signal: external.signal });
  assert.equal(seen.called, 0);
  assert.equal(response.fallback?.used, true);
});

test('ledger: mafanikio yanarekodi attempt yenye usage ya provider na cost ya snapshot inayolingana', async () => {
  const ledger = new UsageLedger();
  const provider = ledgerProvider(successfulCall(), ledger, [FLASH_PRICE]);
  await provider.generateText({ prompt: 'swali', tier: 'fast', requestId: 'req-ok-1' });

  const attempts = ledger.getAttempts();
  assert.equal(attempts.length, 1);
  const attempt = attempts[0];
  assert.equal(attempt.status, 'succeeded');
  assert.equal(attempt.requestId, 'req-ok-1');
  assert.equal(attempt.modelId, 'gemini-2.5-flash');
  assert.equal(attempt.tier, 'fast');
  assert.equal(attempt.usageSource, 'provider');
  assert.equal(attempt.usage?.totalTokens, 1500);
  assert.equal(attempt.fallbackUsed, false);
  assert.equal(attempt.estimatedCostUsd, 0.002); // 1000/1M*1 + 500/1M*2
  assert.equal(attempt.priceVersion, 'price-test-1');
  assert.ok(typeof attempt.latencyMs === 'number' && attempt.latencyMs >= 0);
  assert.equal(ledger.totalCostUsd(), 0.002);
  assert.equal(ledger.totalTokens(), 1500);
});

test('ledger: snapshot isiyolingana na model haibuni cost', async () => {
  const otherPrice: PriceSnapshot = { ...FLASH_PRICE, version: 'other-price', modelId: 'some-other-model' };
  const ledger = new UsageLedger();
  const provider = ledgerProvider(successfulCall(), ledger, [otherPrice]);
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast' });
  assert.equal(response.fallback?.used, false);
  const attempt = ledger.getAttempts()[0];
  assert.equal(attempt.status, 'succeeded');
  assert.equal(attempt.estimatedCostUsd, undefined, 'cost haipaswi kuhesabiwa kwa bei ya model nyingine');
  assert.equal(attempt.priceVersion, undefined);
  assert.equal(ledger.totalCostUsd(), undefined);
});

test('ledger: timeout inarekodi status timed_out bila usage wala cost ya kubuni', async () => {
  const seen = { called: 0, aborted: false };
  const ledger = new UsageLedger();
  const provider = ledgerProvider(hangingCall(seen), ledger, [FLASH_PRICE]);
  const startedAt = Date.now();
  await provider.generateText({ prompt: 'swali', tier: 'fast', requestId: 'req-to-1', deadlineAt: startedAt + 60 });

  const attempts = ledger.getAttempts();
  assert.equal(attempts.length, 1);
  const attempt = attempts[0];
  assert.equal(attempt.requestId, 'req-to-1');
  assert.equal(attempt.status, 'timed_out');
  assert.equal(attempt.fallbackUsed, true);
  assert.equal(attempt.fallbackReason, 'provider_error');
  assert.equal(attempt.usage, undefined, 'tokens za mock fallback si za kweli');
  assert.equal(attempt.estimatedCostUsd, undefined);
  assert.equal(ledger.totalCostUsd(), undefined);
  assert.equal(ledger.totalTokens(), 0);
});

test('ledger: fail-fast ya circuit open inarekodi failed na reason circuit_open', async () => {
  const seen = { called: 0, aborted: false };
  const ledger = new UsageLedger();
  const provider = ledgerProvider(hangingCall(seen), ledger, [FLASH_PRICE]);
  // Call ya kwanza ina-trip circuit breaker (timeout).
  await provider.generateText({ prompt: 'swali', tier: 'fast', deadlineAt: Date.now() + 30 });
  // Call ya pili ni fail-fast: circuit iko wazi.
  await provider.generateText({ prompt: 'swali', tier: 'fast', requestId: 'req-co-1' });

  const attempts = ledger.getAttempts();
  assert.equal(attempts.length, 2);
  const failFast = attempts[1];
  assert.equal(failFast.requestId, 'req-co-1');
  assert.equal(failFast.status, 'failed');
  assert.equal(failFast.fallbackUsed, true);
  assert.equal(failFast.fallbackReason, 'circuit_open');
  assert.equal(failFast.usageSource, 'unknown');
  assert.equal(failFast.usage, undefined);
  assert.equal(failFast.estimatedCostUsd, undefined);
});

test('ledger: provider bila ledger inaendelea kufanya kazi kama kawaida', async () => {
  const provider = new GeminiModelProvider(undefined);
  const result = await provider.generateText({ prompt: 'test' });
  assert.equal(result.fallback?.used, true);
  assert.equal(result.fallback?.reason, 'provider_unavailable');
  assert.ok(typeof result.latencyMs === 'number');
});
