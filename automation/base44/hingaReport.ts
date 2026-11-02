import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * hingaReport - heartbeat and result recording for a HINGA execution.
 *
 * Rules enforced here:
 *  - only the worker that owns the lease may extend or finish it
 *  - a worker cannot report `succeeded` without test/lint/build evidence
 *  - secrets are redacted from anything that reaches storage or logs
 *  - finishing always releases the lease so the next tick can proceed
 */

const MISSION_ID = 'MISSION-003';
const TERMINAL = ['succeeded', 'failed', 'blocked', 'timed_out'];

const REDACTIONS: Array<[RegExp, string]> = [
  [/ghp_[A-Za-z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]'],
  [/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [REDACTED]'],
  [/sk-[A-Za-z0-9]{16,}/g, '[REDACTED_API_KEY]'],
  [/eyJ[A-Za-z0-9._-]{20,}/g, '[REDACTED_JWT]'],
  [/(?:password|secret|token)\s*[:=]\s*\S+/gi, '[REDACTED]'],
];

const redact = (value: unknown): string => {
  let text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, 4000);
};

const iso = () => new Date().toISOString();

async function raiseAlert(base44: any, type: string, severity: string, message: string, executionId?: string, details?: any) {
  await base44.asServiceRole.entities.HingaAlert.create({
    alert_type: type,
    severity,
    message,
    execution_id: executionId,
    acknowledged: false,
    details: details ?? {},
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const owner = await base44.auth.me().catch(() => null);
  if (!owner) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  if (owner.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const executionId = String(body.execution_id || '');
  const workerId = String(body.worker_id || '');
  const requested = body.status ? String(body.status) : '';
  if (!executionId) return Response.json({ ok: false, error: 'execution_id is required' }, { status: 400 });

  try {
    const found = await base44.asServiceRole.entities.HingaExecution.filter({ execution_id: executionId }, { limit: 1 });
    const execution = found?.items?.[0];
    if (!execution) return Response.json({ ok: false, error: 'execution_not_found' }, { status: 404 });
    if (workerId && execution.worker_id && workerId !== execution.worker_id) {
      return Response.json({ ok: false, error: 'worker_does_not_own_execution' }, { status: 409 });
    }
    if (TERMINAL.includes(execution.status) && requested && requested !== execution.status) {
      return Response.json({
        ok: true,
        already_finished: true,
        execution_id: executionId,
        status: execution.status,
        message: 'Execution ilikwisha kamilika; taarifa mpya haitabadilisha rekodi.',
      });
    }

    // ---- heartbeat only ----
    if (!requested || requested === 'running') {
      const heartbeatAt = iso();
      await base44.asServiceRole.entities.HingaExecution.update(execution.id, {
        status: execution.status === 'queued' ? 'running' : execution.status,
        heartbeat_at: heartbeatAt,
        started_at: execution.started_at || heartbeatAt,
        step_summary: body.step_summary ? redact(body.step_summary) : execution.step_summary,
      });
      const statePage = await base44.asServiceRole.entities.HingaAutomationState.filter({ mission_id: MISSION_ID }, { limit: 1 });
      const state = statePage?.items?.[0];
      if (state && state.current_execution_id === executionId) {
        const leaseMinutes = Number(state.execution_timeout_minutes ?? 25);
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
          lease_expires_at: new Date(Date.now() + leaseMinutes * 60_000).toISOString(),
        });
      }
      return Response.json({ ok: true, action: 'heartbeat', execution_id: executionId, heartbeat_at: heartbeatAt });
    }

    if (!TERMINAL.includes(requested)) {
      return Response.json({ ok: false, error: `invalid status: ${requested}` }, { status: 400 });
    }

    // ---- terminal report: evidence is mandatory for success ----
    const summary = body.test_summary && typeof body.test_summary === 'object' ? body.test_summary : {};
    const evidence = {
      tests: summary.tests ?? 'unknown',
      lint: summary.lint ?? 'unknown',
      build: summary.build ?? 'unknown',
      database: summary.database ?? 'not_run',
      github_actions: summary.github_actions ?? 'unknown',
      security: summary.security ?? 'unknown',
    };
    let status = requested;
    let errorCode = body.error_code ? String(body.error_code) : undefined;
    let errorMessage = body.error_message ? redact(body.error_message) : undefined;

    if (status === 'succeeded') {
      const missing = ['tests', 'lint', 'build'].filter((key) => (evidence as any)[key] !== 'passed');
      if (missing.length > 0) {
        status = 'failed';
        errorCode = 'TEST_FAILED';
        errorMessage = `Worker ilidai success bila evidence: ${missing.join(', ')} haijapitwa.`;
      }
    }

    const finishedAt = iso();
    await base44.asServiceRole.entities.HingaExecution.update(execution.id, {
      status,
      finished_at: finishedAt,
      heartbeat_at: finishedAt,
      commit_sha: body.commit_sha ? String(body.commit_sha).slice(0, 64) : execution.commit_sha,
      pull_request_url: body.pull_request_url ? String(body.pull_request_url) : execution.pull_request_url,
      test_summary: evidence,
      error_code: errorCode || '',
      error_message: errorMessage || '',
      actual_cost_usd: body.actual_cost_usd != null ? Number(body.actual_cost_usd) : execution.actual_cost_usd,
      step_summary: body.step_summary ? redact(body.step_summary) : execution.step_summary,
      logs_summary: body.logs_summary ? redact(body.logs_summary) : execution.logs_summary,
    });

    // ---- release the lease and update mission state ----
    const statePage = await base44.asServiceRole.entities.HingaAutomationState.filter({ mission_id: MISSION_ID }, { limit: 1 });
    const state = statePage?.items?.[0];
    const statePatch: Record<string, any> = {
      current_worker_id: '',
      current_execution_id: '',
      lease_expires_at: '',
      last_execution_id: executionId,
      last_test_summary: JSON.stringify(evidence),
      tests_status: evidence.tests,
      pr_status: evidence.github_actions,
    };
    if (status === 'succeeded' && body.commit_sha) statePatch.last_successful_commit = String(body.commit_sha);
    if (status === 'blocked') statePatch.status = 'blocked';
    if (body.evidence && typeof body.evidence === 'object') statePatch.evidence = body.evidence;
    if (body.actual_cost_usd != null && state) {
      statePatch.daily_ai_used_usd = Number(state.daily_ai_used_usd ?? 0) + Number(body.actual_cost_usd);
    }
    if (state) await base44.asServiceRole.entities.HingaAutomationState.update(state.id, statePatch);

    // ---- alerts ----
    if (status === 'failed') {
      await raiseAlert(base44, 'WORKER_FAILURE', 'critical', `Execution ${executionId} imefeli: ${errorCode || 'unknown'} - ${errorMessage || ''}`.slice(0, 500), executionId, { attempt: execution.attempt });
    }
    if (status === 'timed_out') {
      await raiseAlert(base44, 'EXECUTION_TIMEOUT', 'warning', `Execution ${executionId} imeisha muda wake.`, executionId);
    }
    if (status === 'blocked') {
      await raiseAlert(base44, 'MISSION_BLOCKED', 'critical', `Execution ${executionId} imezuiliwa: ${errorCode || 'blocked'} - ${errorMessage || ''}`.slice(0, 500), executionId);
    }
    if (errorCode === 'GITHUB_AUTH_FAILED') {
      await raiseAlert(base44, 'GITHUB_AUTH_FAILURE', 'critical', 'GitHub authentication imefeli. Token inahitaji kuangaliwa.', executionId);
    }
    if (errorCode === 'NEON_AUTH_FAILED') {
      await raiseAlert(base44, 'NEON_AUTH_FAILURE', 'critical', 'Neon authentication imefeli. Credentials za test branch zinahitaji kuangaliwa.', executionId);
    }
    if (errorCode === 'PRODUCTION_ACTION_DENIED') {
      await raiseAlert(base44, 'PRODUCTION_ACTION_REQUESTED', 'critical', 'Worker ilijaribu kitendo dhidi ya production. Kimezuiliwa.', executionId);
    }

    return Response.json({
      ok: true,
      action: 'recorded',
      execution_id: executionId,
      status,
      evidence,
      alerts_created: ['WORKER_FAILURE', 'EXECUTION_TIMEOUT', 'MISSION_BLOCKED'].includes(String(errorCode)) ? [] : undefined,
      lease_released: Boolean(state),
    });
  } catch (error) {
    return Response.json({ ok: false, error: String((error as Error)?.message || error) }, { status: 500 });
  }
});
