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
  type ExecutionRecord,
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
