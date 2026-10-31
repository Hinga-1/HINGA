import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiModelProvider, deadlineTimeoutMs } from './gemini-provider.ts';

type FakeConfig = { config?: { abortSignal?: AbortSignal } };
type FakeGenAI = { models: { generateContent: (cfg: FakeConfig) => Promise<unknown> } };

function providerWith(fakeAi: FakeGenAI, callLog: string[] = []): GeminiModelProvider {
  const provider = new GeminiModelProvider('test-key');
  (provider as unknown as { ai: FakeGenAI }).ai = fakeAi;
  void callLog;
  return provider;
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

test('deadlineTimeoutMs: default bila deadlineAt, baki kwa deadlineAt ya baadaye, <=0 kwa iliyoisha', () => {
  const now = 1_000_000;
  assert.equal(deadlineTimeoutMs({}, now), 3000);
  assert.equal(deadlineTimeoutMs({ deadlineAt: now + 400 }, now), 400);
  assert.equal(deadlineTimeoutMs({ deadlineAt: now - 50 }, now), -50);
  assert.equal(deadlineTimeoutMs({ deadlineAt: Number.POSITIVE_INFINITY }, now), 3000);
  assert.equal(deadlineTimeoutMs({ deadlineAt: Number.NaN }, now), 3000);
});

test('generateText: mafanikio yanarudisha response ya SDK na fallback.used = false', async () => {
  const provider = providerWith({
    models: {
      generateContent: async () => ({
        text: 'jibu',
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 },
        modelVersion: 'gemini-2.5-flash-001',
      }),
    },
  });
  const response = await provider.generateText({ prompt: 'swali', tier: 'fast' });
  assert.equal(response.content, 'jibu');
  assert.equal(response.model, 'gemini-2.5-flash');
  assert.equal(response.fallback?.used, false);
  assert.equal(response.usage?.totalTokens, 8);
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
