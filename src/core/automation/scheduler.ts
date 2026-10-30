import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JobRunRecord, JobRunStore, ScheduledJob } from '../types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class InMemoryJobRunStore implements JobRunStore {
  protected records = new Map<string, JobRunRecord>();

  async findByIdempotencyKey(key: string): Promise<JobRunRecord | null> {
    return Array.from(this.records.values()).find((record) => record.idempotencyKey === key) ?? null;
  }

  async save(record: JobRunRecord): Promise<void> {
    this.records.set(record.runId, { ...record });
  }

  async listRunning(): Promise<JobRunRecord[]> {
    return Array.from(this.records.values()).filter((record) => record.status === 'running');
  }
}

/** Small local persistence adapter for development/restart tests; use a database adapter in production. */
export class FileJobRunStore extends InMemoryJobRunStore {
  private loaded = false;

  constructor(private readonly filePath: string) {
    super();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const records = JSON.parse(content) as JobRunRecord[];
      for (const record of records) this.records.set(record.runId, record);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(Array.from(this.records.values()), null, 2), 'utf8');
    await fs.rename(temporaryPath, this.filePath);
  }

  override async findByIdempotencyKey(key: string): Promise<JobRunRecord | null> {
    await this.ensureLoaded();
    return super.findByIdempotencyKey(key);
  }

  override async save(record: JobRunRecord): Promise<void> {
    await this.ensureLoaded();
    await super.save(record);
    await this.flush();
  }

  override async listRunning(): Promise<JobRunRecord[]> {
    await this.ensureLoaded();
    return super.listRunning();
  }
}

export interface AutomationOptions {
  runStore?: JobRunStore;
  executionTimeoutMs?: number;
  retryBackoffMs?: number;
}

export type RetryClassifier = (error: unknown) => boolean;

const retryAllErrors: RetryClassifier = () => true;

export class AutomationEngine {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private controllers: Map<string, AbortController> = new Map();
  private activeJobs = new Set<string>();
  private isRunning = false;
  private readonly runStore: JobRunStore;
  private readonly executionTimeoutMs: number;
  private readonly retryBackoffMs: number;

  constructor(options: AutomationOptions = {}) {
    this.runStore = options.runStore ?? new InMemoryJobRunStore();
    this.executionTimeoutMs = Math.max(1, options.executionTimeoutMs ?? 30_000);
    this.retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 25);
  }

  registerJob(
    id: string,
    name: string,
    intervalMs: number,
    task: (signal?: AbortSignal) => Promise<void>,
    maxRetries = 3,
    retryOnError: RetryClassifier = retryAllErrors,
  ): ScheduledJob {
    if (!id.trim() || intervalMs < 1 || maxRetries < 0) throw new Error('Job configuration isiyo sahihi');
    const job: ScheduledJob = {
      id, name, intervalMs, enabled: true, maxRetries, retryOnError,
      nextRun: new Date(Date.now() + intervalMs).toISOString(), task,
    };
    this.jobs.set(id, job);
    return job;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    for (const job of this.jobs.values()) if (job.enabled) this.scheduleJob(job);
  }

  private scheduleJob(job: ScheduledJob): void {
    if (!this.isRunning || !job.enabled) return;
    const timer = setTimeout(() => {
      void this.runJobNow(job.id, `schedule:${job.id}:${job.nextRun}`).catch(() => undefined).finally(() => {
        job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
        if (this.isRunning && job.enabled) this.scheduleJob(job);
      });
    }, job.intervalMs);
    this.timers.set(job.id, timer);
  }

  stop(): void {
    this.isRunning = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const controller of this.controllers.values()) controller.abort();
    this.timers.clear();
    this.controllers.clear();
  }

  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Marks runs left in `running` state by a previous worker as failed.
   * Reconciliation is explicit and side-effect free: callers can decide whether
   * to resubmit a job with a new idempotency key after inspecting the records.
   */
  async reconcileInterruptedRuns(): Promise<number> {
    const interrupted = await this.runStore.listRunning();
    const completedAt = new Date().toISOString();
    for (const run of interrupted) {
      await this.runStore.save({
        ...run,
        status: 'failed',
        completedAt,
        error: 'worker_restarted',
      });
    }
    return interrupted.length;
  }

  async runJobNow(id: string, idempotencyKey = `manual:${id}:${Date.now()}`): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || !job.enabled || this.activeJobs.has(id)) return false;
    this.activeJobs.add(id);
    try {
      const existing = await this.runStore.findByIdempotencyKey(idempotencyKey);
      if (existing?.status === 'succeeded') return true;

      const run: JobRunRecord = existing ?? {
        runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        jobId: id,
        idempotencyKey,
        status: 'pending',
        attempt: 0,
        maxAttempts: job.maxRetries + 1,
        createdAt: new Date().toISOString(),
      };
      for (let attempt = run.attempt + 1; attempt <= run.maxAttempts; attempt++) {
        run.attempt = attempt;
        run.status = 'running';
        run.startedAt = new Date().toISOString();
        await this.runStore.save(run);
        const controller = new AbortController();
        this.controllers.set(id, controller);
        const timeout = setTimeout(() => controller.abort(), this.executionTimeoutMs);
        try {
          await Promise.race([
            job.task(controller.signal),
            new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('job_timeout')), { once: true })),
          ]);
          run.status = 'succeeded';
          run.completedAt = new Date().toISOString();
          await this.runStore.save(run);
          job.lastRun = run.completedAt;
          return true;
        } catch (error: unknown) {
          const timedOut = error instanceof Error && error.message === 'job_timeout';
          run.status = timedOut ? 'timed_out' : 'failed';
          run.error = error instanceof Error ? error.message : 'unknown_job_error';
          await this.runStore.save(run);
          if (attempt < run.maxAttempts && job.retryOnError(error)) {
            await sleep(this.retryBackoffMs * 2 ** (attempt - 1));
          } else {
            break;
          }
        } finally {
          clearTimeout(timeout);
          this.controllers.delete(id);
        }
      }
      run.completedAt = new Date().toISOString();
      await this.runStore.save(run);
      job.lastRun = run.completedAt;
      return false;
    } finally {
      this.activeJobs.delete(id);
    }
  }
}
