import { AiModelProvider, ModelRequest, ModelResponse } from '../types.ts';

/**
 * Deterministic Mock Provider for Sandbox, Local Terminal & Unit Testing
 * Runs instantly without requiring internet access or spending tokens.
 */
export class MockModelProvider implements AiModelProvider {
  readonly id = 'mock-provider';
  readonly name = 'Mock Sandbox AI Provider';

  private cannedResponses: Map<string, string> = new Map();

  constructor() {
    this.cannedResponses.set(
      'default',
      'Uchambuzi umekamilika kwa mafanikio. Hatua zote zimechunguzwa kulingana na misingi ya kiufundi.'
    );
  }

  setResponse(promptKeyword: string, response: string): void {
    this.cannedResponses.set(promptKeyword.toLowerCase(), response);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateText(request: ModelRequest): Promise<ModelResponse> {
    const promptLower = request.prompt.toLowerCase();
    let content = this.cannedResponses.get('default')!;

    for (const [key, canned] of this.cannedResponses.entries()) {
      if (promptLower.includes(key)) {
        content = canned;
        break;
      }
    }

    // If it's asking for structured JSON or steps:
    if (promptLower.includes('reasoning') || promptLower.includes('uchambuzi')) {
      content = JSON.stringify({
        problemSummary: `Uchambuzi wa: ${request.prompt.slice(0, 60)}...`,
        steps: [
          {
            stepNumber: 1,
            thought: 'Kutambua vigezo vikuu na vikwazo vya tatizo.',
            action: 'Uchambuzi wa mahitaji',
            confidence: 0.95,
          },
          {
            stepNumber: 2,
            thought: 'Kutathmini suluhisho mbadala na kuchagua lililo salama.',
            action: 'Tathmini ya ushahidi',
            confidence: 0.90,
          },
        ],
        conclusion: 'Suluhisho limethibitishwa kuwa salama, linafuata kanuni, na linawezekana kiufundi.',
        confidence: 0.92,
      });
    }

    return {
      content,
      model: 'sandbox-mock-v1',
      usage: {
        promptTokens: request.prompt.length / 4,
        completionTokens: content.length / 4,
        totalTokens: (request.prompt.length + content.length) / 4,
      },
    };
  }
}
