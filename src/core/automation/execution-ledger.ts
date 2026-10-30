/**
 * Mission 003 - durable execution ledger, cross-worker lease, retry policy and
 * completion gate for the autonomous engineering worker.
 *
 * Design constraints that shaped this module:
 * - The worker may run from more than one runtime (Base44 agent, external worker,
 *   GitHub Actions). They only share the Neon database, so correctness cannot rely
 *   on in-process state.
 * - Neon is reached through a stateless HTTP driver, so a session advisory lock
 *   cannot be held across statements. The lease is therefore a row guarded by an
 *   atomic conditional upsert. Database checks (unique index on active executions)
 *   provide the second line of defence.
 */

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'timed_out';

export type WorkerMode = 'base44_agent' | 'external_manus' | 'github_actions' | 'manual';

export const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'timed_out',
];

export interface ExecutionRecord {
  executionId: string;
  missionId: string;
  workerId: string;
  workerMode: WorkerMode;
  idempotencyKey: string;
  status: ExecutionStatus;
  attempt: number;
  maxAttempts: number;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  testSummary: Record<string, unknown>;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaseRecord {
  leaseKey: string;
  workerId: string;
  executionId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt?: string;
  releaseReason?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  staleAfterMs: number;
  executionTimeoutMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseBackoffMs: 60_000,
  maxBackoffMs: 15 * 60_000,
  staleAfterMs: 20 * 60_000,
  executionTimeoutMs: 25 * 60_000,
};

/**
 * Permanent errors need a code change before another attempt is meaningful.
 * Retrying them only burns budget and produces duplicate side effects.
 */
export const PERMANENT_ERROR_CODES: readonly string[] = [
  'AUTH_FAILED',
  'GITHUB_AUTH_FAILED',
  'GITHUB_SCOPE_MISSING',
  'NEON_AUTH_FAILED',
  'PRODUCTION_ACTION_DENIED',
  'SECRET_LEAK_DETECTED',
  'POLICY_VIOLATION',
  'TEST_FAILED',
  'LINT_FAILED',
  'BUILD_FAILED',
  'MIGRATION_CHECK_FAILED',
  'INVALID_INPUT',
  'WORKER_NOT_CONFIGURED',
];

export const TRANSIENT_ERROR_CODES: readonly string[] = [
  'NETWORK_ERROR',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM_5XX',
  'GITHUB_API_UNAVAILABLE',
  'NEON_UNAVAILABLE',
  'LEASE_CONTENTION',
  'WORKER_CRASH',
];

export function isTransientError(code: string | undefined): boolean {
  if (!code) return false;
  const normalized = code.toUpperCase();
  if (PERMANENT_ERROR_CODES.includes(normalized)) return false;
  return TRANSIENT_ERROR_CODES.includes(normalized);
}

/**
 * Exponential backoff with bounded deterministic jitter so that two workers that
 * fail together do not retry in lockstep. The seed keeps tests reproducible.
 */
export function computeBackoffMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  seed = 'hinga',
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = policy.baseBackoffMs * 2 ** (safeAttempt - 1);
  const capped = Math.min(exponential, policy.maxBackoffMs);
  const jitterWindow = Math.floor(capped * 0.2);
  const jitter = jitterWindow > 0 ? hashSeed(`${seed}:${safeAttempt}`) % jitterWindow : 0;
  return Math.min(capped + jitter, policy.maxBackoffMs);
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function isLeaseActive(lease: LeaseRecord | undefined, now = new Date()): boolean {
  if (!lease) return false;
  if (lease.releasedAt) return false;
  return new Date(lease.expiresAt).getTime() > now.getTime();
}

export function isStale(
  record: ExecutionRecord,
  now = new Date(),
  staleAfterMs = DEFAULT_RETRY_POLICY.staleAfterMs,
): boolean {
  if (record.status !== 'running') return false;
  const reference = record.heartbeatAt ?? record.startedAt ?? record.createdAt;
  return now.getTime() - new Date(reference).getTime() > staleAfterMs;
}

export type NextAction =
  | 'start'
  | 'already_running'
  | 'retry'
  | 'wait_backoff'
  | 'exhausted'
  | 'do_not_retry';

export interface Decision {
  action: NextAction;
  reason: string;
  attempt?: number;
  waitMs?: number;
}

/**
 * Pure decision function for "may this worker start an execution right now".
 * `activeExecution` is the newest queued/running record for the mission, if any.
 */
export function decideNextAction(input: {
  activeExecution?: ExecutionRecord;
  lastFailedExecution?: ExecutionRecord;
  now?: Date;
  policy?: RetryPolicy;
  lease?: LeaseRecord;
}): Decision {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const now = input.now ?? new Date();
  const active = input.activeExecution;

  if (active && !isStale(active, now, policy.staleAfterMs)) {
    return { action: 'already_running', reason: `execution ${active.executionId} is still live`, attempt: active.attempt };
  }

  if (isLeaseActive(input.lease, now) && input.lease?.workerId !== active?.workerId) {
    return { action: 'already_running', reason: `lease held by ${input.lease?.workerId}` };
  }

  const previous = input.lastFailedExecution;
  if (!previous) return { action: 'start', reason: 'no previous failed execution', attempt: 1 };

  if (!isTransientError(previous.errorCode)) {
    return {
      action: 'do_not_retry',
      reason: `permanent error ${previous.errorCode ?? 'UNKNOWN'} requires a code change`,
      attempt: previous.attempt,
    };
  }

  if (previous.attempt >= Math.min(previous.maxAttempts, policy.maxAttempts)) {
    return { action: 'exhausted', reason: 'max attempts reached', attempt: previous.attempt };
  }

  const finishedAt = previous.finishedAt ?? previous.updatedAt;
  const backoffMs = computeBackoffMs(previous.attempt, policy, previous.idempotencyKey);
  const readyAt = new Date(finishedAt).getTime() + backoffMs;
  if (readyAt > now.getTime()) {
    return {
      action: 'wait_backoff',
      reason: `backoff until ${new Date(readyAt).toISOString()}`,
      attempt: previous.attempt + 1,
      waitMs: readyAt - now.getTime(),
    };
  }

  return { action: 'retry', reason: 'transient error and backoff elapsed', attempt: previous.attempt + 1 };
}

export interface CompletionEvidence {
  testsPassed: boolean;
  lintPassed: boolean;
  buildPassed: boolean;
  databaseTestsPassed: boolean;
  pullRequestClean: boolean;
  noCriticalSecurityIssues: boolean;
  reportWritten: boolean;
  schedulerStopped: boolean;
}

export const COMPLETION_EVIDENCE_LABELS: Record<keyof CompletionEvidence, string> = {
  testsPassed: 'npm test passed',
  lintPassed: 'npm run lint passed',
  buildPassed: 'npm run build passed',
  databaseTestsPassed: 'Neon test-branch integration tests passed',
  pullRequestClean: 'pull request is clean and mergeable',
  noCriticalSecurityIssues: 'no unresolved critical security issue',
  reportWritten: 'final mission report written',
  schedulerStopped: 'scheduler disabled after evidence confirmation',
};

/** Mission completion is evidence-based: code written is never sufficient. */
export function evaluateCompletionGate(evidence: Partial<CompletionEvidence>): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  for (const key of Object.keys(COMPLETION_EVIDENCE_LABELS) as (keyof CompletionEvidence)[]) {
    if (evidence[key] !== true) missing.push(COMPLETION_EVIDENCE_LABELS[key]);
  }
  return { complete: missing.length === 0, missing };
}

