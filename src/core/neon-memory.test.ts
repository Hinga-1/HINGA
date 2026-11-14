import test from 'node:test';
import assert from 'node:assert/strict';
import { NeonMemoryStore } from './memory/neon-memory-store.ts';
import { config } from './config.ts';

test('Neon PostgreSQL Persistent Memory Store Integration', async (t) => {
  if (!config.databaseUrl) {
    t.skip('DATABASE_URL not set');
    return;
  }

  const store = new NeonMemoryStore(config.databaseUrl, config.databaseUrlUnpooled);
  const createdIds: string[] = [];
  t.after(async () => {
    for (const id of createdIds) {
      await store.delete(id);
    }
  });

  await t.test('verifies the migrated ai_memories table without runtime DDL', async () => {
    await store.initializeSchema();
    assert.ok(true, 'Migrated schema is available');
  });

  await t.test('persists and retrieves a semantic memory entry on Neon', async () => {
    const memory = await store.store({
      type: 'semantic',
      key: `Usanifu wa Mifumo ya AI ${Date.now()}`,
      content: 'Mission 001 inaweka msingi wa moduli 8 za ndani.',
      importance: 9,
      tags: ['mission_001', 'architecture'],
      metadata: { author: 'Principal AI Architect' },
    });

    createdIds.push(memory.id);
    assert.ok(memory.id.startsWith('mem_'));
    assert.equal(memory.importance, 9);

    const retrieved = await store.retrieve(memory.id);
    assert.equal(retrieved?.id, memory.id);
    assert.equal(retrieved?.metadata?.author, 'Principal AI Architect');
  });

  await t.test('enforces scope, provenance status, and expiry predicates in PostgreSQL', async () => {
    const suffix = Date.now();
    const tenantA = `integration-tenant-a-${suffix}`;
    const tenantB = `integration-tenant-b-${suffix}`;
    const session = `integration-session-${suffix}`;

    const live = await store.store({
      type: 'semantic',
      key: `scoped-live-${suffix}`,
      content: 'verified tenant-scoped memory',
      importance: 8,
      tags: ['integration', 'scoped'],
      tenantId: tenantA,
      sessionId: session,
      sourceUri: 'https://example.invalid/source',
      sourceHash: `hash-${suffix}`,
      sourceCapturedAt: new Date().toISOString(),
      verificationStatus: 'verified',
    });
    const expired = await store.store({
      type: 'semantic',
      key: `scoped-expired-${suffix}`,
      content: 'expired tenant-scoped memory',
      importance: 7,
      tags: ['integration', 'scoped'],
      tenantId: tenantA,
      sessionId: session,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      verificationStatus: 'candidate',
    });
    const otherTenant = await store.store({
      type: 'semantic',
      key: `scoped-other-${suffix}`,
      content: 'other tenant memory',
      importance: 6,
      tags: ['integration', 'scoped'],
      tenantId: tenantB,
      sessionId: session,
      verificationStatus: 'verified',
    });
    createdIds.push(live.id, expired.id, otherTenant.id);

    const verified = await store.search({
      tenantId: tenantA,
      sessionId: session,
      verificationStatus: 'verified',
      query: `scoped-live-${suffix}`,
    });
    assert.deepEqual(verified.map((entry) => entry.id), [live.id]);
    assert.equal(verified[0]?.sourceHash, `hash-${suffix}`);
    assert.equal((await store.search({ tenantId: tenantA, sessionId: session })).some((entry) => entry.id === expired.id), false);
    assert.equal((await store.search({ tenantId: tenantA, sessionId: session, includeExpired: true })).some((entry) => entry.id === expired.id), true);

    assert.equal(await store.retrieve(live.id, { tenantId: tenantB, sessionId: session }), null);
    assert.equal(await store.delete(live.id, { tenantId: tenantB, sessionId: session }), false);
    assert.equal(await store.delete(live.id, { tenantId: tenantA, sessionId: session }), true);
    assert.equal(await store.retrieve(live.id), null);
    createdIds.splice(createdIds.indexOf(live.id), 1);

    await store.clear(undefined, { tenantId: tenantA, sessionId: session });
    assert.equal((await store.search({ tenantId: tenantA, sessionId: session, includeExpired: true })).length, 0);
  });
});
