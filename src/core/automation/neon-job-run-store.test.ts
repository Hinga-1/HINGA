import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { config } from '../config.ts';
import { NeonJobRunStore } from './neon-job-run-store.ts';

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
    await store.save({ ...record, status: 'succeeded', completedAt: new Date().toISOString() });
    assert.equal((await store.findByIdempotencyKey(key))?.status, 'succeeded');
  } finally {
    await cleanup`DELETE FROM ai_job_runs WHERE idempotency_key = ${key};`;
  }
});
