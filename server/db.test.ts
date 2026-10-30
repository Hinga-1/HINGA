import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabaseSchema, testConnection, createItem, getItems, deleteItem } from './db';

const canRunIntegration = process.env.RUN_NEON_INTEGRATION === 'true' && process.env.NEON_BRANCH !== 'production';
const skipReason = canRunIntegration ? undefined : 'Set RUN_NEON_INTEGRATION=true with an explicit non-production NEON_BRANCH';

test('Neon Postgres - Schema Initialization & Connection', { skip: skipReason }, async (t) => {
  await t.test('initializes database table schema using direct connection', async () => {
    await initDatabaseSchema();
    assert.ok(true, 'Schema initialized successfully');
  });

  await t.test('connects and retrieves PostgreSQL metadata and branch', async () => {
    const health = await testConnection();
    assert.equal(health.status, 'ok', `Database connection failed: ${health.error}`);
    assert.ok(health.version?.includes('PostgreSQL'), 'Database version should indicate PostgreSQL');
    assert.equal(health.database, 'neondb');
    const expectedBranch = (process.env.NEON_EXPECTED_BRANCH || process.env.NEON_BRANCH || '').toLowerCase();
    assert.ok(expectedBranch, 'NEON_EXPECTED_BRANCH or NEON_BRANCH must identify the test branch');
    assert.equal(health.branch.toLowerCase(), expectedBranch);
    assert.ok(health.latencyMs >= 0);
  });
});

test('Neon Postgres - End-to-End CRUD Operations', { skip: skipReason }, async (t) => {
  let createdId: number;

  await t.test('inserts a new record into neon_items', async () => {
    const uniqueTitle = `Test item ${Date.now()}`;
    const desc = 'Jaribio la Neon Postgres';
    const item = await createItem(uniqueTitle, desc);

    assert.ok(item.id > 0);
    assert.equal(item.title, uniqueTitle);
    assert.equal(item.description, desc);
    createdId = item.id;
  });

  await t.test('retrieves items and includes the newly created record', async () => {
    const items = await getItems();
    assert.ok(Array.isArray(items));
    const found = items.find((i) => i.id === createdId);
    assert.ok(found, `Item with id ${createdId} should exist in list`);
  });

  await t.test('deletes the record from neon_items', async () => {
    const deleted = await deleteItem(createdId);
    assert.equal(deleted, true);

    const items = await getItems();
    const found = items.find((i) => i.id === createdId);
    assert.equal(found, undefined, 'Deleted item should not be found');
  });
});
