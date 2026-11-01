import test from 'node:test';
import assert from 'node:assert/strict';
import { NeonMemoryStore } from './memory/neon-memory-store.ts';
import { config } from './config.ts';

// This test writes to a real database, so it only ever runs against the test
// branch (DATABASE_URL_TEST). DATABASE_URL is production and must stay untouched:
// if the two are equal we refuse to run rather than risk deleting real memories.
const testUrl = config.databaseUrlTest;

test('Neon PostgreSQL Persistent Memory Store Integration', async (t) => {
  if (!testUrl) {
    t.skip('DATABASE_URL_TEST is not set (production DATABASE_URL is never used by tests)');
    return;
  }
  if (testUrl === config.databaseUrl) {
    t.skip('DATABASE_URL_TEST equals DATABASE_URL (production); refusing to write');
    return;
  }

  const store = new NeonMemoryStore(testUrl, config.databaseUrlTestUnpooled);

  await t.test('initializes ai_memories table and indexes on Neon Postgres', async () => {
    await store.initializeSchema();
    assert.ok(true, 'Schema created successfully');
  });

  let createdMemoryId: string;

  await t.test('persists a semantic memory entry on Neon', async () => {
    const memory = await store.store({
      type: 'semantic',
      key: 'Usanifu wa Mifumo ya AI',
      content: 'Mission 001 inaweka msingi wa moduli 8 za ndani.',
      importance: 9,
      tags: ['mission_001', 'architecture'],
      metadata: { author: 'Principal AI Architect' },
    });

    assert.ok(memory.id.startsWith('mem_'));
    assert.equal(memory.key, 'Usanifu wa Mifumo ya AI');
    createdMemoryId = memory.id;
  });

  await t.test('retrieves the memory entry by ID from Neon', async () => {
    const retrieved = await store.retrieve(createdMemoryId);
    assert.ok(retrieved !== null);
    assert.equal(retrieved!.id, createdMemoryId);
    assert.equal(retrieved!.importance, 9);
  });

  await t.test('searches memory by query on Neon', async () => {
    const results = await store.search({ query: 'Mission 001', limit: 5 });
    assert.ok(results.length > 0);
    assert.ok(results.some((r) => r.id === createdMemoryId));
  });

  await t.test('deletes the test memory entry from Neon', async () => {
    const deleted = await store.delete(createdMemoryId);
    assert.equal(deleted, true);

    const check = await store.retrieve(createdMemoryId);
    assert.equal(check, null);
  });
});
