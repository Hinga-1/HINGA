/**
 * Automation layer for the evaluation gate (Mission 002, step 5).
 *
 * Pure TypeScript: no network, no database, no API key, no wall clock unless the
 * caller passes `nowIso`. Everything here is a function of its inputs, so the
 * same run always produces the same decision and the same checkpoint.
 *
 * The layer answers one question for the rest of the system:
 * "is this run allowed to replace what we trust today?"
 */

import type { RunSummary, SuiteRun } from './suite.ts';
import { compareToBaseline, summarize } from './suite.ts';

export const BASELINE_SCHEMA_VERSION = 1;

export interface BaselineFile {
  schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion: string;
  providerId: string;
  modelId: string;
  codeCommit: string | null;
  recordedAt: string;
  summary: RunSummary;
}

export class BaselineFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineFileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function requireString(record: Record<string, unknown>, field: string, where: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BaselineFileError(`${where}: "${field}" lazima iwe maandishi yasiyo tupu.`);
  }
  return value;
}

/**
 * Validates a baseline document before the gate is allowed to trust it.
 * A baseline is a contract, so a malformed one is a configuration error (exit 2)
 * rather than a silent "no baseline".
 */
export function parseBaseline(text: string): BaselineFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new BaselineFileError(
      `Baseline si JSON sahihi: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isRecord(raw)) throw new BaselineFileError('Baseline lazima iwe kitu (object) cha JSON.');

  if (raw.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new BaselineFileError(
      `schemaVersion ya baseline haitambuliki: ${String(raw.schemaVersion)} (inatarajiwa ${BASELINE_SCHEMA_VERSION}).`
    );
  }

  const suiteId = requireString(raw, 'suiteId', 'baseline');
  const suiteVersion = requireString(raw, 'suiteVersion', 'baseline');
  const providerId = requireString(raw, 'providerId', 'baseline');
  const modelId = requireString(raw, 'modelId', 'baseline');
  const recordedAt = requireString(raw, 'recordedAt', 'baseline');
  const codeCommit = raw.codeCommit === null || raw.codeCommit === undefined ? null : String(raw.codeCommit);

  const summaryRaw = raw.summary;
  if (!isRecord(summaryRaw)) throw new BaselineFileError('baseline.summary lazima iwe kitu cha JSON.');
  if (summaryRaw.suiteId !== suiteId) {
    throw new BaselineFileError('baseline.summary.suiteId haiendani na baseline.suiteId.');
  }
  if (summaryRaw.suiteVersion !== suiteVersion) {
    throw new BaselineFileError('baseline.summary.suiteVersion haiendani na baseline.suiteVersion.');
  }
  if (!Array.isArray(summaryRaw.cases) || summaryRaw.cases.length === 0) {
    throw new BaselineFileError('baseline.summary.cases lazima iwe orodha isiyo tupu.');
  }
  if (!isUnit(summaryRaw.passRate)) {
    throw new BaselineFileError('baseline.summary.passRate lazima iwe kati ya 0 na 1.');
  }
  if (!isUnit(summaryRaw.weightedScore)) {
    throw new BaselineFileError('baseline.summary.weightedScore lazima iwe kati ya 0 na 1.');
  }

  const seen = new Set<string>();
  const cases = summaryRaw.cases.map((item: unknown, index: number) => {
    if (!isRecord(item)) throw new BaselineFileError(`baseline.summary.cases[${index}] si kitu cha JSON.`);
    const caseId = requireString(item, 'caseId', `baseline.summary.cases[${index}]`);
    if (seen.has(caseId)) {
      throw new BaselineFileError(`baseline.summary.cases inarudia caseId "${caseId}".`);
    }
    seen.add(caseId);
    if (typeof item.passed !== 'boolean') {
      throw new BaselineFileError(`baseline.summary.cases[${index}].passed lazima iwe true/false.`);
    }
    if (!isUnit(item.score)) {
      throw new BaselineFileError(`baseline.summary.cases[${index}].score lazima iwe kati ya 0 na 1.`);
    }
    return { caseId, passed: item.passed, score: item.score };
  });

  const derived = cases.filter((item) => item.passed).length / cases.length;
  if (Math.abs(derived - summaryRaw.passRate) > 1e-9) {
    throw new BaselineFileError(
      `baseline.summary.passRate (${summaryRaw.passRate}) haiwiani na kesi (${derived.toFixed(4)}).`
    );
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    suiteId,
    suiteVersion,
    providerId,
    modelId,
    codeCommit,
    recordedAt,
    summary: {
      suiteId,
      suiteVersion,
      passRate: summaryRaw.passRate,
      weightedScore: summaryRaw.weightedScore,
      cases,
    },
  };
}

export function serializeBaseline(file: BaselineFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface BaselineRecordInput {
  run: SuiteRun;
  providerId: string;
  modelId: string;
  codeCommit?: string | null;
  recordedAt: string;
}

export function recordBaseline(input: BaselineRecordInput): BaselineFile {
  const summary = summarize(input.run);
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    suiteId: summary.suiteId,
    suiteVersion: summary.suiteVersion,
    providerId: input.providerId,
    modelId: input.modelId,
    codeCommit: input.codeCommit ?? null,
    recordedAt: input.recordedAt,
    summary,
  };
}

export type GateVerdict = 'pass' | 'regression' | 'no_baseline' | 'incomparable';

export interface AutomationInput {
  run: SuiteRun;
  baseline: BaselineFile | null;
  providerIsMock: boolean;
  /** CI mode: a missing baseline is a failure instead of an informational run. */
  strict?: boolean;
  updateBaseline?: boolean;
  allowMockBaseline?: boolean;
  /** Injected so tests and replays are deterministic. */
  nowIso?: string;
}

export interface AutomationDecision {
  verdict: GateVerdict;
  exitCode: 0 | 1 | 2;
  reasons: string[];
  writeBaseline: boolean;
  nextBaseline: BaselineFile | null;
}

/**
 * Turns one suite run into an exit code and, optionally, a new baseline.
 *
 * Rules, in order:
 * 1. A malformed/incomparable comparison is a configuration error (2), never a pass.
 * 2. Any regressed case fails the gate (1), even if the net score improved.
 * 3. A missing baseline is informational unless `strict`.
 * 4. A failing suite never writes a baseline, whatever the flags say.
 * 5. A mock provider never writes a baseline unless explicitly allowed.
 */
export function decideAutomation(input: AutomationInput): AutomationDecision {
  const summary = summarize(input.run);
  const report = compareToBaseline(summary, input.baseline ? input.baseline.summary : null);
  const reasons = [...report.reasons];

  const failedCases = input.run.results.filter((result) => !result.passed).map((result) => result.caseId);
  if (failedCases.length > 0) {
    reasons.push(`Kesi hazikupita: ${failedCases.join(', ')}.`);
  }

  let exitCode: 0 | 1 | 2 = 0;
  if (report.verdict === 'incomparable') exitCode = 2;
  else if (report.verdict === 'regression') exitCode = 1;
  else if (report.verdict === 'no_baseline') exitCode = input.strict ? 1 : 0;
  if (exitCode === 0 && failedCases.length > 0) exitCode = 1;

  let writeBaseline = false;
  if (input.updateBaseline) {
    if (exitCode !== 0) {
      reasons.push('Baseline haikuhifadhiwa: lango halikupita.');
    } else if (input.providerIsMock && !input.allowMockBaseline) {
      reasons.push(
        'Baseline haikuhifadhiwa: provider ni mock (stub ya sandbox), si kipimo cha ubora. ' +
          'Tumia --allow-mock-baseline ikiwa unataka hivyo kwa makusudi.'
      );
    } else {
      writeBaseline = true;
    }
  }

  const nextBaseline = writeBaseline
    ? recordBaseline({
        run: input.run,
        providerId: input.baseline?.providerId ?? 'current',
        modelId: input.baseline?.modelId ?? 'current',
        codeCommit: input.baseline?.codeCommit ?? null,
        recordedAt: input.nowIso ?? new Date().toISOString(),
      })
    : null;

  return { verdict: report.verdict, exitCode, reasons, writeBaseline, nextBaseline };
}

export interface CheckpointInput {
  run: SuiteRun;
  decision: AutomationDecision;
  providerId: string;
  modelId: string;
  providerIsMock: boolean;
  codeCommit: string | null;
  branch: string | null;
  baseline: BaselineFile | null;
  createdAt?: string;
}

export interface Checkpoint {
  version: 1;
  createdAt: string;
  suite: { id: string; version: string };
  provider: { id: string; modelId: string; mock: boolean };
  code: { commit: string | null; branch: string | null };
  run: {
    passed: boolean;
    passRate: number;
    weightedScore: number;
    cases: number;
    failedCases: string[];
  };
  gate: { verdict: GateVerdict; exitCode: 0 | 1 | 2; reasons: string[] };
  baseline: { present: boolean; recordedAt: string | null; providerId: string | null };
  nextActions: string[];
}

function nextActions(input: { run: SuiteRun; decision: AutomationDecision; providerIsMock: boolean }): string[] {
  const actions: string[] = [];
  if (input.decision.verdict === 'no_baseline') {
    actions.push('Rekodi baseline kwa modeli halisi: npx tsx scripts/eval-automation.ts --live --update-baseline');
  }
  if (input.decision.verdict === 'regression') {
    actions.push('Chunguza kesi zilizoshuka kabla ya kubadilisha kitu kingine; usiongeze tolerance.');
  }
  if (input.decision.verdict === 'incomparable') {
    actions.push('Hakiki suiteId/suiteVersion: baseline ya toleo lingine hailimganishwi.');
  }
  if (input.providerIsMock) {
    actions.push('Mock ni stub ya sandbox; matokeo haya si kipimo cha ubora wa modeli.');
  }
  const failed = input.run.results.filter((result) => !result.passed);
  if (failed.length > 0) {
    actions.push(`Ongeza au rekebisha kesi: ${failed.map((item) => item.caseId).join(', ')}.`);
  }
  const blocked = input.decision.verdict === 'regression' || input.decision.verdict === 'incomparable';
  if (!blocked && failed.length === 0) {
    actions.push('Endelea: ongeza kesi mpya kabla ya kupanua uwezo wa mfumo.');
  }
  if (actions.length === 0) {
    actions.push('Hakuna hatua ya kiotomatiki; hakiki ripoti kwa mkono.');
  }
  return actions;
}

export function buildCheckpoint(input: CheckpointInput): Checkpoint {
  const summary = summarize(input.run);
  return {
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    suite: { id: summary.suiteId, version: summary.suiteVersion },
    provider: { id: input.providerId, modelId: input.modelId, mock: input.providerIsMock },
    code: { commit: input.codeCommit, branch: input.branch },
    run: {
      passed: input.run.passed,
      passRate: summary.passRate,
      weightedScore: summary.weightedScore,
      cases: summary.cases.length,
      failedCases: summary.cases.filter((item) => !item.passed).map((item) => item.caseId),
    },
    gate: {
      verdict: input.decision.verdict,
      exitCode: input.decision.exitCode,
      reasons: input.decision.reasons,
    },
    baseline: {
      present: input.baseline !== null,
      recordedAt: input.baseline?.recordedAt ?? null,
      providerId: input.baseline?.providerId ?? null,
    },
    nextActions: nextActions({ run: input.run, decision: input.decision, providerIsMock: input.providerIsMock }),
  };
}

export function renderCheckpointMarkdown(checkpoint: Checkpoint): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [
    '# Evaluation checkpoint',
    '',
    `- **Imeundwa:** ${checkpoint.createdAt}`,
    `- **Suite:** ${checkpoint.suite.id} v${checkpoint.suite.version}`,
    `- **Provider:** ${checkpoint.provider.id} / ${checkpoint.provider.modelId}${checkpoint.provider.mock ? ' (mock stub)' : ''}`,
    `- **Code:** ${checkpoint.code.branch ?? '?'} @ ${checkpoint.code.commit ?? '?'}`,
    '',
    '## Run',
    '',
    '| Kipimo | Thamani |',
    '|---|---|',
    `| Pass rate | ${percent(checkpoint.run.passRate)} |`,
    `| Weighted score | ${percent(checkpoint.run.weightedScore)} |`,
    `| Kesi | ${checkpoint.run.cases} |`,
    `| Zilizoshindwa | ${checkpoint.run.failedCases.length === 0 ? 'hakuna' : checkpoint.run.failedCases.join(', ')} |`,
    '',
    '## Lango',
    '',
    `**${checkpoint.gate.verdict}** (exit ${checkpoint.gate.exitCode})`,
    '',
  ];
  for (const reason of checkpoint.gate.reasons) lines.push(`- ${reason}`);
  lines.push('', '## Hatua zinazofuata', '');
  for (const action of checkpoint.nextActions) lines.push(`- ${action}`);
  lines.push(
    '',
    '---',
    '',
    '_Faili hii ni hali ya kuendelea (resume state). Haiweki siri, API key, au connection string._'
  );
  return `${lines.join('\n')}\n`;
}
