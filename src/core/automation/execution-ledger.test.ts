import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_POLICY,
  InMemoryExecutionLedger,
  assertSafeTargets,
  computeBackoffMs,
  decideNextAction,
  evaluateCompletionGate,
  isStale,
  isTransientError,
  NeonExecutionLedger,
  type ExecutionRecord,
  type SqlClient,
} from './execution-ledger.ts';

const baseExecution = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => {
  const now = new Date().toISOString();
  return {
    executionId: 'exec-1',
    missionId: 'mission-003',
    workerId: 'worker-a',
    workerMode: 'base44_agent',
    idempotencyKey: 'key-1',
    status: 'queued',
    attempt: 1,
    maxAttempts: 3,
    testSummary: {},
    estimatedCostUsd: 0.02,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

test('retry classification separates transient from permanent failures', () => {
  assert.equal(isTransientError('NETWORK_ERROR'), true);
  assert.equal(isTransientError('RATE_LIMITED'), true);
  assert.equal(isTransientError('TIMEOUT'), true);
  assert.equal(isTransientError('TEST_FAILED'), false);
  assert.equal(isTransientError('PRODUCTION_ACTION_DENIED'), false);
  assert.equal(isTransientError('AUTH_FAILED'), false);
  assert.equal(isTransientError('SOMETHING_UNKNOWN'), false, 'unknown codes are not retried blindly');
  assert.equal(isTransientError(undefined), false);
});

test('backoff grows exponentially, stays capped and is deterministic', () => {
  const policy = { ...DEFAULT_RETRY_POLICY, baseBackoffMs: 1_000, maxBackoffMs: 8_000 };
  const first = computeBackoffMs(1, policy, 'seed');
  const second = computeBackoffMs(2, policy, 'seed');
  const third = computeBackoffMs(3, policy, 'seed');
  const clamped = computeBackoffMs(10, policy, 'seed');

  assert.ok(first >= 1_000 && first <= 1_200, `first attempt backoff in range, got ${first}`);
  assert.ok(second > first, 'second attempt waits longer than the first');
  assert.ok(third > second, 'third attempt waits longer than the second');
  assert.equal(clamped, policy.maxBackoffMs, 'backoff never exceeds the cap');
  assert.equal(computeBackoffMs(2, policy, 'seed'), second, 'same seed gives a reproducible delay');
});

test('lease admits exactly one worker and reports contention to the loser', async () => {
  const ledger = new InMemoryExecutionLedger();
  const request = { leaseKey: 'hinga:mission:mission-003', workerId: 'worker-a', executionId: 'exec-a', ttlMs: 60_000 };
  const winner = await ledger.acquireLease(request);
  const loser = await ledger.acquireLease({ ...request, workerId: 'worker-b', executionId: 'exec-b' });

  assert.ok(winner, 'first worker acquires the lease');
  assert.equal(loser, null, 'second worker must not acquire a live lease');

  const decision = decideNextAction({ lease: await ledger.getLease(request.leaseKey) });
  assert.equal(decision.action, 'already_running');
});

test('a dead worker cannot hold the lease forever', async () => {
  const ledger = new InMemoryExecutionLedger();
  const leaseKey = 'hinga:mission:mission-003';
  await ledger.acquireLease({ leaseKey, workerId: 'worker-a', executionId: 'exec-a', ttlMs: 1 });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const takeover = await ledger.acquireLease({ leaseKey, workerId: 'worker-b', executionId: 'exec-b', ttlMs: 60_000 });

  assert.ok(takeover, 'expired lease can be taken over');
  assert.equal(takeover?.workerId, 'worker-b');
});

test('lease heartbeat renews ownership but only for the owning worker', async () => {
  const ledger = new InMemoryExecutionLedger();
  const leaseKey = 'hinga:mission:mission-003';
  await ledger.acquireLease({ leaseKey, workerId: 'worker-a', executionId: 'exec-a', ttlMs: 5_000 });

  assert.equal(await ledger.heartbeatLease(leaseKey, 'worker-b', 5_000), false);
  assert.equal(await ledger.heartbeatLease(leaseKey, 'worker-a', 60_000), true);
  assert.equal(await ledger.releaseLease(leaseKey, 'worker-b', 'spoofed'), false);
  assert.equal(await ledger.releaseLease(leaseKey, 'worker-a', 'done'), true);
});

test('lease boundaries reject malformed identities and non-positive TTLs', async () => {
  const ledger = new InMemoryExecutionLedger();
  await assert.rejects(
    ledger.acquireLease({ leaseKey: '', workerId: 'worker-a', executionId: 'exec-a', ttlMs: 1_000 }),
    /identity fields must be non-empty/,
  );
  await assert.rejects(
    ledger.acquireLease({ leaseKey: 'lease', workerId: 'worker-a', executionId: 'exec-a', ttlMs: 0 }),
    /TTL must be a positive finite number/,
  );
  await ledger.acquireLease({ leaseKey: 'lease', workerId: 'worker-a', executionId: 'exec-a', ttlMs: 1_000 });
  await assert.rejects(
    ledger.heartbeatLease('lease', 'worker-a', Number.NaN),
    /TTL must be a positive finite number/,
  );
});

test('stale running execution is detected so recovery can proceed', () => {
  const now = new Date('2026-10-30T22:00:00.000Z');
  const fresh = baseExecution({
    status: 'running',
    startedAt: '2026-10-30T21:55:00.000Z',
    heartbeatAt: '2026-10-30T21:59:30.000Z',
  });
  const stale = baseExecution({
    status: 'running',
    startedAt: '2026-10-30T21:00:00.000Z',
    heartbeatAt: '2026-10-30T21:10:00.000Z',
  });

  assert.equal(isStale(fresh, now), false);
  assert.equal(isStale(stale, now), true);
  assert.equal(decideNextAction({ activeExecution: fresh, now }).action, 'already_running');
  assert.equal(decideNextAction({ activeExecution: stale, now }).action, 'start');
});

test('permanent failures are not retried and exhausted attempts stop the loop', () => {
  const failed = baseExecution({
    status: 'failed',
    attempt: 2,
    errorCode: 'TEST_FAILED',
    finishedAt: new Date().toISOString(),
  });
  assert.equal(decideNextAction({ lastFailedExecution: failed }).action, 'do_not_retry');

  const transient = baseExecution({
    status: 'failed',
    attempt: 3,
    errorCode: 'NETWORK_ERROR',
    finishedAt: new Date().toISOString(),
  });
  assert.equal(decideNextAction({ lastFailedExecution: transient }).action, 'exhausted');
});

test('transient failure waits for backoff before retrying', () => {
  const now = new Date('2026-10-30T22:00:00.000Z');
  const justFailed = baseExecution({
    status: 'failed',
    attempt: 1,
    errorCode: 'NETWORK_ERROR',
    finishedAt: '2026-10-30T21:59:50.000Z',
  });
  const waiting = decideNextAction({ lastFailedExecution: justFailed, now });
  assert.equal(waiting.action, 'wait_backoff');
  assert.ok((waiting.waitMs ?? 0) > 0);

  const later = decideNextAction({
    lastFailedExecution: justFailed,
    now: new Date('2026-10-30T22:10:00.000Z'),
  });
  assert.equal(later.action, 'retry');
  assert.equal(later.attempt, 2);
});

test('idempotency key prevents a duplicate execution record', async () => {
  const ledger = new InMemoryExecutionLedger();
  const first = await ledger.createExecution(baseExecution());
  const second = await ledger.createExecution(
    baseExecution({ executionId: 'exec-2', workerId: 'worker-b' }),
  );

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.record.executionId, 'exec-1', 'the original execution is returned');
  assert.equal((await ledger.listRecent('mission-003')).length, 1);
});

test('execution lifecycle keeps heartbeat and commit evidence', async () => {
  const ledger = new InMemoryExecutionLedger();
  await ledger.createExecution(baseExecution());
  assert.equal(await ledger.markRunning('exec-1', new Date().toISOString()), true);
  assert.equal((await ledger.findActiveExecution('mission-003'))?.status, 'running');

  const finished = await ledger.finishExecution('exec-1', {
    status: 'succeeded',
    commitSha: 'abc1234',
    pullRequestUrl: 'https://github.com/Hinga-1/HINGA/pull/1',
    testSummary: { passed: 12, failed: 0 },
  });
  assert.equal(finished?.commitSha, 'abc1234');
  assert.equal((await ledger.findActiveExecution('mission-003')), undefined);
  assert.equal(await ledger.finishExecution('missing', { status: 'failed' }), undefined);
});

test('mission completion requires every piece of evidence', () => {
  const partial = evaluateCompletionGate({ testsPassed: true, lintPassed: true });
  assert.equal(partial.complete, false);
  assert.ok(partial.missing.includes('npm run build passed'));
  assert.ok(partial.missing.includes('Neon test-branch integration tests passed'));

  const full = evaluateCompletionGate({
    testsPassed: true,
    lintPassed: true,
    buildPassed: true,
    databaseTestsPassed: true,
    pullRequestClean: true,
    noCriticalSecurityIssues: true,
    reportWritten: true,
    schedulerStopped: true,
  });
  assert.equal(full.complete, true);
  assert.deepEqual(full.missing, []);
});

test('production targets and forbidden operations are refused', () => {
  assert.ok(assertSafeTargets({ neonBranch: 'production' }).some((v) => v.code === 'PRODUCTION_ACTION_DENIED'));
  assert.ok(assertSafeTargets({ neonBranch: 'mission-003-test-20261030', baseBranch: 'main', operation: 'merge' })
    .some((v) => v.code === 'PRODUCTION_ACTION_DENIED'));
  assert.ok(assertSafeTargets({ operation: 'enable rls and grant roles' })
    .some((v) => v.code === 'POLICY_VIOLATION'));
  assert.equal(
    assertSafeTargets({ neonBranch: 'mission-003-test-20261030', baseBranch: 'mission-003-independent-work', operation: 'push' }).length,
    0,
  );
});

const fakeClient = (rows: Record<string, unknown>[], statements: string[] = []): SqlClient => ({
  query: async <T>(statement: string, _params?: unknown[]): Promise<T[]> => {
    statements.push(statement);
    return rows as T[];
  },
});

test('neon ledger maps snake_case lease rows onto the camelCase contract', async () => {
  const rows = [
    {
      lease_key: 'hinga:mission:MISSION-003',
      worker_id: 'worker-a',
      execution_id: 'exec-1',
      acquired_at: new Date('2026-10-31T00:00:00Z'),
      heartbeat_at: new Date('2026-10-31T00:01:00Z'),
      expires_at: new Date('2026-10-31T00:26:00Z'),
      released_at: null,
      release_reason: null,
    },
  ];
  const ledger = new NeonExecutionLedger(fakeClient(rows));
  const lease = await ledger.acquireLease({
    leaseKey: 'hinga:mission:MISSION-003',
    workerId: 'worker-a',
    executionId: 'exec-1',
    ttlMs: 25 * 60_000,
  });
  assert.ok(lease, 'expected the acquisition to succeed');
  assert.equal(lease.leaseKey, 'hinga:mission:MISSION-003');
  assert.equal(lease.workerId, 'worker-a');
  assert.equal(lease.executionId, 'exec-1');
  assert.equal(lease.acquiredAt, '2026-10-31T00:00:00.000Z');
  assert.equal(lease.heartbeatAt, '2026-10-31T00:01:00.000Z');
  assert.equal(lease.expiresAt, '2026-10-31T00:26:00.000Z');
  assert.equal(lease.releasedAt, undefined);
  assert.equal(lease.releaseReason, undefined);
});

test('neon lease rows keep released state and a lost acquisition returns null', async () => {
  const releasedRow = {
    lease_key: 'hinga:mission:MISSION-003',
    worker_id: 'worker-a',
    execution_id: 'exec-1',
    acquired_at: new Date('2026-10-30T23:00:00Z'),
    heartbeat_at: new Date('2026-10-30T23:20:00Z'),
    expires_at: new Date('2026-10-30T23:45:00Z'),
    released_at: new Date('2026-10-30T23:44:00Z'),
    release_reason: 'finished',
  };
  const ledger = new NeonExecutionLedger(fakeClient([releasedRow]));
  const lease = await ledger.getLease('hinga:mission:MISSION-003');
  assert.ok(lease, 'expected the released lease to still be readable');
  assert.equal(lease.releasedAt, '2026-10-30T23:44:00.000Z');
  assert.equal(lease.releaseReason, 'finished');

  const loser = new NeonExecutionLedger(fakeClient([]));
  const denied = await loser.acquireLease({
    leaseKey: 'hinga:mission:MISSION-003',
    workerId: 'worker-b',
    executionId: 'exec-2',
    ttlMs: 25 * 60_000,
  });
  assert.equal(denied, null, 'a lost upsert race must surface as null, not as a fake lease');
});

test('neon execution rows map onto the ExecutionRecord contract', async () => {
  const execRow = {
    execution_id: 'exec-9',
    mission_id: 'MISSION-003',
    worker_id: 'worker-a',
    worker_mode: 'base44_agent',
    idempotency_key: 'idem-9',
    status: 'succeeded',
    attempt: 1,
    max_attempts: 3,
    started_at: new Date('2026-10-31T00:00:00Z'),
    heartbeat_at: null,
    finished_at: new Date('2026-10-31T00:20:00Z'),
    error_code: null,
    error_message: null,
    commit_sha: 'abc1234',
    pull_request_url: 'https://github.com/Hinga-1/HINGA/pull/1',
    test_summary: { tests: 'passed', lint: 'passed' },
    estimated_cost_usd: '0.100000',
    actual_cost_usd: null,
    created_at: new Date('2026-10-31T00:00:00Z'),
    updated_at: new Date('2026-10-31T00:20:00Z'),
  };
  const ledger = new NeonExecutionLedger(fakeClient([execRow, execRow]));
  const finished = await ledger.finishExecution('exec-9', { status: 'succeeded' });
  assert.ok(finished, 'expected the finished record to be returned');
  assert.equal(finished.executionId, 'exec-9');
  assert.equal(finished.missionId, 'MISSION-003');
  assert.equal(finished.workerMode, 'base44_agent');
  assert.equal(finished.idempotencyKey, 'idem-9');
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.finishedAt, '2026-10-31T00:20:00.000Z');
  assert.equal(finished.heartbeatAt, undefined);
  assert.equal(finished.commitSha, 'abc1234');
  assert.equal(finished.pullRequestUrl, 'https://github.com/Hinga-1/HINGA/pull/1');
  assert.deepEqual(finished.testSummary, { tests: 'passed', lint: 'passed' });
  assert.equal(finished.estimatedCostUsd, 0.1);
  assert.equal(finished.actualCostUsd, undefined);
  const recent = await ledger.listRecent('MISSION-003');
  assert.equal(recent.length, 2, 'listRecent must map every row');
  assert.equal(recent[0].executionId, 'exec-9');
  assert.equal(recent[1].executionId, 'exec-9');
});
