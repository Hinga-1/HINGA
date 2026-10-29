import { AuditLog, LogLevel, SystemHealthReport } from '../types.ts';
import { IdentityManager } from '../identity/identity-manager.ts';
import { MemoryManager } from '../memory/memory-manager.ts';
import { AgentOrchestrator } from '../orchestrator/orchestrator.ts';
import { LearningEngine } from '../learning/curriculum.ts';
import { AutomationEngine } from '../automation/scheduler.ts';

export class ObservabilityEngine {
  private logs: AuditLog[] = [];
  private maxLogs: number = 200;

  log(level: LogLevel, subsystem: string, action: string, details?: Record<string, unknown>, latencyMs?: number): void {
    const entry: AuditLog = {
      timestamp: new Date().toISOString(),
      level,
      subsystem,
      action,
      details,
      latencyMs,
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  info(subsystem: string, action: string, details?: Record<string, unknown>, latencyMs?: number): void {
    this.log('info', subsystem, action, details, latencyMs);
  }

  warn(subsystem: string, action: string, details?: Record<string, unknown>): void {
    this.log('warn', subsystem, action, details);
  }

  error(subsystem: string, action: string, details?: Record<string, unknown>): void {
    this.log('error', subsystem, action, details);
  }

  getLogs(limit: number = 50): AuditLog[] {
    return this.logs.slice(0, limit);
  }

  async generateHealthReport(
    identity: IdentityManager,
    memory: MemoryManager,
    orchestrator: AgentOrchestrator,
    learning: LearningEngine,
    automation: AutomationEngine
  ): Promise<SystemHealthReport> {
    const memStats = await memory.getStoreStats();
    const id = identity.getIdentity();
    const openGaps = learning.getOpenGaps().length;
    const tasksCount = orchestrator.getTasks().length;
    const jobsCount = automation.getJobs().length;

    return {
      overallStatus: 'healthy',
      timestamp: new Date().toISOString(),
      subsystems: {
        identity: { status: 'ok', version: id.version },
        reasoning: { status: 'ok' },
        memory: { status: 'ok', provider: memStats.type, totalEntries: memStats.total },
        orchestrator: { status: 'ok', activeAgents: tasksCount },
        learning: { status: 'ok', openGaps },
        safety: { status: 'ok', guardrailsActive: true },
        automation: { status: 'ok', jobsRegistered: jobsCount },
        observability: { status: 'ok', logsCount: this.logs.length },
      },
    };
  }
}
