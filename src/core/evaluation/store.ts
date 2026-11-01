/**
 * Persistence for evaluation runs, gaps and candidate lessons (Mission 002).
 *
 * The Neon adapter intentionally targets the schema defined by
 * `db/migrations/002_ai_core_state.sql` (Mission 003 work on the Manus branch):
 * evaluation_runs, evaluation_case_results, learning_gaps, candidate_lessons.
 * It does not create or alter tables. If the migration has not been applied the
 * adapter fails loudly instead of silently writing nowhere.
 */

import { neon } from '@neondatabase/serverless';
import type { RunSummary, SuiteRun } from './suite.ts';
import type { PromotionDecision } from './promotion-gate.ts';

export interface RunMetadata {
  providerId: string;
  modelId: string;
  codeCommit?: string;
}

export interface GapRecord {
  gapId: string;
  topic: string;
  context: string;
  severity: 'low' | 'medium' | 'high';
  status?: 'open' | 'candidate' | 'resolved' | 'rejected';
  detectedAt?: string;
}

export interface LessonRecord {
  lessonId: string;
  topic: string;
  summary: string;
  content: string;
  verificationQuestion: string;
  expectedAnswer: string;
  sourceUri?: string;
}

export interface EvaluationStore {
  saveRun(run: SuiteRun, meta: RunMetadata): Promise<string>;
  latestSummary(suiteId: string): Promise<RunSummary | null>;
  recordGap(gap: GapRecord): Promise<void>;
  saveCandidate(lesson: LessonRecord, decision: PromotionDecision): Promise<void>;
}

export class StoreSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreSchemaError';
  }
}

const REQUIRED_TABLES = [
  'evaluation_runs',
  'evaluation_case_results',
  'learning_gaps',
  'candidate_lessons',
] as const;

function runId(run: SuiteRun): string {
  const stamp = Date.parse(run.completedAt);
  const safeStamp = Number.isFinite(stamp) ? stamp : Date.now();
  return `eval_${run.suiteId}_${run.suiteVersion}_${safeStamp}`;
}

/** Deterministic in-memory store for unit tests and local runs. */
export class InMemoryEvaluationStore implements EvaluationStore {
  private runs = new Map<string, { run: SuiteRun; meta: RunMetadata }>();
  private order: string[] = [];
  readonly gaps: GapRecord[] = [];
  readonly lessons: { lesson: LessonRecord; decision: PromotionDecision }[] = [];

  async saveRun(run: SuiteRun, meta: RunMetadata): Promise<string> {
    const id = runId(run);
    this.runs.set(id, { run, meta });
    this.order.push(id);
    return id;
  }

  async latestSummary(suiteId: string): Promise<RunSummary | null> {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const entry = this.runs.get(this.order[i]);
      if (entry && entry.run.suiteId === suiteId) {
        return {
          suiteId: entry.run.suiteId,
          suiteVersion: entry.run.suiteVersion,
          passRate: entry.run.passRate,
          weightedScore: entry.run.weightedScore,
          cases: entry.run.results.map((result) => ({
            caseId: result.caseId,
            passed: result.passed,
            score: result.score,
          })),
        };
      }
    }
    return null;
  }

  async recordGap(gap: GapRecord): Promise<void> {
    this.gaps.push({ ...gap });
  }

  async saveCandidate(lesson: LessonRecord, decision: PromotionDecision): Promise<void> {
    this.lessons.push({ lesson: { ...lesson }, decision: { ...decision } });
  }
}

export interface NeonEvaluationStoreOptions {
  schema?: string;
}

export class NeonEvaluationStore implements EvaluationStore {
  private sql;
  private schema: string;

  constructor(databaseUrl: string, options: NeonEvaluationStoreOptions = {}) {
    if (!databaseUrl) throw new Error('DATABASE_URL inahitajika kwa NeonEvaluationStore');
    this.sql = neon(databaseUrl);
    this.schema = options.schema ?? 'public';
  }

