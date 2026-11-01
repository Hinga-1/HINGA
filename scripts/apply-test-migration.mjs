// Applies a .sql migration to the TEST Neon branch only.
//
//   node scripts/apply-test-migration.mjs .cache/002_ai_core_state.sql
//
// Get the file first (it lives on the Mission 003 branch):
//   git show origin/manus-003:db/migrations/002_ai_core_state.sql > .cache/002_ai_core_state.sql
//
// Guards, in order:
//   1. DATABASE_URL_TEST missing          -> refuse.
//   2. DATABASE_URL_TEST === DATABASE_URL -> refuse (production is never a target).
//   3. A pooled (-pooler) URL             -> warn: DDL wants a direct connection.
//
// There is no psql in this environment, so statements go through the Neon HTTP
// driver. Splitting is line-oriented on purpose: the migrations are plain DDL.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const testUrl = process.env.DATABASE_URL_TEST?.trim();
const prodUrl = process.env.DATABASE_URL?.trim();
const file = process.argv[2];

if (!testUrl) {
  console.error('DATABASE_URL_TEST haipo — nimekataa.');
  process.exit(1);
}
if (prodUrl && testUrl === prodUrl) {
  console.error('DATABASE_URL_TEST ni sawa na DATABASE_URL (production) — nimekataa.');
  process.exit(1);
}
if (testUrl.includes('-pooler')) {
  console.error('Onyo: URL ina -pooler; DDL inahitaji direct connection.');
}
if (!file) {
  console.error('Tumia: node scripts/apply-test-migration.mjs <faili.sql>');
  process.exit(1);
}

const text = readFileSync(file, 'utf8');
const statements = text
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

const sql = neon(testUrl);
for (const statement of statements) {
  await sql.query(statement);
  console.log(`ok: ${statement.slice(0, 60).replace(/\s+/g, ' ')}…`);
}
console.log(`jumla: ${statements.length} statements zimetumika kwenye tawi la majaribio.`);
