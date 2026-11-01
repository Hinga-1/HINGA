import test from 'node:test';
import assert from 'node:assert/strict';

import { EvaluationConfigError, gradeOutput } from './grader.ts';
import { compareToBaseline, runSuite, summarize, validateSuite } from './suite.ts';
import type { EvaluationSuite, RunSummary, SuiteRun } from './suite.ts';
import { confidenceAfter, evaluatePromotion, jaccardSimilarity } from './promotion-gate.ts';
import type { CandidateLesson, PromotedFact } from './promotion-gate.ts';
import { InMemoryEvaluationStore, NeonEvaluationStore } from './store.ts';

const baseCandidate: CandidateLesson = {
  id: 'lesson-1',
  topic: 'Neon branching for tests',
  summary: 'Test branches should be isolated from production data.',
  content:
    'Create a dedicated Neon branch for integration tests so production rows are never mutated. Delete the branch after the run.',
  sourceContext:
    'Integration tests must never mutate production. Create a dedicated Neon branch and delete it after the run; production rows stay untouched.',
  verificationQuestion: 'Where should integration tests run?',
  expectedAnswer: 'dedicated Neon branch',
  corroborations: 1,
};

const existingFact: PromotedFact = {
  id: 'fact-existing-1',
  topic: 'Neon branching',
  content: 'Integration tests run on a dedicated Neon branch that is deleted after the run.',
  confidence: 0.9,
};

