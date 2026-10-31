import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { config } from '../config.ts';
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
  if (!config.databaseUrl || process.env.RUN_NEON_INTEGRATION !== 'true' || process.env.NEON_BRANCH === 'production') {
    t.skip('requires explicit non-production Neon integration configuration');
    return;
  }
  const store = new NeonJobRunStore(config.databaseUrl);
  const cleanup = neon(config.databaseUrl);
  const key = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const record = {
      runId: `run-${key}`,
      jobId: 'integration-job',
      idempotencyKey: key,
      status: 'running' as const,
      attempt: 1,
      maxAttempts: 2,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
    assert.equal(await store.claim(record), true);
    assert.equal(await store.claim({ ...record, runId: `${record.runId}-duplicate` }), false);
    const found = await store.findByIdempotencyKey(key);
    assert.equal(found?.runId, record.runId);
    assert.equal((await store.listRunning()).some((run) => run.idempotencyKey === key), true);
    const startedAt = new Date().toISOString();
    assert.equal(await store.beginAttempt(record.runId, 2, startedAt), true);
    assert.equal(await store.beginAttempt(record.runId, 2, startedAt), false);
    assert.equal((await store.findByIdempotencyKey(key))?.attempt, 2);
    const completedAt = new Date().toISOString();
    assert.equal(await store.failIfRunning(record.runId, completedAt, 'integration_failure'), true);
    assert.equal(await store.failIfRunning(record.runId, completedAt, 'integration_failure'), false);
    const failed = await store.findByIdempotencyKey(key);
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, 'integration_failure');
    await store.save({ ...record, status: 'succeeded', completedAt: new Date().toISOString() });
    assert.equal((await store.findByIdempotencyKey(key))?.status, 'succeeded');
  } finally {
    await cleanup`DELETE FROM ai_job_runs WHERE idempotency_key = ${key};`;
  }
});
