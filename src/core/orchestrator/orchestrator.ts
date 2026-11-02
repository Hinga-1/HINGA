import { AgentRole, AgentTask, AiModelProvider } from '../types.ts';
import { IdentityManager } from '../identity/identity-manager.ts';
import { ReasoningEngine } from '../reasoning/engine.ts';
import { MemoryManager } from '../memory/memory-manager.ts';
import { SafetyGuardrails } from '../safety/guardrails.ts';
import { TaskUsage } from '../types.ts';
import { UsageLedger } from '../providers/usage.ts';

export class AgentOrchestrator {
  private provider: AiModelProvider;
  private identity: IdentityManager;
  private reasoning: ReasoningEngine;
  private memory: MemoryManager;
  private safety: SafetyGuardrails;
  private tasks: Map<string, AgentTask> = new Map();
  private usageLedger: UsageLedger | null;

  constructor(
    provider: AiModelProvider,
    identity: IdentityManager,
    reasoning: ReasoningEngine,
    memory: MemoryManager,
    safety: SafetyGuardrails,
    usageLedger?: UsageLedger
  ) {
    this.provider = provider;
    this.identity = identity;
    this.reasoning = reasoning;
    this.memory = memory;
    this.safety = safety;
    this.usageLedger = usageLedger ?? null;
  }

  /**
   * Hesabu za attempts zilizotokea wakati wa task hii pekee. Ledger ni append-only,
   * hivyo kuanzia index iliyopita hadi mwisho ni delta halisi ya task. Hakuna
   * kubuni: attempt zisizo na bei hazichangia `costUsd`, na bila ledger hakuna usage.
   */
  private collectUsage(
    beforeIndex: number,
    budget?: { budgetUsd: number; budgetExceeded: boolean }
  ): TaskUsage | undefined {
    if (!this.usageLedger) return undefined;
    const attempts = this.usageLedger.getAttempts().slice(beforeIndex);
    if (attempts.length === 0) return undefined;
    const usage: TaskUsage = {
      attemptCount: attempts.length,
      totalTokens: attempts.reduce((total, attempt) => total + (attempt.usage?.totalTokens ?? 0), 0),
    };
    if (attempts.some((attempt) => attempt.estimatedCostUsd !== undefined)) {
      usage.costUsd = Number(attempts.reduce((total, attempt) => total + (attempt.estimatedCostUsd ?? 0), 0).toFixed(8));
    }
    if (budget) {
      usage.budgetUsd = budget.budgetUsd;
      if (budget.budgetExceeded) usage.budgetExceeded = true;
    }
    return usage;
  }

  /**
   * Spend halisi (USD) ya attempts tangu `beforeIndex`. Attempt zisizo na bei
   * hazichangi: spend haijabuniwi. Inatumika tu kupima dhidi ya bajeti ya task.
   */
  private spendSince(beforeIndex: number): number {
    if (!this.usageLedger) return 0;
    return this.usageLedger
      .getAttempts()
      .slice(beforeIndex)
      .reduce((total, attempt) => total + (attempt.estimatedCostUsd ?? 0), 0);
  }

  /**
   * Routes a task to the most appropriate agent role based on complexity and keywords.
   */
  classifyRole(description: string): AgentRole {
    const desc = description.toLowerCase();
    if (desc.includes('kagua') || desc.includes('ukosoaji') || desc.includes('critic') || desc.includes('kosa')) {
      return 'critic';
    }
    if (desc.includes('tafiti') || desc.includes('utafiti') || desc.includes('research') || desc.includes('ushahidi')) {
      return 'researcher';
    }
    if (desc.includes('chambua') || desc.includes('hesabu') || desc.includes('reason') || desc.includes('hatua')) {
      return 'analyst';
    }
    return 'generalist';
  }

  /**
   * Executes a task through the orchestrated multi-agent reasoning flow.
   */
  async executeTask(
    description: string,
    assignedRole?: AgentRole,
    options?: { budgetUsd?: number }
  ): Promise<AgentTask> {
    const role = assignedRole || this.classifyRole(description);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. Safety check
    const safetyCheck = this.safety.validateInput(description);
    if (!safetyCheck.allowed) {
      const failedTask: AgentTask = {
        id: taskId,
        description,
        assignedRole: role,
        priority: 'normal',
        status: 'failed',
        error: safetyCheck.reason,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      this.tasks.set(taskId, failedTask);
      return failedTask;
    }

    const task: AgentTask = {
      id: taskId,
      description,
      assignedRole: role,
      priority: 'normal',
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);

    // Delta ya attempts za task hii; lazima ionekane pia kwenye catch, kwa hivyo
    // inatangaza kabla ya try.
    let usageBefore = 0;
    // Bajeti ya task (hiari). Kutekelezwa kunahitaji ledger: bila ledger hakuna
    // kipimo halisi cha spend, hivyo hakuna kukata kwa kukisia. Vigezo viko
    // nje ya try ili catch nayo isome context ile ile.
    const budgetUsd = options?.budgetUsd;
    const budgetMeasured = budgetUsd !== undefined && this.usageLedger !== null;
    let budgetExceeded = false;
    try {
      if (this.usageLedger) usageBefore = this.usageLedger.getAttempts().length;

      // 2. Perform step-by-step reasoning
      const reasoningResult = await this.reasoning.reason(description);

      // 3. Critic Pass (ya hiari): inaanza tu kama bajeti ya task bado
      // haijafikiwa. Spend huangaliwa tena baada ya reasoning, kwa sababu
      // attempts za reasoning ndizo gharama kubwa ya task.
      if (budgetMeasured) {
        budgetExceeded = this.spendSince(usageBefore) >= budgetUsd!;
      }
      let finalResult = reasoningResult.conclusion;
      if (budgetExceeded) {
        finalResult = `${finalResult}\n\n[Critic pass haikufanyika: bajeti ya $${budgetUsd} ya task hii imeshafikiwa.]`;
      } else if (role !== 'critic') {
        const criticPrompt = `Kama Mhakiki Mkuu (Senior Critic), kagua hitimisho lifuatalo na uthibitishe kama ni salama na sahihi:
"${finalResult}"
Toa uthibitisho wa sentensi 1-2.`;

        const criticResponse = await this.provider.generateText({
          systemPrompt: this.identity.buildSystemPrompt('Mhakiki wa Kiufundi (Technical Critic)'),
          prompt: criticPrompt,
          tier: 'fast',
        });
        finalResult = `${finalResult}\n\n[Uhakiki wa Critic]: ${criticResponse.content}`;
      }

      // 4. Sanitize output against credential leaks
      finalResult = this.safety.sanitizeOutput(finalResult);

      task.status = 'completed';
      task.reasoning = reasoningResult;
      task.result = finalResult;
      task.completedAt = new Date().toISOString();
      task.usage = this.collectUsage(
        usageBefore,
        budgetMeasured ? { budgetUsd: budgetUsd!, budgetExceeded } : undefined
      );

      return task;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.error = msg;
      task.completedAt = new Date().toISOString();
      // Provider anaweza kuwa amerekodi attempt iliyoanguka kabla ya kosa; hiyo ni
      // taarifa ya "nini kilichofeli", hivyo inafaa kuonekana kwenye task.
      task.usage = this.collectUsage(
        usageBefore,
        budgetMeasured ? { budgetUsd: budgetUsd!, budgetExceeded } : undefined
      );
      return task;
    }
  }

  getTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): AgentTask | null {
    return this.tasks.get(id) || null;
  }
}
