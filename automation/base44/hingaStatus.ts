import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * hingaStatus - single read model for the monitoring dashboard and health checks.
 * Deterministic, no writes, no AI. Safe to poll.
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const statePage = await base44.asServiceRole.entities.HingaAutomationState.filter(
      { mission_id: MISSION_ID },
      { sort: '-created_date', limit: 1 },
    );
    const state = statePage?.items?.[0] || null;

    const executionsPage = await base44.asServiceRole.entities.HingaExecution.filter(
      { mission_id: MISSION_ID },
      { sort: '-created_date', limit: 20 },
    );
    const executions = executionsPage?.items || [];

    const alertsPage = await base44.asServiceRole.entities.HingaAlert.filter(
      { acknowledged: false },
      { sort: '-created_date', limit: 20 },
    );
    const alerts = alertsPage?.items || [];

    const last = executions[0] || null;
    const running = executions.find((e: any) => ['queued', 'running'].includes(e.status)) || null;
    const lastSuccess = executions.find((e: any) => e.status === 'succeeded') || null;
    const retryCount = executions.filter((e: any) => ['failed', 'timed_out'].includes(e.status)).length;
    const failures = executions.filter((e: any) => e.status === 'failed').length;
    const blockers = executions.filter((e: any) => e.status === 'blocked').length;

    const estimatedCost = executions.reduce((sum: number, e: any) => sum + Number(e.actual_cost_usd ?? e.estimated_cost_usd ?? 0), 0);
    const evidence = (state?.evidence && typeof state.evidence === 'object') ? state.evidence : {};
    const missingEvidence = Object.entries(COMPLETION_EVIDENCE)
      .filter(([key]) => evidence[key] !== true)
      .map(([key, label]) => ({ key, label }));

    const leaseActive = state?.lease_expires_at ? new Date(state.lease_expires_at).getTime() > Date.now() : false;

    return Response.json({
      ok: true,
      generated_at: new Date().toISOString(),
      automation: {
        status: state?.status || 'not_configured',
        scheduler: state?.status === 'active' ? 'active' : state?.status || 'not_configured',
        interval_minutes: state?.scheduler_interval_minutes ?? INTERVAL_MINUTES,
        last_run_at: state?.last_run_at || null,
        next_run_at: state?.next_run_at || null,
        last_execution_id: state?.last_execution_id || null,
        mission_id: MISSION_ID,
        working_branch: state?.working_branch || 'mission-003-independent-work',
        base_branch: state?.base_branch || 'main',
        pull_request_url: state?.pull_request_url || 'https://github.com/Hinga-1/HINGA/pull/1',
        pr_status: state?.pr_status || 'unknown',
        tests_status: state?.tests_status || 'unknown',
        neon_project_id: state?.neon_project_id || 'falling-moon-75342440',
        neon_branch_in_use: state?.neon_test_branch || 'mission-003-test-20261030',
        neon_production_branch: state?.neon_production_branch || 'production',
      },
      worker: {
        running: Boolean(running),
        worker_id: running?.worker_id || state?.current_worker_id || null,
        execution_id: running?.execution_id || state?.current_execution_id || null,
        lease_active: leaseActive,
        lease_expires_at: state?.lease_expires_at || null,
        heartbeat_at: running?.heartbeat_at || null,
        attempt: running?.attempt || null,
      },
      last_execution: last
        ? {
            execution_id: last.execution_id,
            status: last.status,
            attempt: last.attempt,
            started_at: last.started_at || null,
            finished_at: last.finished_at || null,
            commit_sha: last.commit_sha || null,
            pull_request_url: last.pull_request_url || null,
            test_summary: last.test_summary || {},
            error_code: last.error_code || null,
            error_message: last.error_message || null,
            cost_usd: Number(last.actual_cost_usd ?? last.estimated_cost_usd ?? 0),
          }
        : null,
      last_successful_commit: state?.last_successful_commit || lastSuccess?.commit_sha || null,
      counters: { retry_count: retryCount, failures, blockers, executions_total: executions.length },
      budgets: {
        executions_today: Number(state?.daily_executions_used ?? 0),
        executions_limit: Number(state?.daily_execution_budget ?? 8),
        ai_usd_today: Number(Number(state?.daily_ai_used_usd ?? 0).toFixed(4)),
        ai_usd_limit: Number(state?.daily_ai_budget_usd ?? 1.5),
        budget_reset_on: state?.budget_reset_on || null,
        estimated_cost_usd: Number(estimatedCost.toFixed(4)),
      },
      alerts: alerts.map((a: any) => ({
        alert_type: a.alert_type,
        severity: a.severity,
        message: a.message,
        execution_id: a.execution_id || null,
        created_date: a.created_date,
      })),
      completion: {
        ready: missingEvidence.length === 0,
        missing: missingEvidence,
        evidence,
      },
      recent_executions: executions.slice(0, 10).map((e: any) => ({
        execution_id: e.execution_id,
        status: e.status,
        attempt: e.attempt,
        created_date: e.created_date,
        commit_sha: e.commit_sha || null,
        error_code: e.error_code || null,
        cost_usd: Number(e.actual_cost_usd ?? e.estimated_cost_usd ?? 0),
      })),
    });
  } catch (error) {
    return Response.json({ ok: false, error: String((error as Error)?.message || error) }, { status: 500 });
  }
});
