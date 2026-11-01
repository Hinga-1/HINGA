/**
 * Evaluation suite runner and regression gate (Mission 002).
 *
 * A suite is a frozen list of cases with deterministic graders. A run is
 * compared against the last accepted baseline, and any case that regresses
 * blocks promotion. This is the "gate" half of the learning loop: nothing is
 * promoted into durable memory unless it first passes a suite that has not
 * regressed.
 */

import { EvaluationConfigError, Grader, gradeOutput, GraderOutcome } from './grader.ts';

export interface EvaluationCase {
  id: string;
  prompt: string;
  graders: Grader[];
  /** Relative weight in the weighted score. Defaults to 1. */
  weight?: number;
  tags?: string[];
}

export interface EvaluationSuite {
  id: string;
  version: string;
  cases: EvaluationCase[];
  /** Minimum pass rate (0..1) for the suite to pass. Defaults to 1. */
  minPassRate?: number;
}

export interface CaseRun {
  caseId: string;
  passed: boolean;
  score: number;
  durationMs: number;
  outputPreview: string;
  outcomes: GraderOutcome[];
}

export interface SuiteRun {
  suiteId: string;
  suiteVersion: string;
  startedAt: string;
  completedAt: string;
  results: CaseRun[];
  /** Fraction of cases that passed (0..1). */
  passRate: number;
  /** Weighted mean of per-case scores (0..1). */
  weightedScore: number;
  passed: boolean;
}

export interface RunSummary {
  suiteId: string;
  suiteVersion: string;
  passRate: number;
  weightedScore: number;
  cases: { caseId: string; passed: boolean; score: number }[];
}

export type RegressionVerdict = 'pass' | 'regression' | 'no_baseline' | 'incomparable';

export interface RegressionReport {
  verdict: RegressionVerdict;
  passRateDelta: number;
  weightedScoreDelta: number;
  regressions: string[];
  improvements: string[];
  addedCases: string[];
  removedCases: string[];
  reasons: string[];
}

export const PREVIEW_CHARS = 400;

export function validateSuite(suite: EvaluationSuite): void {
  if (!suite || typeof suite !== 'object') throw new EvaluationConfigError('suite haipo');
  if (!suite.id?.trim()) throw new EvaluationConfigError('suite.id haipo');
  if (!suite.version?.trim()) throw new EvaluationConfigError('suite.version haipo');
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new EvaluationConfigError('suite inahitaji angalau kesi moja');
  }

  const ids = new Set<string>();
  for (const testCase of suite.cases) {
    if (!testCase.id?.trim()) throw new EvaluationConfigError('kesi haina id');
    if (ids.has(testCase.id)) throw new EvaluationConfigError(`kesi yenye id "${testCase.id}" imerudiwa`);
    ids.add(testCase.id);
    if (!testCase.prompt?.trim()) throw new EvaluationConfigError(`kesi ${testCase.id} haina prompt`);
    if (!Array.isArray(testCase.graders) || testCase.graders.length === 0) {
      throw new EvaluationConfigError(`kesi ${testCase.id} haina grader`);
    }
    if (testCase.weight !== undefined && (!Number.isFinite(testCase.weight) || testCase.weight <= 0)) {
      throw new EvaluationConfigError(`kesi ${testCase.id} ina weight isiyo sahihi`);
    }
  }

  const minPassRate = suite.minPassRate ?? 1;
  if (!Number.isFinite(minPassRate) || minPassRate < 0 || minPassRate > 1) {
    throw new EvaluationConfigError('minPassRate lazima iwe kati ya 0 na 1');
  }
}

export type GenerateFn = (prompt: string, testCase: EvaluationCase) => Promise<string>;

/**
 * Runs every case once. A generator error is recorded as a failed case with the
 * error message, so one broken provider call cannot abort the whole suite.
 */
export async function runSuite(suite: EvaluationSuite, generate: GenerateFn): Promise<SuiteRun> {
  validateSuite(suite);
  const startedAt = new Date().toISOString();
  const results: CaseRun[] = [];

  for (const testCase of suite.cases) {
    const caseStart = Date.now();
    let output = '';
    let error: string | null = null;

    try {
      output = await generate(testCase.prompt, testCase);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - caseStart;

    if (error !== null) {
      results.push({
        caseId: testCase.id,
        passed: false,
        score: 0,
        durationMs,
        outputPreview: `hitilafu: ${error}`,
        outcomes: [],
      });
      continue;
    }

    const grade = gradeOutput(output, testCase.graders);
    results.push({
      caseId: testCase.id,
      passed: grade.passed,
      score: grade.score,
      durationMs,
      outputPreview: output.slice(0, PREVIEW_CHARS),
      outcomes: grade.outcomes,
    });
  }

  const totalWeight = suite.cases.reduce((sum, testCase) => sum + (testCase.weight ?? 1), 0);
  const weightedScore =
    suite.cases.reduce((sum, testCase, index) => sum + results[index].score * (testCase.weight ?? 1), 0) /
    totalWeight;
  const passRate = results.filter((result) => result.passed).length / results.length;
  const minPassRate = suite.minPassRate ?? 1;

  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    passRate,
    weightedScore,
    passed: passRate >= minPassRate,
  };
}

