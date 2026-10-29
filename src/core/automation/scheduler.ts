import { ScheduledJob } from '../types.ts';

export class AutomationEngine {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  registerJob(
    id: string,
    name: string,
    intervalMs: number,
    task: () => Promise<void>,
    maxRetries: number = 3
  ): ScheduledJob {
    const job: ScheduledJob = {
      id,
      name,
      intervalMs,
      enabled: true,
      maxRetries,
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
      task,
    };
    this.jobs.set(id, job);
    return job;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const [id, job] of this.jobs.entries()) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
  }

  private scheduleJob(job: ScheduledJob): void {
    if (!this.isRunning || !job.enabled) return;

    const timer = setTimeout(async () => {
      try {
        job.lastRun = new Date().toISOString();
        await job.task();
      } catch (err) {
        console.error(`⚠️ Hitilafu katika kazi ya automation "${job.name}":`, err);
      } finally {
        job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
        if (this.isRunning && job.enabled) {
          this.scheduleJob(job);
        }
      }
    }, job.intervalMs);

    this.timers.set(job.id, timer);
  }

  stop(): void {
    this.isRunning = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  async runJobNow(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.lastRun = new Date().toISOString();
    await job.task();
    return true;
  }
}
