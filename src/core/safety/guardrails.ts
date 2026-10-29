import { AgentIdentity, SafetyCheckResult, SystemSnapshot } from '../types.ts';
import { IdentityManager } from '../identity/identity-manager.ts';
import { MemoryManager } from '../memory/memory-manager.ts';

export class SafetyGuardrails {
  private static SENSITIVE_PATTERNS = [
    /napi_[a-zA-Z0-9_-]{20,}/i, // Neon API keys
    /AIzaSy[a-zA-Z0-9_-]{33}/i,  // Google API keys
    /postgres(ql)?:\/\/[^:]+:[^@]+@[^\/]+/i, // Raw database connection string with password
    /sk-[a-zA-Z0-9]{32,}/i,      // OpenAI style keys
    /ghp_[a-zA-Z0-9]{36}/i,      // GitHub tokens
  ];

  private static DANGEROUS_COMMANDS = [
    /rm\s+-rf\s+\//i,
    /drop\s+database/i,
    /drop\s+table\s+users/i,
    /truncate\s+table/i,
  ];

  /**
   * Sanitizes text to remove any accidental credential leakage before logging or returning.
   */
  sanitizeOutput(text: string): string {
    let sanitized = text;
    for (const pattern of SafetyGuardrails.SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
    }
    return sanitized;
  }

  /**
   * Validates if a user prompt or agent action is safe to execute.
   */
  validateInput(input: string): SafetyCheckResult {
    const violations: string[] = [];

    for (const pattern of SafetyGuardrails.DANGEROUS_COMMANDS) {
      if (pattern.test(input)) {
        violations.push(`Amri hatari ya mfumo imegunduliwa: ${pattern.source}`);
      }
    }

    if (violations.length > 0) {
      return {
        allowed: false,
        violations,
        reason: 'Ombi limesitishwa kwa sababu linakiuka miongozo ya usalama.',
      };
    }

    return {
      allowed: true,
      sanitizedInput: this.sanitizeOutput(input),
    };
  }
}

export class RollbackManager {
  private snapshots: SystemSnapshot[] = [];
  private identityManager: IdentityManager;
  private memoryManager: MemoryManager;

  constructor(identityManager: IdentityManager, memoryManager: MemoryManager) {
    this.identityManager = identityManager;
    this.memoryManager = memoryManager;
  }

  /**
   * Takes an atomic snapshot of current system state before major modifications.
   */
  async createSnapshot(description: string): Promise<SystemSnapshot> {
    const id = `snap_${Date.now()}`;
    const stats = await this.memoryManager.getStoreStats();
    const identity = this.identityManager.getIdentity();

    const snapshot: SystemSnapshot = {
      id,
      version: identity.version,
      timestamp: new Date().toISOString(),
      description,
      identityState: identity,
      configState: {
        nodeEnv: process.env.NODE_ENV,
        neonBranch: process.env.NEON_BRANCH,
      },
      metrics: {
        totalMemories: stats.total,
        gapsCount: 0,
        tasksCompleted: 0,
      },
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  getSnapshots(): SystemSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Rolls back the system to a previous snapshot state.
   */
  async rollbackToSnapshot(snapshotId: string): Promise<boolean> {
    const target = this.snapshots.find((s) => s.id === snapshotId);
    if (!target) {
      return false;
    }

    // Restore identity and guidelines
    this.identityManager.updateVersion(
      `${target.version}-restored`,
      `Imerudishwa kwenye snapshot ${snapshotId} (${target.description})`
    );

    return true;
  }
}
