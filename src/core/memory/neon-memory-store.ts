import { neon } from '@neondatabase/serverless';
import { MemoryEntry, MemorySearchFilter, MemoryStore, MemoryType } from '../types.ts';

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
      INSERT INTO ai_memories (id, type, key, content, importance, tags, metadata, created_at, updated_at)
      VALUES (
        ${id}, 
        ${entry.type}, 
        ${entry.key}, 
        ${entry.content}, 
        ${entry.importance}, 
        ${entry.tags}, 
        ${JSON.stringify(entry.metadata || {})}, 
        ${now}, 
        ${now}
      )
      RETURNING id, type, key, content, importance, tags, metadata, created_at, updated_at;
    `;

    const row = rows[0] as {
      id: string;
      type: string;
      key: string;
      content: string;
      importance: number;
      tags: string[];
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    };

    return {
      id: row.id,
      type: row.type as MemoryType,
      key: row.key,
      content: row.content,
      importance: row.importance,
      tags: row.tags || [],
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async retrieve(id: string): Promise<MemoryEntry | null> {
    const rows = await this.sql`
      SELECT id, type, key, content, importance, tags, metadata, created_at, updated_at
      FROM ai_memories
      WHERE id = ${id}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) return null;

    const row = rows[0] as {
      id: string;
      type: string;
      key: string;
      content: string;
      importance: number;
      tags: string[];
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    };

    return {
      id: row.id,
      type: row.type as MemoryType,
      key: row.key,
      content: row.content,
      importance: row.importance,
      tags: row.tags || [],
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async search(filter: MemorySearchFilter): Promise<MemoryEntry[]> {
    const rows = await this.sql`
      SELECT id, type, key, content, importance, tags, metadata, created_at, updated_at
      FROM ai_memories
      WHERE (${filter.type ?? null}::text IS NULL OR type = ${filter.type ?? null})
        AND (${filter.query ?? null}::text IS NULL OR key ILIKE '%' || ${filter.query ?? ''} || '%' OR content ILIKE '%' || ${filter.query ?? ''} || '%')
        AND (${filter.tags && filter.tags.length > 0 ? filter.tags : null}::text[] IS NULL OR tags && ${filter.tags && filter.tags.length > 0 ? filter.tags : []}::text[])
      ORDER BY importance DESC, created_at DESC
      LIMIT ${filter.limit ?? 50};
    `;

    return rows.map((r: any) => ({
      id: r.id,
      type: r.type as MemoryType,
      key: r.key,
      content: r.content,
      importance: r.importance,
      tags: r.tags || [],
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM ai_memories
      WHERE id = ${id}
      RETURNING id;
    `;
    return result.length > 0;
  }

  async clear(type?: MemoryType): Promise<void> {
    if (type) {
      await this.sql`DELETE FROM ai_memories WHERE type = ${type};`;
    } else {
      await this.sql`DELETE FROM ai_memories;`;
    }
  }

  async count(): Promise<number> {
    const rows = await this.sql`SELECT COUNT(*)::int as total FROM ai_memories;`;
    return (rows[0] as { total: number }).total;
  }
}