export interface TargetGuardInput {
  neonBranch?: string;
  baseBranch?: string;
  operation?: string;
}

export interface TargetViolation {
  code: string;
  message: string;
}

/** Hard security boundary from the mission brief. Never advisory-only. */
export function assertSafeTargets(input: TargetGuardInput): TargetViolation[] {
  const violations: TargetViolation[] = [];
  const branch = (input.neonBranch ?? '').toLowerCase();
  const base = (input.baseBranch ?? '').toLowerCase();
  const operation = (input.operation ?? '').toLowerCase();

  if (branch === 'production' || branch === 'main' || branch === '') {
    violations.push({
      code: 'PRODUCTION_ACTION_DENIED',
      message: 'Neon operations require an explicit non-production branch',
    });
  }
  if (base === 'main' && /merge|push|commit/.test(operation)) {
    violations.push({
      code: 'PRODUCTION_ACTION_DENIED',
      message: 'direct writes to main are forbidden, work happens on the mission branch and a PR',
    });
  }
  if (/fine-?tun|role|grant|drop\s+schema|truncate/.test(operation)) {
    violations.push({
      code: 'POLICY_VIOLATION',
      message: `operation "${input.operation}" is outside the worker allowlist`,
    });
  }
  return violations;
}

export interface LeaseRequest {
  leaseKey: string;
  workerId: string;
  executionId: string;
  ttlMs: number;
}

