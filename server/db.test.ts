import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabaseSchema, testConnection, createItem, getItems, deleteItem, sql } from './db';
import { NeonExecutionLedger, type SqlClient } from '../src/core/automation/execution-ledger';
import { resolveIntegrationEnv } from '../src/core/testing/integration-guard';

const integrationDecision = resolveIntegrationEnv(process.env);
const canRunIntegration = integrationDecision.allowed;
const skipReason = canRunIntegration ? undefined : integrationDecision.reason;

test('Neon Postgres - Schema Initialization & Connection', { skip: skipReason }, async (t) => {
  await t.test('initializes database table schema using direct connection', async () => {
    await initDatabaseSchema();
    assert.ok(true, 'Schema initialized successfully');
  });

  await t.test('connects and retrieves PostgreSQL metadata and branch', async () => {
    const health = await testConnection();
    assert.equal(health.status, 'ok', `Database connection failed: ${health.error}`);
    assert.ok(health.version?.includes('PostgreSQL'), 'Database version should indicate PostgreSQL');
    assert.equal(health.database, 'neondb');
    const expectedBranch = (process.env.NEON_EXPECTED_BRANCH || process.env.NEON_BRANCH || '').toLowerCase();
    assert.ok(expectedBranch, 'NEON_EXPECTED_BRANCH or NEON_BRANCH must identify the test branch');
    assert.equal(health.branch.toLowerCase(), expectedBranch);
    assert.ok(health.latencyMs >= 0);
  });
});

test('Neon Postgres - End-to-End CRUD Operations', { skip: skipReason }, async (t) => {
  let createdId: number;

  await t.test('inserts a new record into neon_items', async () => {
    const uniqueTitle = `Test item ${Date.now()}`;
    const desc = 'Jaribio la Neon Postgres';
    const item = await createItem(uniqueTitle, desc);

    assert.ok(item.id > 0);
    assert.equal(item.title, uniqueTitle);
    assert.equal(item.description, desc);
    createdId = item.id;
  });

  await t.test('retrieves items and includes the newly created record', async () => {
    const items = await getItems();
    assert.ok(Array.isArray(items));
    const found = items.find((i) => i.id === createdId);
    assert.ok(found, `Item with id ${createdId} should exist in list`);
  });

  await t.test('deletes the record from neon_items', async () => {
    const deleted = await deleteItem(createdId);
    assert.equal(deleted, true);

    const items = await getItems();
    const found = items.find((i) => i.id === createdId);
    assert.equal(found, undefined, 'Deleted item should not be found');
  });
});

// Migration 004 on the real test branch: the database itself must refuse a second
// active execution per mission and refuse duplicate idempotency keys, so two
// stateless HTTP workers racing on a pooled connection cannot both run.
test('Neon Postgres - Execution ledger single-active guarantee (migration 004)', { skip: skipReason }, async (t) => {
  const stamp = Date.now();
  const missionId = `mission-003-it-${stamp}`;
  const created: string[] = [];

  const insert = (executionId: string, mission: string, idem: string, status: string) => sql`
    INSERT INTO hinga_executions (execution_id, mission_id, worker_id, worker_mode, idempotency_key, status)
    VALUES (${executionId}, ${mission}, 'it-worker', 'base44_agent', ${idem}, ${status})`;

  try {
    await t.test('first active execution for a mission is accepted', async () => {
      await insert(`${missionId}-e1`, missionId, `${missionId}-e1-key`, 'queued');
      created.push(`${missionId}-e1`);
    });

    await t.test('second active execution for the same mission is rejected by the partial unique index', async () => {
      await assert.rejects(
        insert(`${missionId}-e2`, missionId, `${missionId}-e2-key`, 'running'),
        (err: unknown) => (err as { code?: string }).code === '23505',
        'expected a unique constraint violation (23505)',
      );
    });

    await t.test('finishing the execution frees the mission slot for a new active execution', async () => {
      await sql`UPDATE hinga_executions SET status = 'succeeded', finished_at = NOW() WHERE execution_id = ${`${missionId}-e1`}`;
      await insert(`${missionId}-e3`, missionId, `${missionId}-e3-key`, 'queued');
      created.push(`${missionId}-e3`);
    });

    await t.test('an idempotency key cannot be reused across missions', async () => {
      await assert.rejects(
        insert(`${missionId}-e4`, `${missionId}-other`, `${missionId}-e1-key`, 'queued'),
        (err: unknown) => (err as { code?: string }).code === '23505',
        'expected a unique constraint violation (23505)',
      );
    });
  } finally {
    for (const id of created) {
      await sql`DELETE FROM hinga_executions WHERE execution_id = ${id}`;
    }
  }
});


