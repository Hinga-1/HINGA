import { neon } from '@neondatabase/serverless';
import { JobRunRecord, JobRunStore } from '../types.ts';

/** Persistence adapter for migrated ai_job_runs; schema changes belong in db:migrate. */
export class NeonJobRunStore implements JobRunStore {
  private readonly sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for NeonJobRunStore');
    this.sql = neon(databaseUrl);
  }

  async findByIdempotencyKey(key: string): Promise<JobRunRecord | null> {
    const rows = await this.sql`
      SELECT run_id, job_id, idempotency_key, status, attempt, max_attempts,
             created_at, started_at, completed_at, error_code
      FROM ai_job_runs
      WHERE idempotency_key = ${key}
      LIMIT 1;
    `;
    return rows.length === 0 ? null : this.toRecord(rows[0]);
  }

  async save(record: JobRunRecord): Promise<void> {
    await this.sql`
      INSERT INTO ai_job_runs
        (run_id, job_id, idempotency_key, status, attempt, max_attempts, created_at, started_at, completed_at, error_code)
      VALUES
        (${record.runId}, ${record.jobId}, ${record.idempotencyKey}, ${record.status}, ${record.attempt}, ${record.maxAttempts},
         ${record.createdAt}, ${record.startedAt ?? null}, ${record.completedAt ?? null}, ${record.error ?? null})
      ON CONFLICT (run_id) DO UPDATE SET
        status = EXCLUDED.status,
        attempt = EXCLUDED.attempt,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        error_code = EXCLUDED.error_code;
    `;
  }

  async listRunning(): Promise<JobRunRecord[]> {
    const rows = await this.sql`
      SELECT run_id, job_id, idempotency_key, status, attempt, max_attempts,
             created_at, started_at, completed_at, error_code
      FROM ai_job_runs
      WHERE status = 'running'
      ORDER BY created_at ASC;
    `;
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: Record<string, unknown>): JobRunRecord {
    return {
      runId: String(row.run_id),
      jobId: String(row.job_id),
      idempotencyKey: String(row.idempotency_key),
      status: row.status as JobRunRecord['status'],
      attempt: Number(row.attempt),
      maxAttempts: Number(row.max_attempts),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
      error: row.error_code ? String(row.error_code) : undefined,
    };
  }
}
