import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const migrationDirectory = path.resolve('db/migrations');
const migrationPattern = /^(\d{3})_([a-z0-9_-]+)\.sql$/;

type Migration = { version: string; name: string; sql: string; checksum: string };

async function loadMigrations(): Promise<Migration[]> {
  const files = (await fs.readdir(migrationDirectory)).filter((file) => migrationPattern.test(file)).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = file.match(migrationPattern);
    if (!match) continue;
    const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
    migrations.push({
      version: match[1],
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((migration) => migration.version));
  if (versions.size !== migrations.length) throw new Error('Duplicate migration version');
  return migrations;
}

async function checkMigrations(): Promise<void> {
  const migrations = await loadMigrations();
  if (migrations.length === 0) throw new Error('No migration files found');
  console.log(`Migration files valid: ${migrations.map((migration) => migration.version).join(', ')}`);
}

async function applyMigrations(): Promise<void> {
  if (process.env.RUN_NEON_MIGRATIONS !== 'true') {
    throw new Error('Set RUN_NEON_MIGRATIONS=true to apply migrations');
  }
  if (!process.env.DATABASE_URL_UNPOOLED) {
    throw new Error('DATABASE_URL_UNPOOLED is required; pooled URLs are not accepted for migrations');
  }
  if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === 'production') {
    throw new Error('NEON_BRANCH must be an explicit non-production branch');
  }

  const sql = neon(process.env.DATABASE_URL_UNPOOLED);
  await sql.query('SELECT pg_advisory_lock(hashtext($1))', ['hinga:migrations']);
  try {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = await sql.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    const appliedByVersion = new Map(applied.map((row) => [String(row.version), row]));
    for (const migration of await loadMigrations()) {
      const existing = appliedByVersion.get(migration.version) as { checksum: string } | undefined;
      if (existing) {
        if (existing.checksum !== migration.checksum) throw new Error(`Checksum drift in migration ${migration.version}`);
        continue;
      }
      const statements = migration.sql
        .split(/;\s*(?=(?:[^']|'[^']*')*$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);
      await sql.transaction((tx) => [
        ...statements.map((statement) => tx.query(statement)),
        tx.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)', [migration.version, migration.name, migration.checksum]),
      ]);
      console.log(`Applied migration ${migration.version}_${migration.name}`);
    }
  } finally {
    await sql.query('SELECT pg_advisory_unlock(hashtext($1))', ['hinga:migrations']);
  }
}

const command = process.argv[2] ?? 'check';
if (command === 'check') {
  await checkMigrations();
} else if (command === 'apply') {
  await applyMigrations();
} else {
  throw new Error(`Unknown command: ${command}`);
}
