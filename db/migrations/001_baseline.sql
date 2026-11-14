-- Baseline for existing HINGA deployments. Apply only through the migration runner.
CREATE TABLE IF NOT EXISTS neon_items (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('working', 'episodic', 'semantic')),
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INT NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_type ON ai_memories(type);
CREATE INDEX IF NOT EXISTS idx_ai_memories_key ON ai_memories(key);
CREATE INDEX IF NOT EXISTS idx_neon_items_created_at ON neon_items(created_at DESC);
