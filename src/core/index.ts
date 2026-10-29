import { config } from './config.ts';
import { AiModelProvider, SystemHealthReport } from './types.ts';
import { MockModelProvider } from './providers/mock-provider.ts';
import { GeminiModelProvider } from './providers/gemini-provider.ts';
import { IdentityManager } from './identity/identity-manager.ts';
import { InMemoryStore } from './memory/in-memory-store.ts';
import { NeonMemoryStore } from './memory/neon-memory-store.ts';
import { MemoryManager } from './memory/memory-manager.ts';
import { ReasoningEngine } from './reasoning/engine.ts';
import { SafetyGuardrails, RollbackManager } from './safety/guardrails.ts';
import { LearningEngine } from './learning/curriculum.ts';
import { AgentOrchestrator } from './orchestrator/orchestrator.ts';
import { AutomationEngine } from './automation/scheduler.ts';
import { ObservabilityEngine } from './observability/logger.ts';

export class AiCoreSystem {
  readonly identity: IdentityManager;
  readonly memory: MemoryManager;
  readonly reasoning: ReasoningEngine;
  readonly safety: SafetyGuardrails;
  readonly rollback: RollbackManager;
  readonly learning: LearningEngine;
  readonly orchestrator: AgentOrchestrator;
  readonly automation: AutomationEngine;
  readonly observability: ObservabilityEngine;
  readonly provider: AiModelProvider;

  private isNeonConnected: boolean = false;

  private constructor(
    provider: AiModelProvider,
    memoryStore: any,
    isNeon: boolean
  ) {
    this.provider = provider;
    this.isNeonConnected = isNeon;

    // A. Identity & Personality
    this.identity = new IdentityManager();

    // C. Memory System
    this.memory = new MemoryManager(memoryStore);

    // B. Reasoning Engine
    this.reasoning = new ReasoningEngine(this.provider, this.memory, this.identity);

    // F. Evaluation & Safety
    this.safety = new SafetyGuardrails();
    this.rollback = new RollbackManager(this.identity, this.memory);

    // E. Learning Engine
    this.learning = new LearningEngine(this.memory, this.provider);

    // D. Agent Orchestrator
    this.orchestrator = new AgentOrchestrator(
      this.provider,
      this.identity,
      this.reasoning,
      this.memory,
      this.safety
    );

    // G. Automation Engine
    this.automation = new AutomationEngine();

    // H. Observability & Recovery
    this.observability = new ObservabilityEngine();

    // Register basic background automation jobs
    this.automation.registerJob(
      'auto_memory_heartbeat',
      'Ukaguzi wa Kumbukumbu za AI',
      60000, // kila dakika 1
      async () => {
        this.observability.info('automation', 'Kazi ya ukaguzi wa kumbukumbu imeendeshwa');
      }
    );
  }

  /**
   * Initializes the AI Core System.
   * Prefers Neon PostgreSQL if configured and available; falls back smoothly to InMemoryStore.
   */
  static async initialize(options?: { forceMockProvider?: boolean; forceInMemory?: boolean }): Promise<AiCoreSystem> {
    // 1. Select Model Provider
    let provider: AiModelProvider;
    if (options?.forceMockProvider || !config.geminiApiKey) {
      provider = new MockModelProvider();
    } else {
      const gemini = new GeminiModelProvider(config.geminiApiKey);
      const available = await gemini.isAvailable();
      provider = available ? gemini : new MockModelProvider();
    }

    // 2. Select Memory Persistence Store
    let memoryStore: any;
    let isNeon = false;

    if (!options?.forceInMemory && config.databaseUrl) {
      try {
        const neonStore = new NeonMemoryStore(config.databaseUrl, config.databaseUrlUnpooled);
        await neonStore.initializeSchema();
        memoryStore = neonStore;
        isNeon = true;
      } catch (err) {
        console.warn('⚠️ Imeshindikana kuunganisha Neon kwa sasa, inatumia In-Memory store kama njia mbadala:', err);
        memoryStore = new InMemoryStore();
      }
    } else {
      memoryStore = new InMemoryStore();
    }

    const system = new AiCoreSystem(provider, memoryStore, isNeon);
    if (!isNeon && !options?.forceInMemory) {
      system.observability.markDegraded('Neon persistence haikupatikana; in-memory fallback inatumika');
    }
    system.observability.info('system', 'AiCoreSystem imezinduliwa rasmi', {
      provider: provider.name,
      isNeonConnected: isNeon,
    });

    return system;
  }

  get isPersistentNeon(): boolean {
    return this.isNeonConnected;
  }

  async getHealthReport(): Promise<SystemHealthReport> {
    return this.observability.generateHealthReport(
      this.identity,
      this.memory,
      this.orchestrator,
      this.learning,
      this.automation
    );
  }
}

export * from './types.ts';
