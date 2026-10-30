import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * hingaTick - the deterministic scheduler gate for the HINGA autonomous worker.
 *
 * Runs on every 30-minute workflow tick and costs zero AI credits. It is the only
 * place allowed to decide that an execution may start:
 *   lease/contention -> stale recovery -> budget -> retry policy -> atomic claim.
 * The expensive agent step only runs when this returns action === 'invoke_worker'.
 *
 * Callers: the scheduled workflow (admin session) or an external worker holding a
 * valid HMAC signature (HINGA_WEBHOOK_SECRET). Nothing else.
 */

const MISSION_ID = 'MISSION-003';
const INTERVAL_MINUTES = 30;
const DEFAULT_LEASE_MINUTES = 25;

const PERMANENT_ERROR_CODES = [
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

const TRANSIENT_ERROR_CODES = [
  'NETWORK_ERROR',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM_5XX',
  'GITHUB_API_UNAVAILABLE',
  'NEON_UNAVAILABLE',
  'LEASE_CONTENTION',
  'WORKER_CRASH',
];

const now = () => Date.now();
const iso = (ms: number = now()) => new Date(ms).toISOString();
const minutesFromNow = (minutes: number) => iso(now() + minutes * 60_000);
const todayUtc = () => new Date().toISOString().slice(0, 10);

const isTransient = (code?: string) => {
  if (!code) return false;
  const c = String(code).toUpperCase();
  if (PERMANENT_ERROR_CODES.includes(c)) return false;
  return TRANSIENT_ERROR_CODES.includes(c);
};

const backoffMs = (attempt: number, base = 60_000, cap = 15 * 60_000) => {
  const exponential = base * 2 ** (Math.max(1, attempt) - 1);
  return Math.min(exponential, cap);
};

/** Half hour bucket, so two ticks in the same window cannot create two executions. */
const windowStart = () => {
  const d = new Date();
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / INTERVAL_MINUTES) * INTERVAL_MINUTES, 0, 0);
  return d.toISOString();
};

