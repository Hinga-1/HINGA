import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE_SCHEMA_VERSION,
  BaselineFileError,
  buildCheckpoint,
  decideAutomation,
  parseBaseline,
  recordBaseline,
  renderCheckpointMarkdown,
  serializeBaseline,
} from './automation.ts';
import type { BaselineFile } from './automation.ts';
import { runSuite } from './suite.ts';
import type { EvaluationSuite } from './suite.ts';

const suite: EvaluationSuite = {
  id: 'automation-suite',
  version: '1.0.0',
  minPassRate: 1,
  cases: [
    { id: 'a', prompt: 'a', weight: 1, graders: [{ id: 'g', kind: 'contains_all', phrases: ['sawa'] }] },
    { id: 'b', prompt: 'b', weight: 1, graders: [{ id: 'g', kind: 'contains_all', phrases: ['sawa'] }] },
  ],
};

async function runWith(answers: string[]) {
  let index = 0;
  return runSuite(suite, async () => answers[index++] ?? '');
}

test('automation: baseline round-trip preserves the summary', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const baseline = recordBaseline({
    run,
    providerId: 'mock',
    modelId: 'mock-1',
    codeCommit: 'abc123',
    recordedAt: '2026-11-01T00:00:00.000Z',
  });
  const parsed = parseBaseline(serializeBaseline(baseline));
  assert.equal(parsed.schemaVersion, BASELINE_SCHEMA_VERSION);
  assert.equal(parsed.summary.passRate, 1);
  assert.deepEqual(
    parsed.summary.cases.map((item) => item.caseId),
    ['a', 'b']
  );
  assert.equal(parsed.codeCommit, 'abc123');
});

test('automation: a baseline whose passRate disagrees with its cases is rejected', async () => {
  const run = await runWith(['sawa', 'kosa']);
  const baseline = recordBaseline({
    run,
    providerId: 'mock',
    modelId: 'mock-1',
    recordedAt: '2026-11-01T00:00:00.000Z',
  });
  const tampered = JSON.parse(serializeBaseline(baseline)) as BaselineFile;
  tampered.summary.passRate = 1;
  assert.throws(() => parseBaseline(JSON.stringify(tampered)), BaselineFileError);
});

test('automation: wrong schema version and duplicate case ids are rejected', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const baseline = recordBaseline({
    run,
    providerId: 'mock',
    modelId: 'mock-1',
    recordedAt: '2026-11-01T00:00:00.000Z',
  });

  const wrongVersion = JSON.parse(serializeBaseline(baseline)) as Record<string, unknown>;
  wrongVersion.schemaVersion = 99;
  assert.throws(() => parseBaseline(JSON.stringify(wrongVersion)), /schemaVersion/);

  const duplicated = JSON.parse(serializeBaseline(baseline)) as BaselineFile;
  duplicated.summary.cases = [duplicated.summary.cases[0], duplicated.summary.cases[0]];
  duplicated.summary.passRate = 1;
  assert.throws(() => parseBaseline(JSON.stringify(duplicated)), /inarudia/);

  assert.throws(() => parseBaseline('si json'), /JSON/);
});

test('automation: a missing baseline is informational unless strict', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const lenient = decideAutomation({ run, baseline: null, providerIsMock: true });
  assert.equal(lenient.verdict, 'no_baseline');
  assert.equal(lenient.exitCode, 0);

  const strict = decideAutomation({ run, baseline: null, providerIsMock: true, strict: true });
  assert.equal(strict.exitCode, 1);
});

test('automation: a regressed case fails the gate even when the net score improves', async () => {
  const baselineRun = await runWith(['sawa', 'sawa']);
  const baseline = recordBaseline({
    run: baselineRun,
    providerId: 'mock',
    modelId: 'mock-1',
    recordedAt: '2026-11-01T00:00:00.000Z',
  });

  const current = await runWith(['sawa', 'kosa']);
  const decision = decideAutomation({ run: current, baseline, providerIsMock: true });
  assert.equal(decision.verdict, 'regression');
  assert.equal(decision.exitCode, 1);
  assert.equal(decision.writeBaseline, false);
});

test('automation: a failing suite never writes a baseline', async () => {
  const run = await runWith(['sawa', 'kosa']);
  const decision = decideAutomation({
    run,
    baseline: null,
    providerIsMock: false,
    updateBaseline: true,
    allowMockBaseline: true,
  });
  assert.equal(decision.exitCode, 1);
  assert.equal(decision.writeBaseline, false);
  assert.equal(decision.nextBaseline, null);
});

test('automation: a mock provider needs an explicit flag to become a baseline', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const refused = decideAutomation({ run, baseline: null, providerIsMock: true, updateBaseline: true });
  assert.equal(refused.writeBaseline, false);
  assert.ok(refused.reasons.some((reason) => reason.includes('mock')));

  const allowed = decideAutomation({
    run,
    baseline: null,
    providerIsMock: true,
    updateBaseline: true,
    allowMockBaseline: true,
    nowIso: '2026-11-01T00:00:00.000Z',
  });
  assert.equal(allowed.writeBaseline, true);
  assert.equal(allowed.nextBaseline?.recordedAt, '2026-11-01T00:00:00.000Z');
});

test('automation: a different suite version is a configuration error, not a pass', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const baseline = recordBaseline({
    run,
    providerId: 'mock',
    modelId: 'mock-1',
    recordedAt: '2026-11-01T00:00:00.000Z',
  });
  baseline.suiteVersion = '2.0.0';
  baseline.summary.suiteVersion = '2.0.0';

  const decision = decideAutomation({ run, baseline, providerIsMock: true });
  assert.equal(decision.verdict, 'incomparable');
  assert.equal(decision.exitCode, 2);
});

test('automation: checkpoint is deterministic and contains no secret-bearing fields', async () => {
  const run = await runWith(['sawa', 'kosa']);
  const decision = decideAutomation({ run, baseline: null, providerIsMock: true });
  const checkpoint = buildCheckpoint({
    run,
    decision,
    providerId: 'mock',
    modelId: 'mock-1',
    providerIsMock: true,
    codeCommit: 'abc123',
    branch: 'mission-002-learning-gate',
    baseline: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  });

  assert.equal(checkpoint.gate.verdict, 'no_baseline');
  assert.deepEqual(checkpoint.run.failedCases, ['b']);
  assert.equal(checkpoint.baseline.present, false);

  const markdown = renderCheckpointMarkdown(checkpoint);
  assert.ok(markdown.includes('automation-suite v1.0.0'));
  assert.ok(markdown.includes('mock stub'));
  assert.ok(markdown.includes('Hatua zinazofuata'));
  assert.ok(!/api[_-]?key|postgres(ql)?:\/\//i.test(markdown));
});

test('automation: a clean run suggests adding cases, not relaxing the gate', async () => {
  const run = await runWith(['sawa', 'sawa']);
  const decision = decideAutomation({ run, baseline: null, providerIsMock: false });
  const checkpoint = buildCheckpoint({
    run,
    decision,
    providerId: 'gemini',
    modelId: 'gemini-2.5-flash',
    providerIsMock: false,
    codeCommit: null,
    branch: null,
    baseline: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  assert.ok(checkpoint.nextActions.some((action) => action.includes('ongeza kesi')));
});
