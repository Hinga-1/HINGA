# Mission 003 - Deployment Instructions and Failure Recovery Runbook

Audience: whoever operates the HINGA automation loop. Everything here is
copy-pasteable and reversible.

## 1. Deployment (already applied - this is the rebuild path)

### 1.1 Secrets (platform secret store only)

| Secret | Purpose | Where it may appear |
|---|---|---|
| `GITHUB_TOKEN` | Repo read/write, PR updates | Worker turn (sandbox env) only |
| `HINGA_WEBHOOK_SECRET` | HMAC signing for external worker claims | `hingaTick` env only |
| `NEON_TEST_DATABASE_URL` | Neon test branch, unpooled | Migration runner + integration tests only |

Never place these in workflow JSON, entity records, commit messages, PR comments or logs.
`hingaReport` redacts them from anything it stores.

### 1.2 Entities (Base44)

`HingaAutomationState`, `HingaExecution`, `HingaAlert`. The first `hingaTick` call
creates the state row with mission defaults if it is missing.

### 1.3 Backend functions

Deploy in this order: `hingaTick`, `hingaReport`, `hingaControl`, `hingaStatus`.
Sources of record: `automation/base44/*.ts` in this repository.

### 1.4 Scheduler workflow

- Name: `HINGA Autonomous Engineering Loop`
- Trigger: `scheduled`, cron `*/30 * * * *` (every 30 minutes, clock-aligned)
- Steps: `hingaTick` -> switch on `action == "invoke_worker"` -> worker agent step; otherwise end.
- The gate is the only cost-free step; the agent step runs only when the gate says so.

### 1.5 Database (test branch only)

```bash
RUN_NEON_MIGRATIONS=true \
DATABASE_URL_UNPOOLED="$NEON_TEST_DATABASE_URL" \
NEON_BRANCH="mission-003-test-20261030" \
npm run db:migrate
```

`scripts/migrate.ts` refuses when `NEON_BRANCH` is unset or equals `production`, and
refuses a pooled URL. That guard is the production lock - do not weaken it.

### 1.6 CI

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run lint`, `npm run build`
and `npm run db:migration-check` on pushes to `mission-*` and on PRs into `main`.
These check runs are the external evidence used by the completion gate.

## 2. Control plane

All calls go to `hingaControl` with an admin session.

```bash
# stop work without losing state
{ "action": "pause",  "reason": "investigating flaky test" }
{ "action": "disable" }
# resume
{ "action": "resume" }
# reset today's budgets
{ "action": "reset_budget" }
# tune limits or branch targets
{ "action": "set_config", "daily_execution_budget": 4, "daily_ai_budget_usd": 0.75 }
# close an alert
{ "action": "acknowledge_alert", "alert_id": "<id>" }
# complete the mission - requires all eight evidence flags
{ "action": "complete", "evidence": {
  "tests": true, "lint": true, "build": true, "database": true,
  "pullRequestClean": true, "noCriticalSecurityIssues": true,
  "reportWritten": true, "schedulerStopped": true } }
```

`complete` with missing evidence returns HTTP 409 plus the missing list. That is the point:
code being written is never enough.

## 3. Failure recovery

| Symptom | Diagnosis | Action |
|---|---|---|
| Tick returns `already_running` for hours | Worker died without releasing | Check `heartbeat_at` of the running execution. After `heartbeat_stale_minutes` the next tick marks it `timed_out` (`WORKER_CRASH`) and frees the lease automatically. Force it earlier by `set_config` with a lower `heartbeat_stale_minutes`. |
| Tick returns `waiting_for_backoff` | Transient failure inside backoff window | Wait. Backoff is 60s, 2m, 4m... capped at 15m. |
| Tick returns `requires_code_change` | Permanent error (`TEST_FAILED`, `BUILD_FAILED`, `PRODUCTION_ACTION_DENIED`, ...) | Fix the code on the mission branch, push, then the next tick resumes. Retrying without a code change is refused on purpose. |
| `MAX_ATTEMPTS_EXHAUSTED` | Three attempts used | Fix the cause, `reset_budget`, then `resume`. |
| `DAILY_EXECUTION_BUDGET_REACHED` | 8 executions today | Raise `daily_execution_budget` or wait for the UTC rollover. |
| `DAILY_AI_BUDGET_REACHED` | AI spend cap hit | Raise `daily_ai_budget_usd` deliberately, or leave it and pick up tomorrow. |
| `GITHUB_AUTH_FAILURE` | Token expired or lost scope | Rotate `GITHUB_TOKEN` in the secret store. Retry is automatic once the next tick sees the new token. |
| `NEON_AUTH_FAILURE` | Test branch credential rotated | Update `NEON_TEST_DATABASE_URL`. Database-dependent evidence stays red until then. |
| `PRODUCTION_ACTION_REQUESTED` | Worker tried to touch production | Nothing changed. Review the execution's `step_summary`, fix the prompt or target config. |
| Lease row stuck `expires_at` in the future with no worker | Ghost lease after a hard crash | `hingaTick` releases expired leases; to force it, update `hinga_worker_leases` set `released_at = NOW()` where the lease key matches. |
| Two executions appear `queued` | Should be impossible | The partial unique index blocks it. If it happens, the index is missing - re-run migration 004 on the test branch. |

## 4. Manual re-arm after a long stop

1. `hingaControl { "action": "resume" }`
2. `hingaTick {}` once by hand to confirm `action: "invoke_worker"` (or the reason it refuses).
3. Read `hingaStatus` - `worker.lease_active` must be `true` during a run and `false` after.
4. Watch the next scheduled tick land on a :00 or :30 boundary.

## 5. Human-only actions (the worker must never do these)

- merging PR #1
- any write to `main`
- any Neon production operation (branch, migration, role, grant, RLS)
- raising the AI budget
- declaring the mission complete
