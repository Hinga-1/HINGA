import { AgentRole, AgentTask, AiModelProvider } from '../types.ts';
import { IdentityManager } from '../identity/identity-manager.ts';
import { ReasoningEngine } from '../reasoning/engine.ts';
import { MemoryManager } from '../memory/memory-manager.ts';
import { SafetyGuardrails } from '../safety/guardrails.ts';

export class AgentOrchestrator {
  private provider: AiModelProvider;
  private identity: IdentityManager;
  private reasoning: ReasoningEngine;
  private memory: MemoryManager;
  private safety: SafetyGuardrails;
  private tasks: Map<string, AgentTask> = new Map();

  constructor(
    provider: AiModelProvider,
    identity: IdentityManager,
    reasoning: ReasoningEngine,
    memory: MemoryManager,
    safety: SafetyGuardrails
  ) {
    this.provider = provider;
    this.identity = identity;
    this.reasoning = reasoning;
    this.memory = memory;
    this.safety = safety;
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
  async executeTask(description: string, assignedRole?: AgentRole): Promise<AgentTask> {
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

    try {
      // 2. Perform step-by-step reasoning
      const reasoningResult = await this.reasoning.reason(description);

      // 3. Critic Pass: If role wasn't already critic, perform verification
      let finalResult = reasoningResult.conclusion;
      if (role !== 'critic') {
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

      return task;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.error = msg;
      task.completedAt = new Date().toISOString();
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
