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
