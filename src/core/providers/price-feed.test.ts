import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadCommittedPrices, mapOpenRouterPrices } from './price-feed.ts';
import { estimateCostUsd } from './usage.ts';
import { MODEL_ROUTES } from './model-routing.ts';

test('price feed ya kudomu ina snapshot halisi za model zote za MODEL_ROUTES', () => {
  const prices = loadCommittedPrices();
  const routed = new Set(Object.values(MODEL_ROUTES));
  const priced = new Set(prices.map((price) => price.modelId));
  for (const modelId of routed) {
    assert.ok(priced.has(modelId), `model ${modelId} ya MODEL_ROUTES inahitaji snapshot ya bei`);
  }
  assert.ok(prices.length >= routed.size);
});

test('price feed ya kudomu inafuata contract ya PriceSnapshot', () => {
  for (const price of loadCommittedPrices()) {
    assert.ok(price.version.length > 0);
    assert.ok(price.source.length > 0);
    assert.ok(!Number.isNaN(Date.parse(price.effectiveAt)));
    assert.ok(price.inputUsdPerMillionTokens > 0);
    assert.ok(price.outputUsdPerMillionTokens > 0);
  }
});

test('estimateCostUsd inatumia bei ya kudomu bila kubuni', () => {
  const prices = loadCommittedPrices();
  const flash = prices.find((price) => price.modelId === 'gemini-2.5-flash');
  const cost = estimateCostUsd({ promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 }, flash);
  assert.ok(cost !== undefined);
  assert.ok(Math.abs(cost - flash!.inputUsdPerMillionTokens) < 1e-6);
  // Model isiyo na pigo inabaki bila cost: hakuna kubuni
  assert.equal(estimateCostUsd({ promptTokens: 10, completionTokens: 10, totalTokens: 20 }, undefined), undefined);
});

test('mapOpenRouterPrices inageuza bei per-token kuwa per-million na kuthibitisha model', () => {
  const now = new Date('2026-11-02T02:03:00.000Z');
  const payload = {
    data: [
      {
        id: 'google/gemini-2.5-flash',
        pricing: { prompt: '0.0000003', completion: '0.0000025' },
      },
      {
        id: 'openai/gpt-4o',
        pricing: { prompt: '0.0000025', completion: '0.00001' },
      },
      {
        id: 'google/gemini-2.5-pro',
        pricing: { prompt: '0.00000125', completion: '0.00001' },
      },
    ],
  };
  const snapshots = mapOpenRouterPrices(payload, now, 'https://openrouter.ai/api/v1/models');
  const flash = snapshots.find((snapshot) => snapshot.modelId === 'gemini-2.5-flash');
  assert.equal(flash?.inputUsdPerMillionTokens, 0.3);
  assert.equal(flash?.outputUsdPerMillionTokens, 2.5);
  assert.equal(snapshots.length, 2, 'model zisizo za Google zinapaswa kurukwa');
  assert.equal(flash?.effectiveAt, now.toISOString());
});

test('mapOpenRouterPrices inakataa payload isiyo sahihi kwa sauti', () => {
  const now = new Date();
  assert.throws(() => mapOpenRouterPrices({ data: 'sio array' }, now, 'url'));
  assert.throws(() => mapOpenRouterPrices({ data: [{ id: 'openai/gpt-4o', pricing: {} }] }, now, 'url'));
});
