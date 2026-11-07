import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config({ path: '.env.local' });
dotenv.config();

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const branch = process.env.NEON_BRANCH || 'production';

if (!pooledUrl) {
  console.warn('⚠️ DATABASE_URL is not set in environment variables');
}

// Neon driver client for pooled application queries
export const sql = neon(pooledUrl || '');

// Neon driver client for direct schema migrations / DDL
export const sqlDirect = neon(directUrl || '');

export interface NeonItem {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
}

export interface DbHealthResult {
  status: 'ok' | 'error';
  version?: string;
  database?: string;
  user?: string;
  branch: string;
  isPooled: boolean;
  latencyMs: number;
  error?: string;
}

/** Verifies that versioned migrations have created the application table. DDL belongs in db:migrate. */
export async function initDatabaseSchema(): Promise<void> {
  if (!directUrl) {
    throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required to verify schema');
  }
  const rows = await sqlDirect`SELECT to_regclass('public.neon_items') AS table_name;`;
  if (!rows[0]?.table_name) throw new Error('Database migrations have not created public.neon_items');
}

/**
 * Checks connectivity and retrieves database diagnostics.
 */
export async function testConnection(): Promise<DbHealthResult> {
  const start = Date.now();
  try {
    const result = await sql`
      SELECT 
        version(), 
        current_database() as database, 
        current_user as user
    `;

    const latencyMs = Date.now() - start;
    const row = result[0] as { version: string; database: string; user: string };

    return {
      status: 'ok',
      version: row.version,
      database: row.database,
      user: row.user,
      branch,
      isPooled: pooledUrl?.includes('-pooler') ?? false,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      branch,
      isPooled: pooledUrl?.includes('-pooler') ?? false,
      latencyMs,
      error: message,
    };
  }
}

/**
 * Retrieves all items from neon_items.
 */
export async function getItems(): Promise<NeonItem[]> {
  const rows = await sql`
    SELECT id, title, description, created_at
    FROM neon_items
    ORDER BY created_at DESC
    LIMIT 100;
  `;
  return rows as NeonItem[];
}

/**
 * Inserts a new item into neon_items.
 */
export async function createItem(title: string, description?: string): Promise<NeonItem> {
  const rows = await sql`
    INSERT INTO neon_items (title, description)
    VALUES (${title}, ${description || null})
    RETURNING id, title, description, created_at;
  `;
  return rows[0] as NeonItem;
}

/**
 * Deletes an item from neon_items.
 */
export async function deleteItem(id: number): Promise<boolean> {
  const result = await sql`
    DELETE FROM neon_items
    WHERE id = ${id}
    RETURNING id;
  `;
  return result.length > 0;
}