// Migration 004 on the real test branch, through the same NeonExecutionLedger SQL a
// worker uses: exactly one owner per lease, foreign heartbeat/release refused, an
// expired lease is taken over, and a released lease is free again. Also proves the
// snake_case -> camelCase row mapping end to end on a live connection.
test('Neon Postgres - Worker lease expiry and ownership (migration 004)', { skip: skipReason }, async (t) => {
  const stamp = Date.now();
  const leaseKey = `hinga:it:lease-${stamp}`;
  const ttlMs = 10 * 60_000;
  const ledgerClient: SqlClient = {
    query: <T>(statement: string, params: unknown[] = []) => sql.query(statement, params) as Promise<T[]>,
  };
  const ledger = new NeonExecutionLedger(ledgerClient);

  try {
    await t.test('the first worker acquires the lease', async () => {
      const lease = await ledger.acquireLease({
        leaseKey,
        workerId: 'worker-a',
        executionId: `it-exec-${stamp}-a`,
        ttlMs,
      });
      assert.ok(lease, 'expected the lease to be acquired');
      assert.equal(lease.leaseKey, leaseKey);
      assert.equal(lease.workerId, 'worker-a');
    });

    await t.test('a second worker cannot take an active lease', async () => {
      const lease = await ledger.acquireLease({
        leaseKey,
        workerId: 'worker-b',
        executionId: `it-exec-${stamp}-b`,
        ttlMs,
      });
      assert.equal(lease, null, 'the atomic upsert must not hand over an active lease');
    });

    await t.test('the owner renews with a heartbeat, a stranger is refused', async () => {
      assert.equal(await ledger.heartbeatLease(leaseKey, 'worker-a', ttlMs), true);
      assert.equal(await ledger.heartbeatLease(leaseKey, 'worker-b', ttlMs), false);
    });

    await t.test('a stranger cannot release the lease', async () => {
      assert.equal(await ledger.releaseLease(leaseKey, 'worker-b', 'test'), false);
      const lease = await ledger.getLease(leaseKey);
      assert.ok(lease, 'the lease must still exist');
      assert.equal(lease.releasedAt, undefined, 'a refused release must not mark the lease released');
    });

    await t.test('an expired lease is taken over by the next worker', async () => {
      await sql`UPDATE hinga_worker_leases SET expires_at = NOW() - INTERVAL '5 seconds' WHERE lease_key = ${leaseKey}`;
      const lease = await ledger.acquireLease({
        leaseKey,
        workerId: 'worker-c',
        executionId: `it-exec-${stamp}-c`,
        ttlMs,
      });
      assert.ok(lease, 'an expired lease must be re-acquirable');
      assert.equal(lease.workerId, 'worker-c');
      assert.equal(lease.releasedAt, undefined);
    });

    await t.test('a released lease is free for the next acquisition', async () => {
      assert.equal(await ledger.releaseLease(leaseKey, 'worker-c', 'test-complete'), true);
      const lease = await ledger.acquireLease({
        leaseKey,
        workerId: 'worker-d',
        executionId: `it-exec-${stamp}-d`,
        ttlMs,
      });
      assert.ok(lease, 'a released lease must be acquirable again');
      assert.equal(lease.workerId, 'worker-d');
    });
  } finally {
    await sql`DELETE FROM hinga_worker_leases WHERE lease_key = ${leaseKey}`;
  }
});

