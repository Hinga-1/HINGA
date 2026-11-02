import { config } from './config.ts';
import { AiModelProvider, JobRunStore, SystemHealthReport } from './types.ts';
import { MockModelProvider } from './providers/mock-provider.ts';
import { GeminiModelProvider } from './providers/gemini-provider.ts';
import { UsageLedger } from './providers/usage.ts';
import { loadCommittedPrices } from './providers/price-feed.ts';
import { IdentityManager } from './identity/identity-manager.ts';
import { InMemoryStore } from './memory/in-memory-store.ts';
import { NeonMemoryStore } from './memory/neon-memory-store.ts';
import { MemoryManager } from './memory/memory-manager.ts';
import { ReasoningEngine } from './reasoning/engine.ts';
import { SafetyGuardrails, RollbackManager } from './safety/guardrails.ts';
import { LearningEngine } from './learning/curriculum.ts';
import { AgentOrchestrator } from './orchestrator/orchestrator.ts';
import { AutomationEngine } from './automation/scheduler.ts';
import { NeonJobRunStore } from './automation/neon-job-run-store.ts';
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
  /** Ledger moja ya attempts ya provider; orchestrator anaitumia kupima kila task. */
  readonly usageLedger: UsageLedger;

  private isNeonConnected: boolean = false;

  private constructor(
    provider: AiModelProvider,
    memoryStore: any,
    isNeon: boolean,
    usageLedger: UsageLedger,
    automationRunStore?: JobRunStore
  ) {
    this.provider = provider;
    this.usageLedger = usageLedger;
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
      this.safety,
      this.usageLedger
    );

    // G. Automation Engine
    this.automation = new AutomationEngine({ runStore: automationRunStore });

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
    // 0. Shared usage ledger: kila attempt ya provider halisi inarekodiwa hapa.
    // Mock provider hawarekodi - attempts za mock si spend halisi.
    const usageLedger = new UsageLedger();
    let provider: AiModelProvider;
    if (options?.forceMockProvider || !config.geminiApiKey) {
      provider = new MockModelProvider();
    } else {
      const gemini = new GeminiModelProvider(config.geminiApiKey, {
        ledger: usageLedger,
        // Bei zilizothibitishwa (repo-committed): bila hizi, kila attempt inabaki bila cost
        // na per-task budget cap haitoziweza kuwaka.
        prices: loadCommittedPrices(),
      });
      const available = await gemini.isAvailable();
      provider = available ? gemini : new MockModelProvider();
    }

    // 2. Select Memory Persistence Store
    let memoryStore: any;
    let isNeon = false;
    let automationRunStore: JobRunStore | undefined;

    if (!options?.forceInMemory && config.databaseUrl) {
      try {
        const neonStore = new NeonMemoryStore(config.databaseUrl, config.databaseUrlUnpooled);
        await neonStore.initializeSchema();
        memoryStore = neonStore;
        isNeon = true;
        automationRunStore = new NeonJobRunStore(config.databaseUrl);
      } catch (err) {
        console.warn('⚠️ Imeshindikana kuunganisha Neon kwa sasa, inatumia In-Memory store kama njia mbadala:', err);
        memoryStore = new InMemoryStore();
      }
    } else {
      memoryStore = new InMemoryStore();
    }

    const system = new AiCoreSystem(provider, memoryStore, isNeon, usageLedger, automationRunStore);
    if (isNeon) {
      const reconciledRuns = await system.automation.reconcileInterruptedRuns();
      if (reconciledRuns > 0) {
        system.observability.warn('automation', 'Runs zilizoachwa running zimeshughulikiwa baada ya worker kuanza', {
          reconciledRuns,
        });
      }
    }
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