export interface ExecutionLedger {
  acquireLease(request: LeaseRequest): Promise<LeaseRecord | null>;
  getLease(leaseKey: string): Promise<LeaseRecord | undefined>;
  heartbeatLease(leaseKey: string, workerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(leaseKey: string, workerId: string, reason: string): Promise<boolean>;
  createExecution(record: ExecutionRecord): Promise<{ created: boolean; record: ExecutionRecord }>;
  markRunning(executionId: string, startedAt: string): Promise<boolean>;
  finishExecution(
    executionId: string,
    patch: Partial<ExecutionRecord> & { status: ExecutionStatus },
  ): Promise<ExecutionRecord | undefined>;
  findActiveExecution(missionId: string): Promise<ExecutionRecord | undefined>;
  findLastFailedExecution(missionId: string): Promise<ExecutionRecord | undefined>;
  listRecent(missionId: string, limit?: number): Promise<ExecutionRecord[]>;
}

export class InMemoryExecutionLedger implements ExecutionLedger {
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly leases = new Map<string, LeaseRecord>();

  async acquireLease(request: LeaseRequest): Promise<LeaseRecord | null> {
    const now = new Date();
    const existing = this.leases.get(request.leaseKey);
    if (existing && !existing.releasedAt && new Date(existing.expiresAt).getTime() > now.getTime()) {
      return null;
    }
    const lease: LeaseRecord = {
      leaseKey: request.leaseKey,
      workerId: request.workerId,
      executionId: request.executionId,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
    };
    this.leases.set(request.leaseKey, lease);
    return lease;
  }

  async getLease(leaseKey: string): Promise<LeaseRecord | undefined> {
    const lease = this.leases.get(leaseKey);
    return lease ? { ...lease } : undefined;
  }

  async heartbeatLease(leaseKey: string, workerId: string, ttlMs: number): Promise<boolean> {
    const lease = this.leases.get(leaseKey);
    if (!lease || lease.releasedAt || lease.workerId !== workerId) return false;
    const now = new Date();
    lease.heartbeatAt = now.toISOString();
    lease.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    return true;
  }

  async releaseLease(leaseKey: string, workerId: string, reason: string): Promise<boolean> {
    const lease = this.leases.get(leaseKey);
    if (!lease || lease.workerId !== workerId || lease.releasedAt) return false;
    lease.releasedAt = new Date().toISOString();
    lease.releaseReason = reason;
    return true;
  }

  async createExecution(record: ExecutionRecord): Promise<{ created: boolean; record: ExecutionRecord }> {
    const duplicate = Array.from(this.executions.values()).find(
      (execution) => execution.idempotencyKey === record.idempotencyKey,
    );
    if (duplicate) return { created: false, record: { ...duplicate } };
    this.executions.set(record.executionId, { ...record });
    return { created: true, record: { ...record } };
  }

  async markRunning(executionId: string, startedAt: string): Promise<boolean> {
    const record = this.executions.get(executionId);
    if (!record || record.status !== 'queued') return false;
    record.status = 'running';
    record.startedAt = startedAt;
    record.heartbeatAt = startedAt;
    record.updatedAt = startedAt;
    return true;
  }

  async finishExecution(
    executionId: string,
    patch: Partial<ExecutionRecord> & { status: ExecutionStatus },
  ): Promise<ExecutionRecord | undefined> {
    const record = this.executions.get(executionId);
    if (!record) return undefined;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return { ...record };
  }

