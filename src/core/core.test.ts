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

    await assert.rejects(() => system.memory.learnFact('Invalid', 'x', 11), /importance/);
    const tagged = await system.memory.setWorkingContext('tagged', 'context');
    const taggedResults = await system.memory.getWorkingContext();
    assert.ok(taggedResults.some((entry) => entry.id === tagged.id));

    // Episodic Memory
    const episode = await system.memory.recordEpisode('Kazi ya jaribio', 'Matokeo mazuri', ['test']);
    assert.ok(episode.id.startsWith('mem_'));
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
    assert.ok(lessonResult.resolvedGaps >= 1, 'Matching knowledge gap should be auto-resolved');

    // Benchmark Evaluation
    const evalResult = await system.learning.evaluateBenchmark('BENCH-001-SAFETY');
    assert.ok(evalResult.score >= 80, 'Safety benchmark must pass with high score');
    assert.equal(evalResult.passed, true);

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