export function summarize(run: SuiteRun): RunSummary {
  return {
    suiteId: run.suiteId,
    suiteVersion: run.suiteVersion,
    passRate: run.passRate,
    weightedScore: run.weightedScore,
    cases: run.results.map((result) => ({
      caseId: result.caseId,
      passed: result.passed,
      score: result.score,
    })),
  };
}

export interface BaselineOptions {
  /** Refuse to compare runs of different suite versions. Defaults to true. */
  requireSameVersion?: boolean;
}

/**
 * Compares a run to the accepted baseline.
 *
 * A regression is a case that passed in the baseline and fails now, or a pass
 * rate below the baseline. Improvements do not cancel regressions: the gate is
 * intentionally conservative, because research on self-improvement shows that
 * accepting net-positive changes silently keeps individual failures. There is
 * deliberately no tolerance knob; a failing case is a failing case.
 */
export function compareToBaseline(
  current: RunSummary,
  baseline: RunSummary | null,
  options: BaselineOptions = {}
): RegressionReport {
  const requireSameVersion = options.requireSameVersion ?? true;

  if (!baseline) {
    return {
      verdict: 'no_baseline',
      passRateDelta: 0,
      weightedScoreDelta: 0,
      regressions: [],
      improvements: [],
      addedCases: current.cases.map((testCase) => testCase.caseId),
      removedCases: [],
      reasons: ['Hakuna baseline iliyohifadhiwa kwa suite hii.'],
    };
  }

  if (current.suiteId !== baseline.suiteId) {
    return {
      verdict: 'incomparable',
      passRateDelta: 0,
      weightedScoreDelta: 0,
      regressions: [],
      improvements: [],
      addedCases: [],
      removedCases: [],
      reasons: [`Suite tofauti: ${current.suiteId} vs ${baseline.suiteId}.`],
    };
  }

  if (requireSameVersion && current.suiteVersion !== baseline.suiteVersion) {
    return {
      verdict: 'incomparable',
      passRateDelta: 0,
      weightedScoreDelta: 0,
      regressions: [],
      improvements: [],
      addedCases: [],
      removedCases: [],
      reasons: [
        `Toleo la suite limebadilika (${baseline.suiteVersion} -> ${current.suiteVersion}); baseline ya zamani hailinganishwi.`,
      ],
    };
  }

  const baselineCases = new Map(baseline.cases.map((testCase) => [testCase.caseId, testCase]));
  const currentCases = new Map(current.cases.map((testCase) => [testCase.caseId, testCase]));

  const regressions: string[] = [];
  const improvements: string[] = [];
  const addedCases: string[] = [];

  for (const [caseId, currentCase] of currentCases) {
    const baselineCase = baselineCases.get(caseId);
    if (!baselineCase) {
      addedCases.push(caseId);
      continue;
    }
    if (baselineCase.passed && !currentCase.passed) regressions.push(caseId);
    if (!baselineCase.passed && currentCase.passed) improvements.push(caseId);
  }

  const removedCases = [...baselineCases.keys()].filter((caseId) => !currentCases.has(caseId));
  const passRateDelta = current.passRate - baseline.passRate;
  const weightedScoreDelta = current.weightedScore - baseline.weightedScore;

  const reasons: string[] = [];
  if (regressions.length > 0) reasons.push(`Kesi zilizoshuka: ${regressions.join(', ')}`);
  if (regressions.length === 0 && passRateDelta < 0) {
    reasons.push(`Pass rate imeshuka kwa ${(Math.abs(passRateDelta) * 100).toFixed(1)} pointi.`);
  }
  if (removedCases.length > 0) reasons.push(`Kesi zimeondolewa: ${removedCases.join(', ')}`);
  if (improvements.length > 0) reasons.push(`Kesi zimeboreshwa: ${improvements.join(', ')}`);

  const failed = regressions.length > 0 || passRateDelta < 0;
  return {
    verdict: failed ? 'regression' : 'pass',
    passRateDelta,
    weightedScoreDelta,
    regressions,
    improvements,
    addedCases,
    removedCases,
    reasons,
  };
}