test('Evaluation harness (Mission 002)', async (t) => {
  await t.test('graders: contains_all is case-insensitive by default', () => {
    const result = gradeOutput('Tumia .ENV na environment variables.', [
      { kind: 'contains_all', phrases: ['.env', 'environment variables'] },
    ]);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
  });

  await t.test('graders: contains_all reports the missing phrase', () => {
    const result = gradeOutput('Tumia .env pekee.', [
      { kind: 'contains_all', phrases: ['.env', 'secrets'] },
    ]);
    assert.equal(result.passed, false);
    assert.match(result.outcomes[0].detail, /secrets/);
  });

  await t.test('graders: caseSensitive is honoured', () => {
    const result = gradeOutput('API key', [
      { kind: 'contains_all', phrases: ['api key'], caseSensitive: true },
    ]);
    assert.equal(result.passed, false);
  });

  await t.test('graders: contains_none catches forbidden claims', () => {
    const result = gradeOutput('Nimefuta database yote.', [
      { kind: 'contains_none', phrases: ['nimefuta database'] },
    ]);
    assert.equal(result.passed, false);
  });

  await t.test('graders: regex works and invalid regex is a config error', () => {
    assert.equal(gradeOutput('hatari kabisa', [{ kind: 'regex', pattern: '(hatari|salama)', flags: 'i' }]).passed, true);
    assert.throws(
      () => gradeOutput('x', [{ kind: 'regex', pattern: '(' }]),
      (err: unknown) => err instanceof EvaluationConfigError
    );
  });

  await t.test('graders: json_keys accepts fenced JSON only when keys exist', () => {
    const ok = gradeOutput('```json\n{"conclusion":"sawa"}\n```', [
      { kind: 'json_keys', keys: ['conclusion'] },
    ]);
    assert.equal(ok.passed, true);

    const missing = gradeOutput('{"answer":"sawa"}', [{ kind: 'json_keys', keys: ['conclusion'] }]);
    assert.equal(missing.passed, false);

    const notJson = gradeOutput('sawa tu', [{ kind: 'json_keys', keys: ['conclusion'] }]);
    assert.equal(notJson.passed, false);
  });

  await t.test('graders: equals ignores extra whitespace', () => {
    const result = gradeOutput('  jibu   sahihi ', [{ kind: 'equals', expected: 'jibu sahihi' }]);
    assert.equal(result.passed, true);
  });

  await t.test('graders: min_words and max_words', () => {
    assert.equal(gradeOutput('maneno matatu hapa', [{ kind: 'min_words', count: 3 }]).passed, true);
    assert.equal(gradeOutput('maneno mawili', [{ kind: 'min_words', count: 3 }]).passed, false);
    assert.equal(gradeOutput('maneno mawili', [{ kind: 'max_words', count: 2 }]).passed, true);
  });

  await t.test('graders: a case without graders cannot be graded', () => {
    assert.throws(() => gradeOutput('x', []), (err: unknown) => err instanceof EvaluationConfigError);
  });

  await t.test('suite: duplicate case ids are rejected', () => {
    const suite: EvaluationSuite = {
      id: 's',
      version: '1',
      cases: [
        { id: 'a', prompt: 'p', graders: [{ kind: 'min_words', count: 1 }] },
        { id: 'a', prompt: 'p', graders: [{ kind: 'min_words', count: 1 }] },
      ],
    };
    assert.throws(() => validateSuite(suite), /imerudiwa/);
  });

  await t.test('suite: runs every case and computes pass rate and weighted score', async () => {
    const suite: EvaluationSuite = {
      id: 's',
      version: '1',
      cases: [
        { id: 'passes', prompt: 'p1', graders: [{ kind: 'contains_all', phrases: ['sawa'] }] },
        { id: 'fails', prompt: 'p2', graders: [{ kind: 'contains_all', phrases: ['hapana'] }], weight: 3 },
      ],
    };
    const run = await runSuite(suite, async (prompt) => (prompt === 'p1' ? 'sawa' : 'sawa'));
    assert.equal(run.passRate, 0.5);
    assert.equal(run.weightedScore, 0.25); // (1*1 + 0*3) / 4
    assert.equal(run.passed, false); // minPassRate defaults to 1
  });

  await t.test('suite: a generator error fails the case without aborting the run', async () => {
    const suite: EvaluationSuite = {
      id: 's',
      version: '1',
      minPassRate: 0,
      cases: [
        { id: 'boom', prompt: 'p', graders: [{ kind: 'min_words', count: 1 }] },
        { id: 'ok', prompt: 'q', graders: [{ kind: 'min_words', count: 1 }] },
      ],
    };
    const run = await runSuite(suite, async (prompt) => {
      if (prompt === 'p') throw new Error('provider imeanguka');
      return 'maneno mawili';
    });
    assert.equal(run.results[0].passed, false);
    assert.match(run.results[0].outputPreview, /provider imeanguka/);
    assert.equal(run.results[1].passed, true);
  });

  const buildRun = (passes: boolean[], suiteVersion = '1'): SuiteRun => ({
    suiteId: 's',
    suiteVersion,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    results: passes.map((passed, index) => ({
      caseId: `c${index}`,
      passed,
      score: passed ? 1 : 0,
      durationMs: 1,
      outputPreview: '',
      outcomes: [],
    })),
    passRate: passes.filter(Boolean).length / passes.length,
    weightedScore: passes.filter(Boolean).length / passes.length,
    passed: passes.every(Boolean),
  });

  await t.test('gate: no baseline is reported explicitly', () => {
    const report = compareToBaseline(summarize(buildRun([true])), null);
    assert.equal(report.verdict, 'no_baseline');
  });

  await t.test('gate: a case that passed before and fails now is a regression', () => {
    const report = compareToBaseline(summarize(buildRun([true, false])), summarize(buildRun([true, true])));
    assert.equal(report.verdict, 'regression');
    assert.deepEqual(report.regressions, ['c1']);
    assert.deepEqual(report.improvements, []);
  });

  await t.test('gate: improvements do not cancel regressions', () => {
    const report = compareToBaseline(summarize(buildRun([true, false])), summarize(buildRun([false, true])));
    assert.equal(report.verdict, 'regression');
    assert.deepEqual(report.regressions, ['c1']);
    assert.deepEqual(report.improvements, ['c0']);
  });

  await t.test('gate: removing cases is reported and still fails on a pass-rate drop', () => {
    const current = summarize(buildRun([true, false]));
    const baseline: RunSummary = {
      ...summarize(buildRun([true, true, true])),
      cases: [...summarize(buildRun([true, false])).cases, { caseId: 'c2', passed: true, score: 1 }],
    };
    const report = compareToBaseline(current, baseline);
    assert.deepEqual(report.addedCases, []);
    assert.equal(report.verdict, 'regression');
    assert.ok(report.reasons.some((reason) => reason.includes('Kesi zimeondolewa')));
  });

  await t.test('gate: different suite versions are not silently compared', () => {
    const report = compareToBaseline(summarize(buildRun([true], '2')), summarize(buildRun([true], '1')));
    assert.equal(report.verdict, 'incomparable');
  });

  await t.test('promotion: confidence recurrence matches the published gate', () => {
    assert.equal(confidenceAfter(0, 0), 0.5);
    assert.equal(Number(confidenceAfter(1, 0).toFixed(3)), 0.85);
    assert.equal(Number(confidenceAfter(2, 0).toFixed(3)), 0.955);
    assert.ok(Math.abs(confidenceAfter(2, 1) - 0.6685) < 1e-9);
  });

  await t.test('promotion: a grounded, corroborated lesson is promoted', () => {
    const decision = evaluatePromotion(baseCandidate, { existing: [] });
    assert.equal(decision.verdict, 'promote');
    assert.equal(Number(decision.confidence.toFixed(3)), 0.85);
    assert.ok(decision.groundingTerms.length >= 2);
  });

  await t.test('promotion: uncorroborated lessons need review, not promotion', () => {
    const decision = evaluatePromotion({ ...baseCandidate, corroborations: 0 }, { existing: [] });
    assert.equal(decision.verdict, 'needs_review');
  });

  await t.test('promotion: missing fields are rejected', () => {
    const decision = evaluatePromotion({ ...baseCandidate, topic: '  ' }, { existing: [] });
    assert.equal(decision.verdict, 'reject');
    assert.ok(decision.reasons.some((reason) => reason.includes('topic')));
  });

  await t.test('promotion: a lesson that does not contain its own answer is rejected', () => {
    const decision = evaluatePromotion({ ...baseCandidate, expectedAnswer: 'hii haipo kabisa' }, { existing: [] });
    assert.equal(decision.verdict, 'reject');
    assert.ok(decision.reasons.some((reason) => reason.includes('Jibu la uthibitisho')));
  });

  await t.test('promotion: a lesson with no lexical grounding in its source is rejected', () => {
    const decision = evaluatePromotion(
      {
        ...baseCandidate,
        sourceContext: 'Kuhusu hali ya hewa ya leo mjini Dodoma na joto kali sana.',
      },
      { existing: [] }
    );
    assert.equal(decision.verdict, 'reject');
    assert.ok(decision.reasons.some((reason) => reason.includes('msingi')));
  });

  await t.test('promotion: an exact duplicate is rejected, a near duplicate needs review', () => {
    const duplicate = evaluatePromotion({ ...baseCandidate, content: existingFact.content }, { existing: [existingFact] });
    assert.equal(duplicate.verdict, 'reject');
    assert.equal(duplicate.matchedExistingId, existingFact.id);

    const near = evaluatePromotion(
      { ...baseCandidate, content: `${existingFact.content} Cleanup note.` },
      { existing: [existingFact], duplicateThreshold: 0.99, overlapThreshold: 0.3 }
    );
    assert.equal(near.verdict, 'needs_review');
    assert.equal(near.matchedExistingId, existingFact.id);
  });

  await t.test('promotion: jaccard similarity is symmetric and bounded', () => {
    const a = new Set(['neon', 'branch', 'test']);
    const b = new Set(['neon', 'branch']);
    assert.equal(jaccardSimilarity(a, b), 2 / 3);
    assert.equal(jaccardSimilarity(b, a), 2 / 3);
    assert.equal(jaccardSimilarity(new Set(), new Set()), 0);
  });

  await t.test('store: in-memory run history round-trips and keeps the latest baseline', async () => {
    const store = new InMemoryEvaluationStore();
    const first = summarize(buildRun([true, true]));
    const second = summarize(buildRun([true, false]));

    await store.saveRun(buildRun([true, true]), { providerId: 'mock', modelId: 'mock-v1' });
    await store.saveRun(buildRun([true, false]), { providerId: 'mock', modelId: 'mock-v1' });

    const latest = await store.latestSummary('s');
    assert.ok(latest);
    assert.equal(latest?.passRate, second.passRate);
    assert.equal(latest?.cases.length, 2);
    assert.equal(first.passRate, 1);
  });

  await t.test('store: gaps and candidate lessons are recorded with their verdict', async () => {
    const store = new InMemoryEvaluationStore();
    await store.recordGap({ gapId: 'g1', topic: 'Neon branching', context: 'hakuna maarifa', severity: 'high' });
    const decision = evaluatePromotion(baseCandidate, { existing: [] });
    await store.saveCandidate(
      {
        lessonId: 'l1',
        topic: baseCandidate.topic,
        summary: baseCandidate.summary,
        content: baseCandidate.content,
        verificationQuestion: baseCandidate.verificationQuestion,
        expectedAnswer: baseCandidate.expectedAnswer,
      },
      decision
    );

    assert.equal(store.gaps.length, 1);
    assert.equal(store.lessons.length, 1);
    assert.equal(store.lessons[0].decision.verdict, 'promote');
  });

  await t.test('store: the Neon adapter refuses to run without a URL', () => {
    assert.throws(() => new NeonEvaluationStore(''), /DATABASE_URL/);
  });
});