  async findActiveExecution(missionId: string): Promise<ExecutionRecord | undefined> {
    const active = Array.from(this.executions.values())
      .filter((record) => record.missionId === missionId && ['queued', 'running'].includes(record.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return active[0] ? { ...active[0] } : undefined;
  }

  async findLastFailedExecution(missionId: string): Promise<ExecutionRecord | undefined> {
    const failed = Array.from(this.executions.values())
      .filter((record) => record.missionId === missionId && ['failed', 'timed_out'].includes(record.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return failed[0] ? { ...failed[0] } : undefined;
  }

  async listRecent(missionId: string, limit = 20): Promise<ExecutionRecord[]> {
    return Array.from(this.executions.values())
      .filter((record) => record.missionId === missionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }
}

/** Minimal surface of @neondatabase/serverless used here, so tests need no database. */
export interface SqlClient {
  query<T = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T[]>;
}

export class NeonExecutionLedger implements ExecutionLedger {
  constructor(
    private readonly client: SqlClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async acquireLease(request: LeaseRequest): Promise<LeaseRecord | null> {
    const rows = await this.client.query<LeaseRecord>(
      `INSERT INTO hinga_worker_leases (lease_key, worker_id, execution_id, heartbeat_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + make_interval(secs => $4))
       ON CONFLICT (lease_key) DO UPDATE
         SET worker_id = EXCLUDED.worker_id,
             execution_id = EXCLUDED.execution_id,
             acquired_at = NOW(),
             heartbeat_at = NOW(),
             expires_at = EXCLUDED.expires_at,
             released_at = NULL,
             release_reason = NULL
         WHERE hinga_worker_leases.released_at IS NOT NULL
            OR hinga_worker_leases.expires_at < NOW()
       RETURNING lease_key, worker_id, execution_id, acquired_at, heartbeat_at, expires_at`,
      [request.leaseKey, request.workerId, request.executionId, Math.ceil(request.ttlMs / 1000)],
    );
    return rows[0] ?? null;
  }

  async getLease(leaseKey: string): Promise<LeaseRecord | undefined> {
    const rows = await this.client.query<LeaseRecord>(
      `SELECT lease_key, worker_id, execution_id, acquired_at, heartbeat_at, expires_at, released_at, release_reason
         FROM hinga_worker_leases WHERE lease_key = $1`,
      [leaseKey],
    );
    return rows[0];
  }

  async heartbeatLease(leaseKey: string, workerId: string, ttlMs: number): Promise<boolean> {
    const rows = await this.client.query(
      `UPDATE hinga_worker_leases
          SET heartbeat_at = NOW(),
              expires_at = NOW() + make_interval(secs => $3)
        WHERE lease_key = $1 AND worker_id = $2 AND released_at IS NULL
        RETURNING lease_key`,
      [leaseKey, workerId, Math.ceil(ttlMs / 1000)],
    );
    return rows.length > 0;
  }

  async releaseLease(leaseKey: string, workerId: string, reason: string): Promise<boolean> {
    const rows = await this.client.query(
      `UPDATE hinga_worker_leases
          SET released_at = NOW(), release_reason = $3
        WHERE lease_key = $1 AND worker_id = $2 AND released_at IS NULL
        RETURNING lease_key`,
      [leaseKey, workerId, reason],
    );
    return rows.length > 0;
  }

  async createExecution(record: ExecutionRecord): Promise<{ created: boolean; record: ExecutionRecord }> {
    try {
      const rows = await this.client.query<ExecutionRecord>(
        `INSERT INTO hinga_executions
           (execution_id, mission_id, worker_id, worker_mode, idempotency_key, status, attempt, max_attempts,
            estimated_cost_usd, test_summary, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING execution_id`,
        [
          record.executionId,
          record.missionId,
          record.workerId,
          record.workerMode,
          record.idempotencyKey,
          record.status,
          record.attempt,
          record.maxAttempts,
          record.estimatedCostUsd,
          JSON.stringify(record.testSummary ?? {}),
        ],
      );
      if (rows.length > 0) return { created: true, record };
    } catch (error) {
      // Unique index on active executions: another worker won the race.
      if (!/duplicate key|unique/i.test(String(error))) throw error;
    }
    const existing = await this.client.query<ExecutionRecord>(
      `SELECT * FROM hinga_executions WHERE idempotency_key = $1 OR (mission_id = $2 AND status IN ('queued','running'))
         ORDER BY created_at DESC LIMIT 1`,
      [record.idempotencyKey, record.missionId],
    );
    return { created: false, record: existing[0] ?? record };
  }

  async markRunning(executionId: string, startedAt: string): Promise<boolean> {
    const rows = await this.client.query(
      `UPDATE hinga_executions
          SET status = 'running', started_at = $2, heartbeat_at = $2, updated_at = NOW()
        WHERE execution_id = $1 AND status = 'queued'
        RETURNING execution_id`,
      [executionId, startedAt],
    );
    return rows.length > 0;
  }

  async finishExecution(
    executionId: string,
    patch: Partial<ExecutionRecord> & { status: ExecutionStatus },
  ): Promise<ExecutionRecord | undefined> {
    const rows = await this.client.query<ExecutionRecord>(
      `UPDATE hinga_executions
          SET status = $2,
              finished_at = COALESCE($3, NOW()),
              heartbeat_at = COALESCE($4, heartbeat_at),
              error_code = $5,
              error_message = $6,
              commit_sha = COALESCE($7, commit_sha),
              pull_request_url = COALESCE($8, pull_request_url),
              test_summary = COALESCE($9::jsonb, test_summary),
              actual_cost_usd = COALESCE($10, actual_cost_usd),
              updated_at = NOW()
        WHERE execution_id = $1
        RETURNING *`,
      [
        executionId,
        patch.status,
        patch.finishedAt ?? null,
        patch.heartbeatAt ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        patch.commitSha ?? null,
        patch.pullRequestUrl ?? null,
        patch.testSummary ? JSON.stringify(patch.testSummary) : null,
        patch.actualCostUsd ?? null,
      ],
    );
    return rows[0];
  }

  async findActiveExecution(missionId: string): Promise<ExecutionRecord | undefined> {
    const rows = await this.client.query<ExecutionRecord>(
      `SELECT * FROM hinga_executions WHERE mission_id = $1 AND status IN ('queued','running')
         ORDER BY created_at DESC LIMIT 1`,
      [missionId],
    );
    return rows[0];
  }

  async findLastFailedExecution(missionId: string): Promise<ExecutionRecord | undefined> {
    const rows = await this.client.query<ExecutionRecord>(
      `SELECT * FROM hinga_executions WHERE mission_id = $1 AND status IN ('failed','timed_out')
         ORDER BY updated_at DESC LIMIT 1`,
      [missionId],
    );
    return rows[0];
  }

  async listRecent(missionId: string, limit = 20): Promise<ExecutionRecord[]> {
    return this.client.query<ExecutionRecord>(
      `SELECT * FROM hinga_executions WHERE mission_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [missionId, limit],
    );
  }

  /**
   * Recovery sweep: any running execution whose heartbeat is older than the stale
   * window becomes timed_out so the next tick can proceed. Never leaves a lease
   * that outlives its worker.
   */
  async recoverStaleExecutions(missionId: string, staleAfterMs: number): Promise<string[]> {
    const rows = await this.client.query<{ execution_id: string }>(
      `UPDATE hinga_executions
          SET status = 'timed_out',
              error_code = 'WORKER_CRASH',
              error_message = 'heartbeat expired',
              finished_at = NOW(),
              updated_at = NOW()
        WHERE mission_id = $1
          AND status = 'running'
          AND COALESCE(heartbeat_at, started_at, created_at) < NOW() - make_interval(secs => $2)
        RETURNING execution_id`,
      [missionId, Math.ceil(staleAfterMs / 1000)],
    );
    await this.client.query(
      `UPDATE hinga_worker_leases
          SET released_at = NOW(), release_reason = 'lease_expired'
        WHERE lease_key = $1 AND released_at IS NULL AND expires_at < NOW()`,
      [`hinga:mission:${missionId}`],
    );
    return rows.map((row) => row.execution_id);
  }
}