// NeonJobRunStore on the real test branch: the scheduler's JobRunStore contract must
// hold on Postgres exactly as the in-memory implementation promises, because a
// restarted worker relies on claim idempotency and status-transition guards to avoid
// running the same job twice or double-counting a failure.
test('Neon Postgres - JobRunStore claim and retry contract (migration 002)', { skip: skipReason }, async (t) => {
  const { NeonJobRunStore } = await import('../src/core/automation/neon-job-run-store.ts');
  const store = new NeonJobRunStore(process.env.DATABASE_URL || '');
  const stamp = Date.now();
  const runId = `it-jobrun-${stamp}`;
  const idempotencyKey = `it-idem-${stamp}`;
  const baseRecord = {
    runId,
    jobId: 'it-job',
    idempotencyKey,
    status: 'pending' as const,
    attempt: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
  };

  try {
    await t.test('a duplicate claim with the same idempotency key is refused by the database', async () => {
      assert.equal(await store.claim(baseRecord), true, 'the first claim must succeed');
      assert.equal(
        await store.claim({ ...baseRecord, runId: `${runId}-rival`, jobId: 'it-job-rival' }),
        false,
        'a second claim with the same idempotency key must be refused',
      );
    });

    await t.test('findByIdempotencyKey returns the record with the camelCase contract', async () => {
      const record = await store.findByIdempotencyKey(idempotencyKey);
      assert.ok(record, 'the claimed record must be findable');
      assert.equal(record.runId, runId);
      assert.equal(record.jobId, 'it-job');
      assert.equal(record.status, 'pending');
      assert.equal(record.attempt, 0);
      assert.equal(record.maxAttempts, 3);
      assert.equal(record.error, undefined);
    });

    await t.test('beginAttempt moves pending to running and refuses while running', async () => {
      const startedAt = new Date().toISOString();
      assert.equal(await store.beginAttempt(runId, 1, startedAt), true, 'pending must become running');
      assert.equal(await store.beginAttempt(runId, 1, startedAt), false, 'a running job cannot begin again');
      const record = await store.findByIdempotencyKey(idempotencyKey);
      assert.equal(record?.status, 'running');
      assert.equal(record?.attempt, 1);
    });

    await t.test('listRunning sees the running job and only the running jobs', async () => {
      const running = await store.listRunning();
      assert.ok(running.some((r) => r.runId === runId), 'the running job must be listed');
      assert.ok(running.every((r) => r.status === 'running'), 'listRunning must not return other statuses');
    });

    await t.test('failIfRunning records the failure once and refuses a second time', async () => {
      const completedAt = new Date().toISOString();
      assert.equal(await store.failIfRunning(runId, completedAt, 'IT_TEST_FAILURE'), true, 'running must become failed');
      assert.equal(await store.failIfRunning(runId, completedAt, 'IT_TEST_FAILURE'), false, 'a failed job cannot fail again');
      const record = await store.findByIdempotencyKey(idempotencyKey);
      assert.equal(record?.status, 'failed');
      assert.equal(record?.error, 'IT_TEST_FAILURE');
      assert.equal(record?.completedAt, completedAt);
    });

    await t.test('a failed job may retry via beginAttempt and finish via save', async () => {
      assert.equal(await store.beginAttempt(runId, 2, new Date().toISOString()), true, 'retry after failure must be allowed');
      const succeeded = { ...baseRecord, status: 'succeeded' as const, attempt: 2, completedAt: new Date().toISOString() };
      await store.save(succeeded);
      const record = await store.findByIdempotencyKey(idempotencyKey);
      assert.equal(record?.status, 'succeeded');
      assert.equal(record?.attempt, 2);
      const running = await store.listRunning();
      assert.equal(running.some((r) => r.runId === runId), false, 'a succeeded job must not be listed as running');
    });
  } finally {
    await sql`DELETE FROM ai_job_runs WHERE run_id = ${runId} OR run_id = ${`${runId}-rival`}`;
  }
});