  /** Verifies that migration 002 has been applied. Does not create tables. */
  async assertSchema(): Promise<void> {
    const rows = await this.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${this.schema}
        AND table_name = ANY(${REQUIRED_TABLES as unknown as string[]})
    `;
    const found = new Set(rows.map((row: Record<string, unknown>) => String(row.table_name)));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
      throw new StoreSchemaError(
        `Majedwali yanayokosekana kwenye schema "${this.schema}": ${missing.join(', ')}. ` +
          'Tumia db/migrations/002_ai_core_state.sql kwanza.'
      );
    }
  }

  async saveRun(run: SuiteRun, meta: RunMetadata): Promise<string> {
    const id = runId(run);
    await this.sql`
      INSERT INTO evaluation_runs (
        evaluation_run_id, suite_id, suite_version, provider_id, model_id,
        code_commit, status, score, created_at, completed_at
      ) VALUES (
        ${id}, ${run.suiteId}, ${run.suiteVersion}, ${meta.providerId}, ${meta.modelId},
        ${meta.codeCommit ?? null}, ${run.passed ? 'passed' : 'failed'},
        ${Number((run.passRate * 100).toFixed(2))}, ${run.startedAt}, ${run.completedAt}
      )
      ON CONFLICT (evaluation_run_id) DO NOTHING
    `;

    for (const result of run.results) {
      await this.sql`
        INSERT INTO evaluation_case_results (
          evaluation_run_id, case_id, passed, score, grader_version, reason, latency_ms
        ) VALUES (
          ${id}, ${result.caseId}, ${result.passed}, ${Number((result.score * 100).toFixed(2))},
          ${run.suiteVersion}, ${JSON.stringify(result.outcomes).slice(0, 4000)}, ${result.durationMs}
        )
        ON CONFLICT (evaluation_run_id, case_id) DO UPDATE
          SET passed = EXCLUDED.passed,
              score = EXCLUDED.score,
              reason = EXCLUDED.reason,
              latency_ms = EXCLUDED.latency_ms
      `;
    }

    return id;
  }

  async latestSummary(suiteId: string): Promise<RunSummary | null> {
    const runs = await this.sql`
      SELECT evaluation_run_id, suite_id, suite_version, score
      FROM evaluation_runs
      WHERE suite_id = ${suiteId} AND status IN ('passed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (runs.length === 0) return null;
    const run = runs[0] as { evaluation_run_id: string; suite_id: string; suite_version: string; score: string | number };

    const cases = await this.sql`
      SELECT case_id, passed, score
      FROM evaluation_case_results
      WHERE evaluation_run_id = ${run.evaluation_run_id}
      ORDER BY case_id
    `;

    const passRate = Number(run.score) / 100;
    const mapped = cases.map((row: Record<string, unknown>) => ({
      caseId: String(row.case_id),
      passed: Boolean(row.passed),
      score: Number(row.score) / 100,
    }));

    return {
      suiteId: run.suite_id,
      suiteVersion: run.suite_version,
      passRate,
      weightedScore: mapped.length === 0 ? 0 : mapped.reduce((sum, item) => sum + item.score, 0) / mapped.length,
      cases: mapped,
    };
  }

  async recordGap(gap: GapRecord): Promise<void> {
    await this.sql`
      INSERT INTO learning_gaps (gap_id, topic, context, severity, status, created_at)
      VALUES (
        ${gap.gapId}, ${gap.topic}, ${gap.context}, ${gap.severity},
        ${gap.status ?? 'open'}, ${gap.detectedAt ?? new Date().toISOString()}
      )
      ON CONFLICT (gap_id) DO NOTHING
    `;
  }

  async saveCandidate(lesson: LessonRecord, decision: PromotionDecision): Promise<void> {
    const status = decision.verdict === 'promote' ? 'verified' : decision.verdict === 'reject' ? 'rejected' : 'candidate';
    await this.sql`
      INSERT INTO candidate_lessons (
        lesson_id, topic, summary, content, verification_question, expected_answer,
        source_uri, verification_status
      ) VALUES (
        ${lesson.lessonId}, ${lesson.topic}, ${lesson.summary}, ${lesson.content},
        ${lesson.verificationQuestion}, ${lesson.expectedAnswer},
        ${lesson.sourceUri ?? null}, ${status}
      )
      ON CONFLICT (lesson_id) DO UPDATE
        SET verification_status = EXCLUDED.verification_status
    `;
  }
}
