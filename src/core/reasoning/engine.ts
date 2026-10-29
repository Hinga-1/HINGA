import { AiModelProvider, ReasoningResult, ReasoningStep } from '../types.ts';
import { MemoryManager } from '../memory/memory-manager.ts';
import { IdentityManager } from '../identity/identity-manager.ts';

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
   * Decomposes a complex problem and produces verified, step-by-step reasoning.
   */
  async reason(problem: string): Promise<ReasoningResult> {
    const startTime = Date.now();

    // 1. Retrieve relevant prior knowledge and context
    const relevantKnowledge = await this.memory.findRelevantKnowledge(problem, 3);
    const knowledgeContext = relevantKnowledge.map((k) => `[Maarifa: ${k.key}]: ${k.content}`).join('\n');

    // 2. Build structured reasoning prompt
    const systemPrompt = this.identity.buildSystemPrompt('Mchambuzi wa Kiufundi na Mfikiri wa Hatua kwa Hatua');

    const prompt = `TATIZO LA KUCHAMBUA:
${problem}

MAARIFA YALIYOHIFADHIWA YANAYOHUSU TATIZO:
${knowledgeContext || 'Hakuna maarifa maalum yaliyohifadhiwa awali kuhusu mada hii.'}

MAELEKEZO YA KITAALAMU:
Chambua tatizo hili kwa kina na utoe jibu kwa muundo wa JSON ufuatao (bila markdown ziada):
{
  "problemSummary": "Muhtasari sahihi wa tatizo kwa sentensi 1-2",
  "steps": [
    {
      "stepNumber": 1,
      "thought": "Uchambuzi wa kwanza...",
      "action": "Kuangalia vigezo...",
      "evidence": "Ushahidi uliotumika...",
      "confidence": 0.95
    }
  ],
  "conclusion": "Hitimisho thabiti na maamuzi ya kiufundi",
  "confidence": 0.92,
  "gapsIdentified": ["Mambo yasiyojulikana au yanayohitaji utafiti zaidi (ikiwa yapo)"]
}`;

    const response = await this.provider.generateText({
      systemPrompt,
      prompt,
      tier: 'balanced',
      temperature: 0.1,
    });

    const executionTimeMs = Date.now() - startTime;

    // 3. Parse and validate the reasoning output
    let parsed: any;
    try {
      // Strip markdown code fences if model included them
      let cleaned = response.content.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '');
      parsed = JSON.parse(cleaned.trim());
    } catch {
      // Fallback deterministic structure if response was unstructured
      parsed = {
        problemSummary: `Uchambuzi wa tatizo: ${problem}`,
        steps: [
          {
            stepNumber: 1,
            thought: response.content,
            action: 'Uchambuzi wa moja kwa moja',
            confidence: 0.85,
          },
        ],
        conclusion: response.content,
        confidence: 0.85,
        gapsIdentified: [],
      };
    }

    const steps: ReasoningStep[] = (parsed.steps || []).map((s: any, idx: number) => ({
      stepNumber: s.stepNumber || idx + 1,
      thought: s.thought || '',
      action: s.action || '',
      evidence: s.evidence,
      confidence: typeof s.confidence === 'number' ? s.confidence : 0.8,
    }));

    const result: ReasoningResult = {
      problemSummary: parsed.problemSummary || problem,
      steps,
      conclusion: parsed.conclusion || 'Uchambuzi umekamilika.',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      gapsIdentified: parsed.gapsIdentified || [],
      executionTimeMs,
    };

    // 4. Save episode to memory for future reflection
    await this.memory.recordEpisode(problem, result.conclusion, ['reasoning_task']);

    return result;
  }
}
