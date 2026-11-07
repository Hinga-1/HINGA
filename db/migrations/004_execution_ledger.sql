-- Mission 003: durable execution ledger and cross-worker lease.
-- Apply ONLY to an explicit non-production Neon branch. scripts/migrate.ts refuses
-- to run when NEON_BRANCH is unset or equals "production".

CREATE TABLE IF NOT EXISTS hinga_executions (
  execution_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  worker_mode TEXT NOT NULL CHECK (worker_mode IN ('base44_agent', 'external_manus', 'github_actions', 'manual')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'timed_out')),
  attempt INT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  commit_sha TEXT,
  pull_request_url TEXT,
  test_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Database-level guarantee: at most one active execution per mission, across all workers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hinga_executions_single_active
  ON hinga_executions (mission_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_hinga_executions_recent
  ON hinga_executions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hinga_executions_status
  ON hinga_executions (status, heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS hinga_worker_leases (
  lease_key TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  release_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_hinga_worker_leases_active
  ON hinga_worker_leases (lease_key, expires_at)
  WHERE released_at IS NULL;

-- Lease acquisition is a single atomic upsert so that stateless HTTP drivers cannot
-- race: the row is taken only when it is free, released, or expired.
-- Session advisory locks (pg_advisory_lock) are deliberately NOT used for the lease
-- because the pooled Neon HTTP driver does not guarantee a stable session.
CREATE TABLE IF NOT EXISTS hinga_automation_state (
  mission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'disabled', 'blocked', 'completed')),
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_execution_id TEXT,
  daily_execution_budget INT NOT NULL DEFAULT 8 CHECK (daily_execution_budget >= 0),
  daily_executions_used INT NOT NULL DEFAULT 0,
  daily_ai_budget_usd NUMERIC(12, 6) NOT NULL DEFAULT 1.5,
  daily_ai_used_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  budget_reset_on DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
