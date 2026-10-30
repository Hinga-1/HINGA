import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomationEngine, FileJobRunStore, InMemoryJobRunStore } from './scheduler.ts';

test('AutomationEngine records bounded retries and idempotent completion', async () => {
  let calls = 0;
  const store = new InMemoryJobRunStore();
  const engine = new AutomationEngine({ runStore: store, retryBackoffMs: 0, executionTimeoutMs: 100 });
  engine.registerJob('retry-job', 'Retry test', 60_000, async () => {
    calls++;
    if (calls < 2) throw new Error('transient');
  }, 2);

  assert.equal(await engine.runJobNow('retry-job', 'request-1'), true);
  assert.equal(calls, 2);
  assert.equal(await engine.runJobNow('retry-job', 'request-1'), true);
  assert.equal(calls, 2, 'same idempotency key must not repeat a successful run');
  const record = await store.findByIdempotencyKey('request-1');
  assert.equal(record?.status, 'succeeded');
  assert.equal(record?.attempt, 2);
});

test('JobRunStore atomically accepts only one duplicate idempotency claim', async () => {
  const store = new InMemoryJobRunStore();
  const first = {
    runId: 'run-claim-1', jobId: 'job-claim', idempotencyKey: 'claim-key', status: 'pending' as const,
    attempt: 0, maxAttempts: 1, createdAt: new Date().toISOString(),
  };
  const second = { ...first, runId: 'run-claim-2' };
  const claims = await Promise.all([store.claim(first), store.claim(second)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.findByIdempotencyKey('claim-key'))?.runId, 'run-claim-1');
});

test('AutomationEngine records the completion time on the scheduled job', async () => {
  const store = new InMemoryJobRunStore();
  const engine = new AutomationEngine({ runStore: store, retryBackoffMs: 0 });
  const job = engine.registerJob('observed-job', 'Observed job', 60_000, async () => undefined, 0);

  assert.equal(job.lastRun, undefined);
  assert.equal(await engine.runJobNow('observed-job', 'request-observed'), true);
  assert.ok(job.lastRun);
  assert.equal(job.lastRun, (await store.findByIdempotencyKey('request-observed'))?.completedAt);
});

test('AutomationEngine rejects concurrent runs before async store lookup completes', async () => {
  let releaseLookup: (() => void) | undefined;
  let lookupStarted: (() => void) | undefined;
  let calls = 0;
  const lookupReady = new Promise<void>((resolve) => { lookupStarted = resolve; });
  const store = new InMemoryJobRunStore();
  const originalLookup = store.findByIdempotencyKey.bind(store);
  store.findByIdempotencyKey = async (key) => {
    lookupStarted?.();
    await new Promise<void>((resolve) => { releaseLookup = resolve; });
    return originalLookup(key);
  };
  const engine = new AutomationEngine({ runStore: store, retryBackoffMs: 0 });
  engine.registerJob('overlap-job', 'Overlap test', 60_000, async () => { calls++; }, 0);

  const firstRun = engine.runJobNow('overlap-job', 'request-overlap-1');
  await lookupReady;
  assert.equal(await engine.runJobNow('overlap-job', 'request-overlap-2'), false);
  releaseLookup?.();

  assert.equal(await firstRun, true);
  assert.equal(calls, 1);
});

test('AutomationEngine times out a signal-aware task and records failure', async () => {
  const store = new InMemoryJobRunStore();
  const engine = new AutomationEngine({ runStore: store, retryBackoffMs: 0, executionTimeoutMs: 10 });
  engine.registerJob('timeout-job', 'Timeout test', 60_000, async (signal) => {
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }, 0);

  assert.equal(await engine.runJobNow('timeout-job', 'request-timeout'), false);
  const record = await store.findByIdempotencyKey('request-timeout');
  assert.equal(record?.status, 'timed_out');
  assert.equal(record?.error, 'job_timeout');
});

test('AutomationEngine stops on a classified permanent error', async () => {
  let calls = 0;
  const store = new InMemoryJobRunStore();
  const engine = new AutomationEngine({ runStore: store, retryBackoffMs: 0 });
  engine.registerJob(
    'permanent-job',
    'Permanent error test',
    60_000,
    async () => {
      calls++;
      throw new Error('invalid_request');
    },
    3,
    (error) => error instanceof Error && error.message !== 'invalid_request',
  );

  assert.equal(await engine.runJobNow('permanent-job', 'request-permanent'), false);
  assert.equal(calls, 1);
  const record = await store.findByIdempotencyKey('request-permanent');
  assert.equal(record?.status, 'failed');
  assert.equal(record?.attempt, 1);
  assert.equal(record?.error, 'invalid_request');
});

test('FileJobRunStore survives a new store instance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hinga-job-store-'));
  const filePath = path.join(directory, 'runs.json');
  try {
    const first = new FileJobRunStore(filePath);
    await first.save({
      runId: 'run-1', jobId: 'job-1', idempotencyKey: 'key-1', status: 'succeeded',
      attempt: 1, maxAttempts: 1, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    });
    const second = new FileJobRunStore(filePath);
    const restored = await second.findByIdempotencyKey('key-1');
    assert.equal(restored?.status, 'succeeded');
    assert.ok((await readFile(filePath, 'utf8')).includes('key-1'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AutomationEngine reconciles runs interrupted by worker restart', async () => {
  const store = new InMemoryJobRunStore();
  await store.save({
    runId: 'run-interrupted', jobId: 'job-1', idempotencyKey: 'key-interrupted',
    status: 'running', attempt: 1, maxAttempts: 2,
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
  });
  const engine = new AutomationEngine({ runStore: store });

  assert.equal(await engine.reconcileInterruptedRuns(), 1);
  const reconciled = await store.findByIdempotencyKey('key-interrupted');
  assert.equal(reconciled?.status, 'failed');
  assert.equal(reconciled?.error, 'worker_restarted');
  assert.ok(reconciled?.completedAt);
  assert.equal(await engine.reconcileInterruptedRuns(), 0);
});
