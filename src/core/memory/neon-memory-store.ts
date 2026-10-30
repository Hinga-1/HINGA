import { neon } from '@neondatabase/serverless';
import { MemoryEntry, MemorySearchFilter, MemoryScope, MemoryStore, MemoryType, MemoryVerificationStatus } from '../types.ts';

type MemoryRow = {
  id: string; type: string; key: string; content: string; importance: number; tags: string[];
  metadata: Record<string, unknown>; tenant_id: string | null; session_id: string | null;
  source_uri: string | null; source_hash: string | null; source_captured_at: string | null;
  expires_at: string | null; verification_status: string; created_at: string; updated_at: string;
};

const toMemoryEntry = (row: MemoryRow): MemoryEntry => ({
  id: row.id, type: row.type as MemoryType, key: row.key, content: row.content,
  importance: row.importance, tags: row.tags || [], metadata: row.metadata,
  tenantId: row.tenant_id || undefined, sessionId: row.session_id || undefined,
  sourceUri: row.source_uri || undefined, sourceHash: row.source_hash || undefined,
  sourceCapturedAt: row.source_captured_at || undefined, expiresAt: row.expires_at || undefined,
  verificationStatus: row.verification_status as MemoryVerificationStatus,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export class NeonMemoryStore implements MemoryStore {
  private sql;
  private sqlDirect;

  constructor(databaseUrl: string, unpooledUrl?: string) {
    this.sql = neon(databaseUrl);
    this.sqlDirect = neon(unpooledUrl || databaseUrl);
  }

  /** Verifies that versioned migrations created the memory table; it never performs DDL. */
  async initializeSchema(): Promise<void> {
    const rows = await this.sqlDirect`SELECT to_regclass('public.ai_memories') AS table_name;`;
    if (!rows[0]?.table_name) throw new Error('Database migrations have not created public.ai_memories');
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    if (!['working', 'episodic', 'semantic'].includes(entry.type)) throw new Error('Memory type isiyo sahihi');
    if (!Number.isInteger(entry.importance) || entry.importance < 1 || entry.importance > 10) {
      throw new Error('Memory importance lazima iwe integer kati ya 1 na 10');
    }
    if (!entry.content.trim() || entry.content.length > 100_000) throw new Error('Memory content ina urefu usioruhusiwa');
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const rows = await this.sql`
      INSERT INTO ai_memories (
        id, type, key, content, importance, tags, metadata, tenant_id, session_id,
        source_uri, source_hash, source_captured_at, expires_at, verification_status,
        created_at, updated_at
      ) VALUES (
        ${id}, ${entry.type}, ${entry.key}, ${entry.content}, ${entry.importance}, ${entry.tags},
        ${JSON.stringify(entry.metadata || {})}, ${entry.tenantId || null}, ${entry.sessionId || null},
        ${entry.sourceUri || null}, ${entry.sourceHash || null}, ${entry.sourceCapturedAt || null},
        ${entry.expiresAt || null}, ${entry.verificationStatus || 'unverified'}, ${now}, ${now}
      )
      RETURNING id, type, key, content, importance, tags, metadata, tenant_id, session_id,
        source_uri, source_hash, source_captured_at, expires_at, verification_status,
        created_at, updated_at;
    `;
    return toMemoryEntry(rows[0] as MemoryRow);
  }

  async retrieve(id: string, scope?: MemoryScope): Promise<MemoryEntry | null> {
    const rows = await this.sql`
      SELECT id, type, key, content, importance, tags, metadata, tenant_id, session_id,
        source_uri, source_hash, source_captured_at, expires_at, verification_status,
        created_at, updated_at
      FROM ai_memories
      WHERE id = ${id}
        AND (${scope?.tenantId ?? null}::text IS NULL OR tenant_id = ${scope?.tenantId ?? null})
        AND (${scope?.sessionId ?? null}::text IS NULL OR session_id = ${scope?.sessionId ?? null})
      LIMIT 1;
    `;
    return rows.length === 0 ? null : toMemoryEntry(rows[0] as MemoryRow);
  }

  async search(filter: MemorySearchFilter): Promise<MemoryEntry[]> {
    const rows = await this.sql`
      SELECT id, type, key, content, importance, tags, metadata, tenant_id, session_id,
        source_uri, source_hash, source_captured_at, expires_at, verification_status,
        created_at, updated_at
      FROM ai_memories
      WHERE (${filter.type ?? null}::text IS NULL OR type = ${filter.type ?? null})
        AND (${filter.tenantId ?? null}::text IS NULL OR tenant_id = ${filter.tenantId ?? null})
        AND (${filter.sessionId ?? null}::text IS NULL OR session_id = ${filter.sessionId ?? null})
        AND (${filter.verificationStatus ?? null}::text IS NULL OR verification_status = ${filter.verificationStatus ?? null})
        AND (${filter.includeExpired ? null : 'now'}::text IS NULL OR expires_at IS NULL OR expires_at > NOW())
        AND (${filter.query ?? null}::text IS NULL OR key ILIKE '%' || ${filter.query ?? ''} || '%' OR content ILIKE '%' || ${filter.query ?? ''} || '%')
        AND (${filter.tags && filter.tags.length > 0 ? filter.tags : null}::text[] IS NULL OR tags && ${filter.tags && filter.tags.length > 0 ? filter.tags : []}::text[])
      ORDER BY importance DESC, created_at DESC
      LIMIT ${filter.limit ?? 50};
    `;
    return rows.map((row: unknown) => toMemoryEntry(row as MemoryRow));
  }

  async delete(id: string, scope?: MemoryScope): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM ai_memories
      WHERE id = ${id}
        AND (${scope?.tenantId ?? null}::text IS NULL OR tenant_id = ${scope?.tenantId ?? null})
        AND (${scope?.sessionId ?? null}::text IS NULL OR session_id = ${scope?.sessionId ?? null})
      RETURNING id;
    `;
    return result.length > 0;
  }

  async clear(type?: MemoryType, scope?: MemoryScope): Promise<void> {
    await this.sql`
      DELETE FROM ai_memories
      WHERE (${type ?? null}::text IS NULL OR type = ${type ?? null})
        AND (${scope?.tenantId ?? null}::text IS NULL OR tenant_id = ${scope?.tenantId ?? null})
        AND (${scope?.sessionId ?? null}::text IS NULL OR session_id = ${scope?.sessionId ?? null});
    `;
  }

  async count(): Promise<number> {
    const rows = await this.sql`SELECT COUNT(*)::int as total FROM ai_memories;`;
    return (rows[0] as { total: number }).total;
  }
}
