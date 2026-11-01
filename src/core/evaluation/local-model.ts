/**
 * Local model provider (Mission 002): talks to a model running on this machine.
 *
 * Two flavours, both keyless:
 *   - `ollama`            POST /api/generate
 *   - `openai-compatible` POST /v1/chat/completions (llama.cpp server, vLLM, LM Studio)
 *
 * Safety rules:
 *   1. Only loopback hosts by default. Reaching a remote host needs `allowRemote`.
 *   2. No silent fallback: if the model is missing or slow, this throws. A failed
 *      local model must never be mistaken for a passing evaluation.
 *   3. No key is read, stored or sent.
 */

import type { AiModelProvider, ModelRequest, ModelResponse } from '../types.ts';

export type LocalFlavour = 'ollama' | 'openai-compatible';

export interface LocalModelOptions {
  model: string;
  baseUrl?: string;
  flavour?: LocalFlavour;
  timeoutMs?: number;
  allowRemote?: boolean;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class LocalModelError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LocalModelError';
    this.status = status;
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

export const DEFAULT_BASE_URLS: Record<LocalFlavour, string> = {
  ollama: 'http://127.0.0.1:11434',
  'openai-compatible': 'http://127.0.0.1:8080',
};

export function assertLoopback(rawUrl: string, allowRemote = false): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LocalModelError(`URL si sahihi: "${rawUrl}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalModelError(`Protokoli "${url.protocol}" haitumiki; tumia http au https.`);
  }
  if (!allowRemote && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new LocalModelError(
      `"${url.hostname}" si anwani ya ndani. Modeli ya ndani inakataa mtandao; ` +
        'tumia allowRemote ikiwa una uhakika, au weka modeli kwenye 127.0.0.1.'
    );
  }
  return url;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class LocalModelProvider implements AiModelProvider {
  readonly id = 'local-provider';
  readonly name: string;
  readonly model: string;
  readonly flavour: LocalFlavour;

  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: LocalModelOptions) {
    if (!options.model || options.model.trim() === '') {
      throw new LocalModelError('Jina la modeli linahitajika (mf. qwen2.5:7b).');
    }
    this.flavour = options.flavour ?? 'ollama';
    this.model = options.model;
    const base = options.baseUrl ?? DEFAULT_BASE_URLS[this.flavour];
    this.baseUrl = trimBase(assertLoopback(base, options.allowRemote ?? false).toString());
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.name = `Local Model (${this.flavour}/${this.model})`;
  }

  private endpoint(): string {
    return this.flavour === 'ollama' ? `${this.baseUrl}/api/generate` : `${this.baseUrl}/v1/chat/completions`;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new LocalModelError(`Modeli ya ndani haikujibu ndani ya ${timeoutMs} ms.`);
      }
      throw new LocalModelError(
        `Imeshindikana kufikia modeli ya ndani kwenye ${this.baseUrl}: ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  /** Probes the local server. Never throws and never falls back to a mock. */
  async isAvailable(): Promise<boolean> {
    const path = this.flavour === 'ollama' ? '/api/tags' : '/v1/models';
    try {
      const response = await this.request(path, { method: 'GET' }, 3_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateText(request: ModelRequest): Promise<ModelResponse> {
    const temperature = request.temperature ?? 0.1;
    const body =
      this.flavour === 'ollama'
        ? {
            model: this.model,
            prompt: request.prompt,
            system: request.systemPrompt,
            stream: false,
            options: {
              temperature,
              ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
            },
          }
        : {
            model: this.model,
            stream: false,
            temperature,
            ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
            messages: [
              ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
              { role: 'user', content: request.prompt },
            ],
          };

    const response = await this.request(
      this.flavour === 'ollama' ? '/api/generate' : '/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.timeoutMs
    );

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new LocalModelError(
        `Modeli ya ndani ilirudisha HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status
      );
    }

    const payload = asRecord(await response.json().catch(() => null));
    if (!payload) throw new LocalModelError('Jibu la modeli ya ndani si JSON.');

    if (this.flavour === 'ollama') {
      const content = payload.response;
      if (typeof content !== 'string') {
        throw new LocalModelError('Jibu la Ollama halina sehemu ya "response" ya maandishi.');
      }
      const promptTokens = num(payload.prompt_eval_count);
      const completionTokens = num(payload.eval_count);
      return {
        content,
        model: typeof payload.model === 'string' ? payload.model : this.model,
        ...(promptTokens !== undefined && completionTokens !== undefined
          ? {
              usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              },
            }
          : {}),
        ...(typeof payload.done_reason === 'string' ? { finishReason: payload.done_reason } : {}),
      };
    }

    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new LocalModelError('Jibu la OpenAI-compatible halina "choices".');
    }
    const message = asRecord(asRecord(choices[0])?.message);
    const content = message?.content;
    if (typeof content !== 'string') {
      throw new LocalModelError('Jibu la OpenAI-compatible halina maudhui ya maandishi.');
    }
    const usage = asRecord(payload.usage);
    const promptTokens = num(usage?.prompt_tokens);
    const completionTokens = num(usage?.completion_tokens);
    return {
      content,
      model: typeof payload.model === 'string' ? payload.model : this.model,
      ...(promptTokens !== undefined && completionTokens !== undefined
        ? {
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: num(usage?.total_tokens) ?? promptTokens + completionTokens,
            },
          }
        : {}),
    };
  }
}
