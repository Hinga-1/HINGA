-- Additive provenance/retention fields. Tenant authorization must be enforced before multi-user use.
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS source_uri TEXT;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS source_captured_at TIMESTAMPTZ;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE ai_memories ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';

CREATE INDEX IF NOT EXISTS idx_ai_memories_scope ON ai_memories(tenant_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memories_expiry ON ai_memories(expires_at) WHERE expires_at IS NOT NULL;
