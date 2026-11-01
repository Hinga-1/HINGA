import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config.ts';
import { NeonEvaluationStore } from './store.ts';
import type { SuiteRun } from './suite.ts';

/**
 * Live test for the Neon adapter behind the evaluation store.
 *
 * Guard rails, in order:
 *   1. No DATABASE_URL_TEST  -> skip. Silence is honest; production is never a fallback.
 *   2. Test URL == production -> skip. Same rule as the memory test.
 *   3. Migration 002 missing  -> skip with the reason, because that is a setup task.
 *
 * The rows it writes carry a timestamped suite id so repeated runs never collide.
 */
const testUrl = config.databaseUrlTest;

test('NeonEvaluationStore (live, test branch only)', async (t) => {
  if (!testUrl) {
    t.skip('DATABASE_URL_TEST is not set (production DATABASE_URL is never used by tests)');
    return;
  }
  if (testUrl === config.databaseUrl) {
    t.skip('DATABASE_URL_TEST equals DATABASE_URL (production); refusing to write');
    return;
  }

  const store = new NeonEvaluationStore(testUrl);
  try {
    await store.assertSchema();
  } catch (err) {
    t.skip(
      `migration 002 haijatumika kwenye tawi la majaribio: ` +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  const stamp = Date.now();
  const suiteId = `live_store_${stamp}`;
  const startedAt = new Date(stamp).toISOString();
  const completedAt = new Date(stamp + 1_000).toISOString();

  const run: SuiteRun = {
    suiteId,
    suiteVersion: 'live-1',
    startedAt,
    completedAt,
    results: [
      {
        caseId: 'case-a',
        passed: true,
        score: 0.9,
        durationMs: 12,
        outputPreview: 'ndiyo',
        outcomes: [],
      },
      {
        caseId: 'case-b',
        passed: false,
        score: 0.2,
        durationMs: 9,
        outputPreview: 'hapana',
        outcomes: [],
      },
    ],
    passRate: 0.5,
    weightedScore: 0.55,
    passed: false,
  };

  await t.test('saves a run and reads the same suite back', async () => {
    const id = await store.saveRun(run, { providerId: 'local-provider', modelId: 'test-fixture' });
    assert.equal(id, `eval_${suiteId}_live-1_${stamp}`);

    const summary = await store.latestSummary(suiteId);
    assert.ok(summary, 'run inapaswa kusomwa');
    assert.equal(summary!.suiteVersion, 'live-1');
    assert.equal(summary!.passRate, 0.5);
    assert.deepEqual(
      summary!.cases.map((item) => item.caseId),
      ['case-a', 'case-b']
    );
    assert.equal(summary!.cases[0].score, 0.9);
  });

  await t.test('records a learning gap idempotently', async () => {
    const gap = {
      gapId: `gap_${stamp}`,
      topic: 'Kipimo cha live',
      context: 'Kuhakikisha adapter inaandika kwenye tawi la majaribio.',
      severity: 'low' as const,
    };
    await store.recordGap(gap);
    await store.recordGap(gap);
    assert.ok(true, 'kuandika mara mbili hakuvunji kitu');
  });

  await t.test('saves a candidate lesson with its promotion decision', async () => {
    await store.saveCandidate(
      {
        lessonId: `lesson_${stamp}`,
        topic: 'Kipimo cha live',
        summary: 'Ushahidi kwamba adapter inafanya kazi.',
        content: 'Maudhui ya jaribio.',
        verificationQuestion: 'Je, jaribio limepita?',
        expectedAnswer: 'Ndiyo.',
      },
      {
        verdict: 'needs_review',
        confidence: 0.5,
        reasons: ['jaribio la live'],
        groundingTerms: [],
      }
    );
    assert.ok(true, 'candidate imehifadhiwa');
  });
});
