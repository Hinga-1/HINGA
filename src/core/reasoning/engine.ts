import { AiModelProvider, ReasoningResult, ReasoningStep } from '../types.ts';
import { MemoryManager } from '../memory/memory-manager.ts';
import { IdentityManager } from '../identity/identity-manager.ts';

const MAX_REASONING_STEPS = 12;

export class ModelOutputValidationError extends Error {
  constructor(message: string) {
    super(`Model reasoning output haikubaliki: ${message}`);
    this.name = 'ModelOutputValidationError';
  }
}

function isFiniteConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelOutputValidationError(`${field} lazima iwe maandishi yasiyo tupu`);
  }
  return value.trim();
}

function parseReasoningResponse(content: string, problem: string): ReasoningResult {
  let parsed: unknown;
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ModelOutputValidationError('jibu si JSON halali');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ModelOutputValidationError('jibu lazima liwe object');
  }

  const value = parsed as Record<string, unknown>;
  const problemSummary = requireText(value.problemSummary, 'problemSummary');
  const conclusion = requireText(value.conclusion, 'conclusion');
  if (!isFiniteConfidence(value.confidence)) {
    throw new ModelOutputValidationError('confidence lazima iwe namba kati ya 0 na 1');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_REASONING_STEPS) {
    throw new ModelOutputValidationError(`steps lazima ziwe kati ya 1 na ${MAX_REASONING_STEPS}`);
  }

  const steps: ReasoningStep[] = value.steps.map((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object') {
      throw new ModelOutputValidationError(`step ${index + 1} si object`);
    }
    const step = rawStep as Record<string, unknown>;
    if (!Number.isInteger(step.stepNumber) || (step.stepNumber as number) < 1) {
      throw new ModelOutputValidationError(`step ${index + 1} ina stepNumber isiyo sahihi`);
    }
    if (!isFiniteConfidence(step.confidence)) {
      throw new ModelOutputValidationError(`step ${index + 1} ina confidence isiyo sahihi`);
    }
    const evidence = step.evidence === undefined ? undefined : requireText(step.evidence, `step ${index + 1}.evidence`);
    return {
      stepNumber: step.stepNumber as number,
      thought: requireText(step.thought, `step ${index + 1}.thought`),
      action: requireText(step.action, `step ${index + 1}.action`),
      evidence,
      confidence: step.confidence,
    };
  });

  const gapsIdentified = value.gapsIdentified === undefined ? [] : value.gapsIdentified;
  if (!Array.isArray(gapsIdentified) || !gapsIdentified.every((gap) => typeof gap === 'string')) {
    throw new ModelOutputValidationError('gapsIdentified lazima iwe orodha ya maandishi');
  }

  return {
    problemSummary,
    steps,
    conclusion,
    confidence: value.confidence,
    gapsIdentified,
    executionTimeMs: 0,
  };
}

export class ReasoningEngine {
  private provider: AiModelProvider;
  private memory: MemoryManager;
  private identity: IdentityManager;

  constructor(provider: AiModelProvider, memory: MemoryManager, identity: IdentityManager) {
    this.provider = provider;
    this.memory = memory;
    this.identity = identity;
  }

  /**
   * Decomposes a complex problem and accepts only bounded, validated model output.
   */
  async reason(problem: string): Promise<ReasoningResult> {
    const normalizedProblem = requireText(problem, 'problem');
    const startTime = Date.now();

    const relevantKnowledge = await this.memory.findRelevantKnowledge(normalizedProblem, 3);
    const knowledgeContext = relevantKnowledge.map((k) => `[Maarifa: ${k.key}]: ${k.content}`).join('\n');
    const systemPrompt = this.identity.buildSystemPrompt('Mchambuzi wa Kiufundi na Mfikiri wa Hatua kwa Hatua');
    const prompt = `TATIZO LA KUCHAMBUA:\n${normalizedProblem}\n\nMAARIFA YALIYOHIFADHIWA YANAYOHUSU TATIZO:\n${knowledgeContext || 'Hakuna maarifa maalum yaliyohifadhiwa awali kuhusu mada hii.'}\n\nMAELEKEZO YA KITAALAMU:\nChambua tatizo hili kwa kina na utoe JSON halali tu. Usifichue chain-of-thought ya ndani; toa muhtasari wa ushahidi na hatua salama. Tumia schema hii:\n${JSON.stringify({
      problemSummary: 'Muhtasari wa tatizo kwa sentensi 1-2',
      steps: [{ stepNumber: 1, thought: 'Muhtasari wa hoja', action: 'Hatua inayopendekezwa', evidence: 'Ushahidi au null', confidence: 0.8 }],
      conclusion: 'Hitimisho',
      confidence: 0.8,
      gapsIdentified: [],
    })}`;

    const response = await this.provider.generateText({
      systemPrompt,
      prompt,
      tier: 'balanced',
      temperature: 0.1,
      maxTokens: 1500,
    });

    const executionTimeMs = Date.now() - startTime;
    const result = parseReasoningResponse(response.content, normalizedProblem);
    result.executionTimeMs = executionTimeMs;

    await this.memory.recordEpisode(normalizedProblem, result.conclusion, ['reasoning_task']);
    return result;
  }
}