async function verifyHmac(req: Request, rawBody: string, secret: string) {
  const signature = req.headers.get('x-hinga-signature') || '';
  const timestamp = req.headers.get('x-hinga-timestamp') || '';
  if (!signature || !timestamp) return false;
  if (Math.abs(now() - Number(timestamp) * 1000) > 5 * 60_000) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const DEFAULT_STATE = {
  mission_id: MISSION_ID,
  mission_name: 'MISSION 003 - GitHub branch, PR #1, Neon test branch',
  status: 'active',
  scheduler_interval_minutes: INTERVAL_MINUTES,
  working_branch: 'mission-003-independent-work',
  base_branch: 'main',
  pull_request_url: 'https://github.com/Hinga-1/HINGA/pull/1',
  neon_project_id: 'falling-moon-75342440',
  neon_test_branch: 'mission-003-test-20261030',
  neon_production_branch: 'production',
  max_attempts: 3,
  execution_timeout_minutes: 25,
  heartbeat_stale_minutes: 20,
  daily_execution_budget: 8,
  daily_executions_used: 0,
  daily_ai_budget_usd: 1.5,
  daily_ai_used_usd: 0,
  notes: 'Production Neon and main are off-limits. Work lands on the mission branch and PR #1 only.',
};

async function loadState(base44: any) {
  const page = await base44.asServiceRole.entities.HingaAutomationState.filter(
    { mission_id: MISSION_ID },
    { sort: '-created_date', limit: 1 },
  );
  const existing = page?.items?.[0];
  if (existing) return { state: existing, created: false };
  const created = await base44.asServiceRole.entities.HingaAutomationState.create({
    ...DEFAULT_STATE,
    budget_reset_on: todayUtc(),
    next_run_at: minutesFromNow(INTERVAL_MINUTES),
  });
  return { state: created, created: true };
}

/** Alerts are deduplicated per type per day so a 30-minute loop cannot spam. */
async function raiseAlert(base44: any, type: string, severity: string, message: string, executionId?: string, details?: any) {
  const since = new Date(now() - 24 * 60 * 60 * 1000).toISOString();
  const existing = await base44.asServiceRole.entities.HingaAlert.filter(
    { alert_type: type, acknowledged: false },
    { sort: '-created_date', limit: 5 },
  );
  const duplicate = (existing?.items || []).some((a: any) => (a.created_date || '') >= since);
  if (duplicate) return { created: false, reason: 'duplicate_suppressed' };
  await base44.asServiceRole.entities.HingaAlert.create({
    alert_type: type,
    severity,
    message,
    execution_id: executionId,
    acknowledged: false,
    details: details ?? {},
  });
  return { created: true };
}

Deno.serve(async (req) => {
  let body: any = {};
  let rawBody = '';
  try {
    rawBody = await req.text();
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  const base44 = createClientFromRequest(req);

  // ---- authentication: admin session (workflow) or signed external worker ----
  let source = 'workflow';
  const secret = Deno.env.get('HINGA_WEBHOOK_SECRET');
  let authorised = false;
  if (secret && req.headers.get('x-hinga-signature')) {
    authorised = await verifyHmac(req, rawBody, secret);
    source = 'external_worker';
  }
  if (!authorised) {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    source = 'workflow';
  }

  try {
    const { state, created } = await loadState(base44);
    const leaseMinutes = Number(body.lease_minutes ?? DEFAULT_LEASE_MINUTES);
    const staleMinutes = Number(state.heartbeat_stale_minutes ?? 20);
    const staleCutoff = now() - staleMinutes * 60_000;

    // ---- daily budget reset ----
    let dailyUsed = Number(state.daily_executions_used ?? 0);
    let aiUsed = Number(state.daily_ai_used_usd ?? 0);
    let budgetDay = state.budget_reset_on || todayUtc();
    if (budgetDay !== todayUtc()) {
      dailyUsed = 0;
      aiUsed = 0;
      budgetDay = todayUtc();
      await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
        daily_executions_used: 0,
        daily_ai_used_usd: 0,
        budget_reset_on: budgetDay,
      });
    }

    // ---- scheduler lifecycle ----
    if (state.status === 'completed') {
      return Response.json({
        ok: true,
        action: 'skip',
        reason: 'mission_completed',
        scheduler_should_stop: true,
        mission_id: MISSION_ID,
        message: 'Mission ilikamilika. Scheduler inapaswa kuzimwa (deactivate workflow).',
      });
    }
    if (state.status === 'paused' || state.status === 'disabled') {
      return Response.json({ ok: true, action: 'skip', reason: `scheduler_${state.status}`, mission_id: MISSION_ID });
    }

    // ---- stale recovery: a dead worker must never hold the slot ----
    const runningPage = await base44.asServiceRole.entities.HingaExecution.filter(
      { mission_id: MISSION_ID, status: 'running' },
      { sort: '-created_date', limit: 10 },
    );
    const recovered: string[] = [];
    for (const run of runningPage?.items || []) {
      const heartbeat = run.heartbeat_at || run.started_at || run.created_date;
      if (new Date(heartbeat).getTime() < staleCutoff) {
        await base44.asServiceRole.entities.HingaExecution.update(run.id, {
          status: 'timed_out',
          error_code: 'WORKER_CRASH',
          error_message: `heartbeat imepitwa na ${staleMinutes} dakika`,
          finished_at: iso(),
        });
        recovered.push(run.execution_id);
      }
    }
    if (recovered.length > 0) {
      await raiseAlert(
        base44,
        'EXECUTION_STALE_RECOVERED',
        'warning',
        `Execution ${recovered.join(', ')} ilikosa heartbeat; imewekwa timed_out na nafasi imefunguliwa.`,
        recovered[0],
      );
      await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
        current_worker_id: '',
        current_execution_id: '',
        lease_expires_at: '',
      });
    }

    // ---- single active execution / live lease ----
    const queuedPage = await base44.asServiceRole.entities.HingaExecution.filter(
      { mission_id: MISSION_ID, status: 'queued' },
      { sort: '-created_date', limit: 10 },
    );
    const activeCandidates = [...(runningPage?.items || []), ...(queuedPage?.items || [])].filter(
      (run: any) => !recovered.includes(run.execution_id),
    );
    const leaseLive = state.lease_expires_at ? new Date(state.lease_expires_at).getTime() > now() : false;
    if (activeCandidates.length > 0 && leaseLive) {
      const active = activeCandidates[0];
      return Response.json({
        ok: true,
        action: 'already_running',
        reason: 'another_worker_holds_the_lease',
        execution_id: active.execution_id,
        worker_id: active.worker_id,
        lease_expires_at: state.lease_expires_at,
        message: 'Execution bado inaendelea. Hakuna execution mpya itakayoanzishwa.',
      });
    }

    // ---- cost controls ----
    const execBudget = Number(state.daily_execution_budget ?? 8);
    const aiBudget = Number(state.daily_ai_budget_usd ?? 1.5);
    if (dailyUsed >= execBudget) {
      await raiseAlert(base44, 'DAILY_EXECUTION_BUDGET_REACHED', 'warning', `Budget ya executions ya leo imefika (${dailyUsed}/${execBudget}).`, undefined, { dailyUsed, execBudget });
      return Response.json({ ok: true, action: 'skip', reason: 'execution_budget_reached', daily_used: dailyUsed, budget: execBudget });
    }
    if (aiUsed >= aiBudget) {
      await raiseAlert(base44, 'DAILY_AI_BUDGET_REACHED', 'warning', `Budget ya AI ya leo imefika ($${aiUsed}/$${aiBudget}).`, undefined, { aiUsed, aiBudget });
      return Response.json({ ok: true, action: 'skip', reason: 'ai_budget_reached', ai_used: aiUsed, budget: aiBudget });
    }

    // ---- retry / recovery policy ----
    const failedPage = await base44.asServiceRole.entities.HingaExecution.filter(
      { mission_id: MISSION_ID },
      { sort: '-created_date', limit: 10 },
    );
    const lastDriven = (failedPage?.items || []).find((run: any) => ['failed', 'timed_out', 'blocked'].includes(run.status));
    let attempt = 1;
    if (lastDriven) {
      if (!isTransient(lastDriven.error_code)) {
        const code = lastDriven.error_code || 'UNKNOWN';
        if (lastDriven.status === 'blocked' || PERMANENT_ERROR_CODES.includes(code)) {
          await raiseAlert(
            base44,
            'PERMANENT_FAILURE_BLOCKED',
            'critical',
            `Execution ${lastDriven.execution_id} imesimama na ${code}. Retry haitafanyika bila code change.`,
            lastDriven.execution_id,
            { error_code: code, error_message: lastDriven.error_message },
          );
          return Response.json({
            ok: true,
            action: 'skip',
            reason: 'requires_code_change',
            error_code: code,
            execution_id: lastDriven.execution_id,
            message: 'Kosa la kudumu. Worker hairudii kazi hii bila mabadiliko ya code.',
          });
        }
      }
      const maxAttempts = Math.min(Number(state.max_attempts ?? 3), Number(lastDriven.max_attempts ?? 3));
      if (Number(lastDriven.attempt ?? 1) >= maxAttempts) {
        await raiseAlert(
          base44,
          'MAX_ATTEMPTS_EXHAUSTED',
          'critical',
          `Execution ${lastDriven.execution_id} imefikisha max attempts (${maxAttempts}).`,
          lastDriven.execution_id,
          { last_error: lastDriven.error_code },
        );
        return Response.json({
          ok: true,
          action: 'skip',
          reason: 'max_attempts_exhausted',
          execution_id: lastDriven.execution_id,
          attempts: lastDriven.attempt,
        });
      }
      if (isTransient(lastDriven.error_code)) {
        const finished = new Date(lastDriven.finished_at || lastDriven.updated_date || lastDriven.created_date).getTime();
        const readyAt = finished + backoffMs(Number(lastDriven.attempt ?? 1));
        if (readyAt > now()) {
          return Response.json({
            ok: true,
            action: 'skip',
            reason: 'waiting_for_backoff',
            retry_at: iso(readyAt),
            attempt: Number(lastDriven.attempt ?? 1) + 1,
          });
        }
        await raiseAlert(base44, 'REPEATED_RETRIES', 'warning', `Retry ya execution ${lastDriven.execution_id} inaanza (attempt ${Number(lastDriven.attempt ?? 1) + 1}).`, lastDriven.execution_id);
        attempt = Number(lastDriven.attempt ?? 1) + 1;
      }
    }

    // ---- atomic claim: create execution, take lease, verify we won ----
    const workerId = body.worker_id ? String(body.worker_id) : `base44-agent-${crypto.randomUUID().slice(0, 8)}`;
    const executionId = `exec_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const idempotencyKey = `${MISSION_ID}:${windowStart()}:a${attempt}`;

    const duplicate = await base44.asServiceRole.entities.HingaExecution.filter(
      { idempotency_key: idempotencyKey },
      { limit: 1 },
    );
    if (duplicate?.items?.length) {
      return Response.json({
        ok: true,
        action: 'already_running',
        reason: 'idempotency_key_already_claimed',
        execution_id: duplicate.items[0].execution_id,
      });
    }

    const execution = await base44.asServiceRole.entities.HingaExecution.create({
      execution_id: executionId,
      mission_id: MISSION_ID,
      worker_id: workerId,
      worker_mode: source === 'external_worker' ? 'external_manus' : 'base44_agent',
      idempotency_key: idempotencyKey,
      status: 'queued',
      attempt,
      max_attempts: Math.min(Number(state.max_attempts ?? 3), 5),
      heartbeat_at: iso(),
      test_summary: {},
      estimated_cost_usd: 0.05,
    });

    const leaseExpiresAt = minutesFromNow(leaseMinutes);
    await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
      status: 'active',
      current_worker_id: workerId,
      current_execution_id: executionId,
      lease_expires_at: leaseExpiresAt,
      last_run_at: iso(),
      last_execution_id: executionId,
      next_run_at: minutesFromNow(INTERVAL_MINUTES),
      daily_executions_used: dailyUsed + 1,
      budget_reset_on: budgetDay,
    });

    // The update above is last-write-wins. Re-read: only the worker whose id
    // survived may proceed, so two simultaneous claims never both run.
    const verify = await base44.asServiceRole.entities.HingaAutomationState.filter({ mission_id: MISSION_ID }, { limit: 1 });
    const winnerId = verify?.items?.[0]?.current_execution_id;
    if (winnerId && winnerId !== executionId) {
      await base44.asServiceRole.entities.HingaExecution.update(execution.id, {
        status: 'failed',
        error_code: 'LEASE_CONTENTION',
        error_message: `Worker mwingine (${winnerId}) alishinda lease.`,
        finished_at: iso(),
      });
      return Response.json({
        ok: true,
        action: 'already_running',
        reason: 'lease_lost_during_claim',
        execution_id: winnerId,
      });
    }

    return Response.json({
      ok: true,
      action: 'invoke_worker',
      mission_id: MISSION_ID,
      execution_id: executionId,
      execution_record_id: execution.id,
      worker_id: workerId,
      attempt,
      lease_expires_at: leaseExpiresAt,
      working_branch: state.working_branch || 'mission-003-independent-work',
      base_branch: state.base_branch || 'main',
      pull_request_url: state.pull_request_url || 'https://github.com/Hinga-1/HINGA/pull/1',
      neon_test_branch: state.neon_test_branch || 'mission-003-test-20261030',
      state_created: created,
      recovered_executions: recovered,
      budgets: {
        executions: { used: dailyUsed + 1, limit: execBudget },
        ai_usd: { used: aiUsed, limit: aiBudget },
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, action: 'error', error: String((error as Error)?.message || error) },
      { status: 500 },
    );
  }
});
