import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { config } from '../config.ts';
import { resolveIntegrationEnv } from '../testing/integration-guard.ts';
import type { JobRunRecord } from '../types.ts';
import { NeonJobRunStore } from './neon-job-run-store.ts';

// Runs without any database: the row mapper must keep the JobRunRecord contract even
// when the neon driver hands back JS Date objects for timestamp columns.
test('toRecord maps snake_case rows with Date objects onto the camelCase ISO contract', () => {
  const store = new NeonJobRunStore('postgresql://user:pass@ep-example.neon.tech/neondb');
  const mapper = store as unknown as { toRecord: (row: Record<string, unknown>) => JobRunRecord };
  const record = mapper.toRecord({
    run_id: 'run-1',
    job_id: 'job-1',
    idempotency_key: 'idem-1',
    status: 'failed',
    attempt: 2,
    max_attempts: 3,
    created_at: new Date('2026-10-31T00:00:00.000Z'),
    started_at: new Date('2026-10-31T00:01:00.000Z'),
    completed_at: new Date('2026-10-31T00:02:00.000Z'),
    error_code: 'ERR_TEST',
  });
  assert.deepEqual(record, {
    runId: 'run-1',
    jobId: 'job-1',
    idempotencyKey: 'idem-1',
    status: 'failed',
    attempt: 2,
    maxAttempts: 3,
    createdAt: '2026-10-31T00:00:00.000Z',
    startedAt: '2026-10-31T00:01:00.000Z',
    completedAt: '2026-10-31T00:02:00.000Z',
    error: 'ERR_TEST',
  });

  const minimal = mapper.toRecord({
    run_id: 'run-2',
    job_id: 'job-2',
    idempotency_key: 'idem-2',
    status: 'pending',
    attempt: 0,
    max_attempts: 1,
    created_at: new Date('2026-10-31T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    error_code: null,
  });
  assert.equal(minimal.startedAt, undefined, 'NULL started_at must stay undefined');
  assert.equal(minimal.completedAt, undefined, 'NULL completed_at must stay undefined');
  assert.equal(minimal.error, undefined, 'NULL error_code must stay undefined');
  assert.equal(minimal.createdAt, '2026-10-31T00:00:00.000Z');
});


test('Neon JobRunStore persists and reads execution records on an isolated branch', async (t) => {
  const integrationDecision = resolveIntegrationEnv(process.env);
  if (!config.databaseUrl || !integrationDecision.allowed) {
    t.skip(config.databaseUrl ? integrationDecision.reason : 'DATABASE_URL is not set');
    return;
  }
  const store = new NeonJobRunStore(config.databaseUrl);
  const cleanup = neon(config.databaseUrl);
  const key = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    // The lifecycle a real caller follows (engine + db.test.ts): claim inserts a
    // PENDING row, beginAttempt is the only transition into running, failure
    // makes it retryable, and save completes it. A claim must NOT insert a
    // running row: beginAttempt would then be refused by its own guard,
    // contradiction the store contract keeps on purpose.
    const record = {
      runId: `run-${key}`,
      jobId: 'integration-job',
      idempotencyKey: key,
      status: 'pending' as const,
      attempt: 0,
      maxAttempts: 2,
      createdAt: new Date().toISOString(),
    };
    assert.equal(await store.claim(record), true, 'the first claim must insert the pending run');
    assert.equal(await store.claim({ ...record, runId: `${record.runId}-rival` }), false, 'a rival claim on the same idempotency key must be refused');
    const claimed = await store.findByIdempotencyKey(key);
    assert.equal(claimed?.runId, record.runId);
    assert.equal(claimed?.status, 'pending', 'a fresh claim stays pending until an attempt begins');
    const startedAt = new Date().toISOString();
    assert.equal(await store.beginAttempt(record.runId, 1, startedAt), true, 'pending must become running');
    assert.equal(await store.beginAttempt(record.runId, 1, startedAt), false, 'a running job cannot begin again');
    assert.equal((await store.findByIdempotencyKey(key))?.attempt, 1);
    assert.equal((await store.listRunning()).some((run) => run.idempotencyKey === key), true, 'listRunning must see the running job');
    const completedAt = new Date().toISOString();
    assert.equal(await store.failIfRunning(record.runId, completedAt, 'integration_failure'), true, 'running must become failed');
    assert.equal(await store.failIfRunning(record.runId, completedAt, 'integration_failure'), false, 'a failed job cannot fail again');
    const failed = await store.findByIdempotencyKey(key);
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, 'integration_failure');
    assert.equal(await store.beginAttempt(record.runId, 2, startedAt), true, 'a failed job may retry via beginAttempt');
    await store.save({ ...record, status: 'succeeded' as const, completedAt: new Date().toISOString() });
    assert.equal((await store.findByIdempotencyKey(key))?.status, 'succeeded');
  } finally {
    await cleanup`DELETE FROM ai_job_runs WHERE idempotency_key = ${key};`;
  }
});
