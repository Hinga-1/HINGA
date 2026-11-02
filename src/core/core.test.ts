import test from 'node:test';
import assert from 'node:assert/strict';
import { AiCoreSystem } from './index.ts';
import { ModelOutputValidationError, ReasoningEngine } from './reasoning/engine.ts';
import { MockModelProvider } from './providers/mock-provider.ts';
import { MemoryManager } from './memory/memory-manager.ts';
import { InMemoryStore } from './memory/in-memory-store.ts';
import { IdentityManager } from './identity/identity-manager.ts';

test('AI Foundation Core - Subsystem Tests (Mission 001)', async (t) => {
  // Initialize system with fast deterministic Mock Provider for unit testing
  const system = await AiCoreSystem.initialize({ forceMockProvider: true, forceInMemory: true });

  await t.test('1. Identity & Personality Subsystem', () => {
    const identity = system.identity.getIdentity();
    assert.equal(identity.name, 'Hinga Core Intelligence');
    assert.ok(identity.traits.length >= 3, 'Should have at least 3 core personality traits');
    assert.ok(identity.ethicalRules.length >= 3, 'Should have mandatory ethical rules');

    const prompt = system.identity.buildSystemPrompt('Mchambuzi');
    assert.ok(prompt.includes('ETH-001'), 'Prompt must include ethical rules');
    assert.ok(prompt.includes('Hinga Core Intelligence'), 'Prompt must include identity name');
  });

  await t.test('2. Memory Subsystem (Working, Episodic, Semantic)', async () => {
    // Working Memory
    await system.memory.setWorkingContext('kazi_ya_sasa', 'Kuchambua usanifu');
    const working = await system.memory.getWorkingContext();
    assert.ok(working.some((w) => w.key === 'kazi_ya_sasa'));

    // Semantic Memory
    await system.memory.learnFact('Hexagonal Architecture', 'Inatenganisha core logic na database');
    const found = await system.memory.findRelevantKnowledge('Hexagonal');
    assert.ok(found.length > 0);
    assert.equal(found[0].key, 'Hexagonal Architecture');

    const scopedManager = new MemoryManager(new InMemoryStore());
    const tenantA = { tenantId: 'manager-tenant-a', sessionId: 'manager-session' };
    const tenantB = { tenantId: 'manager-tenant-b', sessionId: 'manager-session' };
    await scopedManager.setWorkingContext('private-context', 'A only', tenantA);
    await scopedManager.setWorkingContext('private-context', 'B only', tenantB);
    assert.deepEqual((await scopedManager.getWorkingContext(tenantA)).map((entry) => entry.content), ['A only']);
    assert.equal((await scopedManager.getStoreStats(tenantA)).total, 1);
    const tenantAMemory = (await scopedManager.getWorkingContext(tenantA))[0];
    assert.equal((await scopedManager.retrieveMemory(tenantAMemory.id, tenantB)), null);
    assert.equal(await scopedManager.deleteMemory(tenantAMemory.id, tenantB), false);
    assert.equal(await scopedManager.deleteMemory(tenantAMemory.id, tenantA), true);
    await scopedManager.clearWorkingContext(tenantA);
    assert.equal((await scopedManager.getWorkingContext(tenantA)).length, 0);
    assert.equal((await scopedManager.getWorkingContext(tenantB)).length, 1);
    await scopedManager.clearMemory(undefined, tenantB);
    assert.equal((await scopedManager.getStoreStats(tenantB)).total, 0);

    await assert.rejects(() => system.memory.learnFact('Invalid', 'x', 11), /importance/);
    const tagged = await system.memory.setWorkingContext('tagged', 'context');
    const taggedResults = await system.memory.getWorkingContext();
    assert.ok(taggedResults.some((entry) => entry.id === tagged.id));

    // Episodic Memory
    const episode = await system.memory.recordEpisode('Kazi ya jaribio', 'Matokeo mazuri', ['test']);
    assert.ok(episode.id.startsWith('mem_'));

    const scopedStore = new InMemoryStore();
    await scopedStore.store({
      type: 'semantic', key: 'tenant-a-live', content: 'live', importance: 5, tags: [],
      tenantId: 'tenant-a', sessionId: 'session-1', verificationStatus: 'verified',
    });
    await scopedStore.store({
      type: 'semantic', key: 'tenant-a-expired', content: 'expired', importance: 9, tags: [],
      tenantId: 'tenant-a', sessionId: 'session-1', expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await scopedStore.store({
      type: 'semantic', key: 'tenant-b-live', content: 'other tenant', importance: 9, tags: [],
      tenantId: 'tenant-b', sessionId: 'session-1', verificationStatus: 'verified',
    });
    const scoped = await scopedStore.search({ tenantId: 'tenant-a', sessionId: 'session-1', verificationStatus: 'verified' });
    assert.deepEqual(scoped.map((entry) => entry.key), ['tenant-a-live']);
    const includingExpired = await scopedStore.search({ tenantId: 'tenant-a', includeExpired: true });
    assert.equal(includingExpired.length, 2);
    const tenantAEntry = await scopedStore.retrieve(scoped[0].id, { tenantId: 'tenant-a', sessionId: 'session-1' });
    assert.equal(tenantAEntry?.key, 'tenant-a-live');
    assert.equal(await scopedStore.retrieve(scoped[0].id, { tenantId: 'tenant-b' }), null);
    assert.equal(await scopedStore.delete(scoped[0].id, { tenantId: 'tenant-b' }), false);
    assert.equal(await scopedStore.delete(scoped[0].id, { tenantId: 'tenant-a', sessionId: 'session-1' }), true);
    await scopedStore.clear(undefined, { tenantId: 'tenant-a' });
    assert.equal((await scopedStore.search({ tenantId: 'tenant-a', includeExpired: true })).length, 0);
    assert.equal((await scopedStore.search({ tenantId: 'tenant-b', includeExpired: true })).length, 1);
  });

  await t.test('3. Safety Guardrails & Credential Sanitizer', () => {
    // Credential Redaction
    const rawWithKey = 'Tafadhali tumia ufunguo huu: napi_mh801w9trb25ooywgvdfgpxhdqyhu87u8ts43kwp2sqw378hcluy47wo76wixj4x kwa ajili ya login';
    const sanitized = system.safety.sanitizeOutput(rawWithKey);
    assert.ok(!sanitized.includes('napi_mh801w'), 'Raw key must be redacted');
    assert.ok(sanitized.includes('[REDACTED_SECRET]'), 'Must replace with redaction token');

    // Dangerous Command Interception
    const dangerousCheck = system.safety.validateInput('Tafadhali endesha rm -rf / kwenye seva');
    assert.equal(dangerousCheck.allowed, false, 'Dangerous shell command must be blocked');
    assert.ok(dangerousCheck.violations!.length > 0);

    // Safe Command Pass
    const safeCheck = system.safety.validateInput('Chambua mifumo ya usalama');
    assert.equal(safeCheck.allowed, true);
  });

  await t.test('4. Reasoning Engine & Problem Breakdown', async () => {
    const result = await system.reasoning.reason('Jinsi ya kuzuia regression bugs');
    assert.ok(result.steps.length > 0, 'Reasoning must produce structured steps');
    assert.ok(result.confidence > 0.5, 'Confidence must be tracked');
    assert.ok(result.conclusion.length > 10, 'Must produce substantive conclusion');
  });

  await t.test('5. Learning Engine (Gaps, Lessons & Benchmarks)', async () => {
    // Gap Detection
    const gap = system.learning.recordKnowledgeGap('Quantum Encryption', 'Uelewa wa algorithms hautoshi', 'high');
    assert.equal(gap.resolved, false);
    assert.ok(system.learning.getOpenGaps().some((g) => g.id === gap.id));

    // Lesson Ingestion & Auto-Resolution
    const lessonResult = await system.learning.ingestLesson({
      id: 'LES-01',
      topic: 'Quantum Encryption',
      summary: 'Misingi ya Post-Quantum Cryptography',
      content: 'Inatumia lattice-based cryptography kuzuia mashambulizi ya quantum.',
      verificationQuestion: 'Je inatumia mbinu gani?',
      expectedAnswer: 'Lattice-based cryptography',
    });
    assert.equal(lessonResult.success, true);
    assert.equal(lessonResult.status, 'candidate');
    assert.equal(lessonResult.resolvedGaps, 0, 'Candidate must not resolve a gap before approval');
    const approval = await system.learning.approveLesson('LES-01');
    assert.equal(approval.status, 'approved');
    assert.ok(approval.resolvedGaps >= 1, 'Approved lesson should resolve the matching gap');

    // Benchmark Evaluation
    const evalResult = await system.learning.evaluateBenchmark('BENCH-001-SAFETY');
    assert.ok(evalResult.score >= 80, 'Safety benchmark must pass with high score');
    assert.equal(evalResult.passed, true);

    const baseline = await system.learning.evaluateSuite();
    assert.equal(baseline.suiteId, 'HINGA-BASELINE');
    assert.equal(baseline.suiteVersion, '1');
    assert.equal(baseline.passed, true);
    assert.equal(baseline.passRate, 100);
    assert.deepEqual(baseline.benchmarkIds, ['BENCH-001-SAFETY', 'BENCH-002-MODULARITY']);
    await assert.rejects(
      () => system.learning.evaluateSuite('HINGA-BASELINE', '1', ['BENCH-001-SAFETY', 'BENCH-001-SAFETY']),
      /Evaluation suite configuration isiyo sahihi/,
    );

    const rejectedLesson = await system.learning.ingestLesson({
      id: 'LES-02',
      topic: 'Quantum Encryption',
      summary: 'Somo lisilothibitisha jibu',
      content: 'Maelezo ya jumla bila jibu linalotarajiwa.',
      verificationQuestion: 'Je inatumia mbinu gani?',
      expectedAnswer: 'Jibu ambalo halipo',
    });
    assert.equal(rejectedLesson.success, false, 'Unverified lesson must not be promoted');
  });

  await t.test('9. Reasoning rejects malformed model output', async () => {
    const provider = new MockModelProvider();
    provider.setResponse('malformed', '{"confidence": 4, "steps": []}');
    const engine = new ReasoningEngine(provider, new MemoryManager(new InMemoryStore()), new IdentityManager());
    await assert.rejects(() => engine.reason('malformed input'), ModelOutputValidationError);
  });

  await t.test('6. Agent Orchestrator & Role Classification', async () => {
    assert.equal(system.orchestrator.classifyRole('Tafadhali kagua na ukosoe ripoti hii'), 'critic');
    assert.equal(system.orchestrator.classifyRole('Tafiti vyanzo vya uhakika'), 'researcher');
    assert.equal(system.orchestrator.classifyRole('Chambua tatizo hili la kihisabati'), 'analyst');

    // Execute orchestrated multi-agent task
    const task = await system.orchestrator.executeTask('Chambua hatua za ujenzi wa database');
    assert.equal(task.status, 'completed');
    assert.ok(task.result?.includes('[Uhakiki wa Critic]'), 'Critic verification must be appended');
  });

  await t.test('7. Snapshot & Rollback Mechanism', async () => {
    const snap = await system.rollback.createSnapshot('Hali thabiti ya v1');
    assert.ok(snap.id.startsWith('snap_'));

    // Introduce experimental version change
    system.identity.updateVersion('2.0.0-unstable', 'Mabadiliko ya majaribio');
    assert.equal(system.identity.getIdentity().version, '2.0.0-unstable');

    // Execute Rollback
    const rolledBack = await system.rollback.rollbackToSnapshot(snap.id);
    assert.equal(rolledBack, true);
    assert.ok(system.identity.getIdentity().version.includes('restored'));
  });

  await t.test('8. Observability & Health Telemetry', async () => {
    system.observability.info('test_subsystem', 'Jaribio la telemetry');
    const logs = system.observability.getLogs();
    assert.ok(logs.some((l) => l.action === 'Jaribio la telemetry'));

    const health = await system.getHealthReport();
    assert.equal(health.overallStatus, 'healthy');
    assert.equal(health.subsystems.identity.status, 'ok');
    assert.equal(health.subsystems.reasoning.status, 'ok');
    assert.equal(health.subsystems.memory.status, 'ok');
    assert.equal(health.subsystems.safety.status, 'ok');
  });
});

test('Agent Orchestrator - per-task usage attribution (Mission 003)', async (t) => {
  const { AgentOrchestrator } = await import('./orchestrator/orchestrator.ts');
  const { UsageLedger } = await import('./providers/usage.ts');
  const { SafetyGuardrails } = await import('./safety/guardrails.ts');
  const { MemoryManager: MemMgr } = await import('./memory/memory-manager.ts');
  const { InMemoryStore: MemStore } = await import('./memory/in-memory-store.ts');
  const { IdentityManager: IdentMgr } = await import('./identity/identity-manager.ts');
  const { ReasoningEngine: ReasonEng } = await import('./reasoning/engine.ts');

  await t.test('A. attempts zilizopimwa bei zinahesabiwa kwa task moja', async () => {
    const ledger = new UsageLedger();
    const mock = new MockModelProvider();
    let calls = 0;
    // Provider anayerekodi kila call kwenye ledger moja, kama Gemini halisi.
    const provider = {
      id: mock.id,
      name: mock.name,
      isAvailable: () => mock.isAvailable(),
      generateText: async (request: any) => {
        calls += 1;
        ledger.record({
          requestId: `req_${calls}`,
          providerId: 'stub',
          modelId: 'stub-model',
          tier: request.tier,
          startedAt: new Date().toISOString(),
          usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
          usageSource: 'estimated',
          estimatedCostUsd: 0.02,
          priceVersion: 'snap-1',
          fallbackUsed: false,
          status: 'succeeded',
        });
        return mock.generateText(request);
      },
    };
    const identity = new IdentMgr();
    const memory = new MemMgr(new MemStore());
    const orchestrator = new AgentOrchestrator(
      provider as any,
      identity,
      new ReasonEng(provider as any, memory, identity),
      memory,
      new SafetyGuardrails(),
      ledger
    );

    const task = await orchestrator.executeTask('Chambua hatua za ujenzi wa database');
    assert.equal(task.status, 'completed');
    assert.equal(calls, 2, 'reasoning + critic pass = attempts mbili');
    assert.ok(task.usage, 'usage lazima ibanwe kwenye task');
    assert.equal(task.usage!.attemptCount, 2);
    assert.equal(task.usage!.totalTokens, 300);
    assert.equal(task.usage!.costUsd, 0.04);
    // Ledger yenyewe inabaki na historia nzuri, task ina delta yake pekee.
    assert.equal(ledger.getAttempts().length, 2);
  });

  await t.test('B. attempt iliyoanguka bila bei: usage inaonekana, cost haibuniwi', async () => {
    const ledger = new UsageLedger();
    const provider = {
      id: 'boom',
      name: 'Boom Provider',
      isAvailable: async () => true,
      generateText: async () => {
        ledger.record({
          requestId: 'req_1',
          providerId: 'boom',
          modelId: 'boom-model',
          tier: 'balanced',
          startedAt: new Date().toISOString(),
          usageSource: 'unknown',
          fallbackUsed: false,
          status: 'failed',
        });
        throw new Error('provider imekufa');
      },
    };
    const identity = new IdentMgr();
    const memory = new MemMgr(new MemStore());
    const orchestrator = new AgentOrchestrator(
      provider as any,
      identity,
      new ReasonEng(provider as any, memory, identity),
      memory,
      new SafetyGuardrails(),
      ledger
    );

    const task = await orchestrator.executeTask('Chambua tatizo');
    assert.equal(task.status, 'failed');
    assert.ok(task.usage, 'attempt iliyoanguka lazima ionekane kwenye task');
    assert.equal(task.usage!.attemptCount, 1);
    assert.equal(task.usage!.totalTokens, 0);
    assert.equal(task.usage!.costUsd, undefined, 'cost haibuniwi bila bei halisi');
  });

  await t.test('C. bila ledger hakuna usage ya kubuni', async () => {
    const mock = new MockModelProvider();
    const identity = new IdentMgr();
    const memory = new MemMgr(new MemStore());
    const orchestrator = new AgentOrchestrator(
      mock,
      identity,
      new ReasonEng(mock, memory, identity),
      memory,
      new SafetyGuardrails()
    );
    const task = await orchestrator.executeTask('Chambua hatua za ujenzi wa database');
    assert.equal(task.status, 'completed');
    assert.equal(task.usage, undefined);
  });
});
