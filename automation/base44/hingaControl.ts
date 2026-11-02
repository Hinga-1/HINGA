import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * hingaControl - operator control plane for the HINGA automation.
 *
 * Actions: pause | resume | disable | enable | complete | reset_budget | acknowledge_alert | set_config
 * `complete` is evidence-gated: the mission cannot be closed because code was written.
 */

const MISSION_ID = 'MISSION-003';
const INTERVAL_MINUTES = 30;

const COMPLETION_EVIDENCE = {
  tests: 'npm test imepita',
  lint: 'npm run lint imepita',
  build: 'npm run build imepita',
  database: 'Neon test-branch integration tests zimepita',
  pullRequestClean: 'PR #1 ni clean na mergeable',
  noCriticalSecurityIssues: 'hakuna critical security issue iliyobaki',
  reportWritten: 'report ya mwisho imeandikwa',
  schedulerStopped: 'scheduler imezimwa baada ya uthibitisho wa evidence',
};

async function loadState(base44: any) {
  const page = await base44.asServiceRole.entities.HingaAutomationState.filter(
    { mission_id: MISSION_ID },
    { sort: '-created_date', limit: 1 },
  );
  return page?.items?.[0] || null;
}

async function alert(base44: any, type: string, severity: string, message: string) {
  await base44.asServiceRole.entities.HingaAlert.create({ alert_type: type, severity, message, acknowledged: false, details: {} });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action || '');
  try {
    const state = await loadState(base44);
    if (!state) return Response.json({ ok: false, error: 'automation_not_initialised' }, { status: 404 });

    switch (action) {
      case 'pause':
      case 'disable': {
        const status = action === 'pause' ? 'paused' : 'disabled';
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
          status,
          next_run_at: '',
          notes: body.reason ? String(body.reason).slice(0, 500) : state.notes,
        });
        await alert(base44, `SCHEDULER_${status.toUpperCase()}`, 'info', `Scheduler imewekwa ${status}${body.reason ? `: ${body.reason}` : ''}.`);
        return Response.json({ ok: true, action, status, next_run_at: null });
      }
      case 'resume':
      case 'enable': {
        const nextRun = new Date(Date.now() + INTERVAL_MINUTES * 60_000).toISOString();
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
          status: 'active',
          next_run_at: nextRun,
          budget_reset_on: new Date().toISOString().slice(0, 10),
        });
        return Response.json({ ok: true, action, status: 'active', next_run_at: nextRun });
      }
      case 'reset_budget': {
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
          daily_executions_used: 0,
          daily_ai_used_usd: 0,
          budget_reset_on: new Date().toISOString().slice(0, 10),
        });
        return Response.json({ ok: true, action, daily_executions_used: 0, daily_ai_used_usd: 0 });
      }
      case 'acknowledge_alert': {
        const alertId = String(body.alert_id || '');
        if (!alertId) return Response.json({ ok: false, error: 'alert_id is required' }, { status: 400 });
        await base44.asServiceRole.entities.HingaAlert.update(alertId, {
          acknowledged: true,
          resolved_at: new Date().toISOString(),
        });
        return Response.json({ ok: true, action, alert_id: alertId });
      }
      case 'set_config': {
        const allowed = [
          'daily_execution_budget',
          'daily_ai_budget_usd',
          'max_attempts',
          'execution_timeout_minutes',
          'heartbeat_stale_minutes',
          'working_branch',
          'base_branch',
          'neon_test_branch',
        ];
        const patch: Record<string, any> = {};
        for (const key of allowed) if (body[key] !== undefined) patch[key] = body[key];
        if (patch.base_branch && String(patch.base_branch).toLowerCase() === 'main') {
          // base_branch is the PR target and must stay main; direct writes to it are still blocked.
          patch.base_branch = state.base_branch || 'main';
        }
        if (patch.neon_test_branch && String(patch.neon_test_branch).toLowerCase() === 'production') {
          return Response.json({ ok: false, error: 'production_neon_branch_is_not_allowed' }, { status: 400 });
        }
        if (Object.keys(patch).length === 0) return Response.json({ ok: false, error: 'no_supported_field' }, { status: 400 });
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, patch);
        return Response.json({ ok: true, action, updated: patch });
      }
      case 'complete': {
        const supplied = body.evidence && typeof body.evidence === 'object' ? body.evidence : {};
        const missing = Object.entries(COMPLETION_EVIDENCE)
          .filter(([key]) => supplied[key] !== true)
          .map(([key, label]) => ({ key, label }));
        if (missing.length > 0) {
          return Response.json(
            { ok: false, error: 'completion_evidence_incomplete', missing },
            { status: 409 },
          );
        }
        await base44.asServiceRole.entities.HingaAutomationState.update(state.id, {
          status: 'completed',
          next_run_at: '',
          current_worker_id: '',
          current_execution_id: '',
          lease_expires_at: '',
          evidence: supplied,
          last_test_summary: JSON.stringify({ evidence_stored_at: new Date().toISOString() }),
        });
        await alert(base44, 'MISSION_COMPLETED', 'info', 'Mission 003 imekamilika kwa evidence kamili. Scheduler imezimwa.');
        return Response.json({
          ok: true,
          action,
          status: 'completed',
          scheduler_should_stop: true,
          message: 'Mission imekamilika. Deactivate workflow ya HINGA ili hakuna tick za bure.',
        });
      }
      default:
        return Response.json(
          { ok: false, error: 'unknown_action', allowed: ['pause', 'resume', 'disable', 'enable', 'complete', 'reset_budget', 'acknowledge_alert', 'set_config'] },
          { status: 400 },
        );
    }
  } catch (error) {
    return Response.json({ ok: false, error: String((error as Error)?.message || error) }, { status: 500 });
  }
});
