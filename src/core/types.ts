/**
 * AI Core System Types & Domain Interfaces (Mission 001)
 * Hexagonal architecture domain definitions.
 */

export type ModelTier = 'fast' | 'balanced' | 'deep';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
  latencyMs?: number;
  fallback?: {
    used: boolean;
    providerId?: string;
    reason?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ModelRequest {
  systemPrompt?: string;
  prompt: string;
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export interface AiModelProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateText(request: ModelRequest): Promise<ModelResponse>;
}

// ----------------------------------------------------
// A. Identity & Personality Types
// ----------------------------------------------------
export interface PersonalityTrait {
  name: string;
  weight: number; // 0.0 to 1.0
  description: string;
}

export interface EthicalRule {
  id: string;
  rule: string;
  criticality: 'mandatory' | 'high' | 'medium';
}

export interface AgentIdentity {
  name: string;
  role: string;
  version: string;
  traits: PersonalityTrait[];
  ethicalRules: EthicalRule[];
  systemGuidelines: string[];
}

// ----------------------------------------------------
// B. Reasoning Types
// ----------------------------------------------------
export interface ReasoningStep {
  stepNumber: number;
  thought: string;
  action: string;
  evidence?: string;
  confidence: number; // 0.0 to 1.0
}

export interface ReasoningResult {
  problemSummary: string;
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  gapsIdentified?: string[];
  executionTimeMs: number;
}

// ----------------------------------------------------
// C. Memory Types
// ----------------------------------------------------
export type MemoryType = 'working' | 'episodic' | 'semantic';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  content: string;
  importance: number; // 1 to 10
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchFilter {
  type?: MemoryType;
  tags?: string[];
  query?: string;
  limit?: number;
}

export interface MemoryStore {
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>;
  retrieve(id: string): Promise<MemoryEntry | null>;
  search(filter: MemorySearchFilter): Promise<MemoryEntry[]>;
  delete(id: string): Promise<boolean>;
  clear(type?: MemoryType): Promise<void>;
}

// ----------------------------------------------------
// D. Orchestrator & Multi-Agent Types
// ----------------------------------------------------
export type AgentRole = 'generalist' | 'analyst' | 'researcher' | 'critic';

export interface AgentTask {
  id: string;
  description: string;
  assignedRole: AgentRole;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  reasoning?: ReasoningResult;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ----------------------------------------------------
// E. Learning & Knowledge Gap Types
// ----------------------------------------------------
export interface KnowledgeGap {
  id: string;
  topic: string;
  context: string;
  severity: 'low' | 'medium' | 'high';
  detectedAt: string;
  resolved: boolean;
  resolutionNotes?: string;
}

export interface Lesson {
  id: string;
  topic: string;
  summary: string;
  content: string;
  verificationQuestion: string;
  expectedAnswer: string;
}

export interface EvaluationBenchmark {
  id: string;
  title: string;
  testPrompt: string;
  evaluationCriteria: string[];
  /** Each criterion is satisfied only when at least one approved phrase matches. */
  criterionPhrases?: string[][];
  minScore: number;
}

export interface EvaluationResult {
  benchmarkId: string;
  score: number; // 0 to 100
  passed: boolean;
  observations: string[];
  evaluatedAt: string;
}

// ----------------------------------------------------
// F. Safety & Rollback Types
// ----------------------------------------------------
export interface SafetyCheckResult {
  allowed: boolean;
  sanitizedInput?: string;
  reason?: string;
  violations?: string[];
}

export interface SystemSnapshot {
  id: string;
  version: string;
  timestamp: string;
  description: string;
  identityState: AgentIdentity;
  configState: Record<string, unknown>;
  metrics: {
    totalMemories: number;
    gapsCount: number;
    tasksCompleted: number;
  };
}

// ----------------------------------------------------
// G. Automation Types
// ----------------------------------------------------
export interface ScheduledJob {
  id: string;
  name: string;
  intervalMs: number;
  lastRun?: string;
  nextRun: string;
  enabled: boolean;
  maxRetries: number;
  retryOnError: (error: unknown) => boolean;
  task: (signal?: AbortSignal) => Promise<void>;
}

export type JobRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'timed_out';

export interface JobRunRecord {
  runId: string;
  jobId: string;
  idempotencyKey: string;
  status: JobRunStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface JobRunStore {
  findByIdempotencyKey(key: string): Promise<JobRunRecord | null>;
  save(record: JobRunRecord): Promise<void>;
  listRunning(): Promise<JobRunRecord[]>;
}

// ----------------------------------------------------
// H. Observability Types
// ----------------------------------------------------
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditLog {
  timestamp: string;
  level: LogLevel;
  subsystem: string;
  action: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
}

export interface SystemHealthReport {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  subsystems: {
    identity: { status: 'ok' | 'error'; version: string };
    reasoning: { status: 'ok' | 'error' };
    memory: { status: 'ok' | 'error'; provider: string; totalEntries: number };
    orchestrator: { status: 'ok' | 'error'; activeAgents: number };
    learning: { status: 'ok' | 'error'; openGaps: number };
    safety: { status: 'ok' | 'error'; guardrailsActive: boolean };
    automation: { status: 'ok' | 'error'; jobsRegistered: number };
    observability: { status: 'ok' | 'error'; logsCount: number };
  };
}
