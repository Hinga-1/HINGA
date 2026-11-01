import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LocalModelError, LocalModelProvider, assertLoopback } from './local-model.ts';

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void
): Promise<{ server: Server; baseUrl: string; captured: Captured[] }> {
  const captured: Captured[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      captured.push({
        url: request.url ?? '',
        method: request.method ?? '',
        body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
      });
      handler(request, response, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, captured });
    });
  });
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('local model: ollama flavour posts the expected body and parses the answer', async () => {
  const { server, baseUrl, captured } = await startServer((_request, response) =>
    json(response, 200, {
      model: 'qwen2.5:7b',
      response: 'Jibu la ndani',
      done_reason: 'stop',
      prompt_eval_count: 12,
      eval_count: 5,
    })
  );
  try {
    const provider = new LocalModelProvider({
      model: 'qwen2.5:7b',
      baseUrl,
      timeoutMs: 5_000,
      fetchImpl: fetch,
    });
    assert.equal(await provider.isAvailable(), true);

    const result = await provider.generateText({
      prompt: 'Eleza kwa ufupi.',
      systemPrompt: 'Wewe ni msaidizi.',
      temperature: 0.2,
      maxTokens: 64,
    });

    assert.equal(result.content, 'Jibu la ndani');
    assert.equal(result.model, 'qwen2.5:7b');
    assert.equal(result.usage?.totalTokens, 17);
    assert.equal(result.finishReason, 'stop');

    const generate = captured.find((item) => item.url === '/api/generate');
    assert.ok(generate);
    assert.equal(generate.method, 'POST');
    assert.equal(generate.body.model, 'qwen2.5:7b');
    assert.equal(generate.body.stream, false);
    assert.equal(generate.body.prompt, 'Eleza kwa ufupi.');
    assert.equal(generate.body.system, 'Wewe ni msaidizi.');
    assert.deepEqual(generate.body.options, { temperature: 0.2, num_predict: 64 });
  } finally {
    await close(server);
  }
});

test('local model: openai-compatible flavour sends system and user messages', async () => {
  const { server, baseUrl, captured } = await startServer((_request, response) =>
    json(response, 200, {
      model: 'llama-local',
      choices: [{ message: { role: 'assistant', content: 'Sawa kabisa' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    })
  );
  try {
    const provider = new LocalModelProvider({
      model: 'llama-local',
      baseUrl,
      flavour: 'openai-compatible',
      timeoutMs: 5_000,
    });
    const result = await provider.generateText({ prompt: 'Habari', systemPrompt: 'Kanuni' });

    assert.equal(result.content, 'Sawa kabisa');
    assert.equal(result.usage?.totalTokens, 14);

    const request = captured.find((item) => item.url === '/v1/chat/completions');
    assert.ok(request);
    const messages = request.body.messages as { role: string; content: string }[];
    assert.deepEqual(messages.map((item) => item.role), ['system', 'user']);
    assert.equal(messages[0].content, 'Kanuni');
    assert.equal(request.body.stream, false);
  } finally {
    await close(server);
  }
});

test('local model: an HTTP error becomes a LocalModelError with its status', async () => {
  const { server, baseUrl } = await startServer((_request, response) =>
    json(response, 500, { error: 'model not loaded' })
  );
  try {
    const provider = new LocalModelProvider({ model: 'missing', baseUrl, timeoutMs: 5_000 });
    await assert.rejects(
      () => provider.generateText({ prompt: 'x' }),
      (err: unknown) => err instanceof LocalModelError && err.status === 500
    );
  } finally {
    await close(server);
  }
});

test('local model: a slow server times out instead of hanging', async () => {
  const { server, baseUrl } = await startServer((_request, response) => {
    setTimeout(() => json(response, 200, { response: 'imechelewa' }), 300);
  });
  try {
    const provider = new LocalModelProvider({ model: 'slow', baseUrl, timeoutMs: 50 });
    await assert.rejects(
      () => provider.generateText({ prompt: 'x' }),
      (err: unknown) => err instanceof LocalModelError && /haikujibu/.test((err as Error).message)
    );
  } finally {
    await close(server);
  }
});

test('local model: unavailable server reports false and never falls back', async () => {
  const { server, baseUrl } = await startServer((_request, response) => json(response, 200, {}));
  await close(server);
  const provider = new LocalModelProvider({ model: 'offline', baseUrl, timeoutMs: 200 });
  assert.equal(await provider.isAvailable(), false);
  await assert.rejects(() => provider.generateText({ prompt: 'x' }), /Imeshindikana kufikia/);
});

test('local model: remote hosts are refused unless explicitly allowed', () => {
  assert.throws(() => assertLoopback('http://example.com:11434'), /si anwani ya ndani/);
  assert.doesNotThrow(() => assertLoopback('http://example.com:11434', true));
  assert.doesNotThrow(() => assertLoopback('http://localhost:11434'));
  assert.doesNotThrow(() => assertLoopback('http://[::1]:11434'));
  assert.throws(() => assertLoopback('ftp://127.0.0.1'), /Protokoli/);
  assert.throws(() => assertLoopback('si url'), /si sahihi/);
  assert.throws(
    () => new LocalModelProvider({ model: 'x', baseUrl: 'http://10.0.0.5:11434' }),
    /si anwani ya ndani/
  );
  assert.throws(() => new LocalModelProvider({ model: '  ' }), /Jina la modeli/);
});

test('local model: a malformed payload is rejected loudly', async () => {
  const { server, baseUrl } = await startServer((_request, response) => json(response, 200, { huyu: 'si jibu' }));
  try {
    const provider = new LocalModelProvider({ model: 'odd', baseUrl, timeoutMs: 5_000 });
    await assert.rejects(() => provider.generateText({ prompt: 'x' }), /"response"/);
  } finally {
    await close(server);
  }
});
