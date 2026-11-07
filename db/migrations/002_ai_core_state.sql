-- Durable state for jobs and candidate learning. No model training is implied.
CREATE TABLE IF NOT EXISTS ai_job_runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'timed_out')),
  attempt INT NOT NULL CHECK (attempt >= 0),
  max_attempts INT NOT NULL CHECK (max_attempts >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  result_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_job_runs_status ON ai_job_runs(status, created_at);

CREATE TABLE IF NOT EXISTS learning_gaps (
  gap_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  topic TEXT NOT NULL,
  context TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'candidate', 'resolved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  evaluation_run_id TEXT
);

CREATE TABLE IF NOT EXISTS candidate_lessons (
  lesson_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  verification_question TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  source_uri TEXT,
  source_hash TEXT,
  source_captured_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'candidate' CHECK (verification_status IN ('candidate', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidate_lessons_status ON candidate_lessons(verification_status, created_at);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  evaluation_run_id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  code_commit TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'rejected')),
  score NUMERIC(6, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS evaluation_case_results (
  evaluation_run_id TEXT NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
  case_id TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  score NUMERIC(6, 2),
  grader_version TEXT NOT NULL,
  reason TEXT,
  output_hash TEXT,
  latency_ms INT,
  prompt_tokens INT,
  completion_tokens INT,
  PRIMARY KEY (evaluation_run_id, case_id)
);
