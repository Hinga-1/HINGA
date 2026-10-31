import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_ROUTES, DEFAULT_MODEL_TIER, resolveModelForTier } from './model-routing.ts';
import { ModelTier } from '../types.ts';

test('kila tier ina route ya stable model ID', () => {
  assert.equal(MODEL_ROUTES.fast, 'gemini-2.5-flash');
  assert.equal(MODEL_ROUTES.balanced, 'gemini-2.5-flash');
  assert.equal(MODEL_ROUTES.deep, 'gemini-2.5-pro');
});

test('route table inakamilisha ModelTier zote na haibadiliki', () => {
  const tiers: ModelTier[] = ['fast', 'balanced', 'deep'];
  for (const tier of tiers) {
    assert.ok(MODEL_ROUTES[tier], `tier ${tier} haina route`);
    assert.equal(typeof MODEL_ROUTES[tier], 'string');
    assert.ok((MODEL_ROUTES[tier] as string).length > 0);
  }
  assert.equal(Object.keys(MODEL_ROUTES).length, 3);
  assert.equal(Object.isFrozen(MODEL_ROUTES), true);
  assert.throws(() => { (MODEL_ROUTES as Record<string, string>).fast = 'other-model'; }, TypeError);
});

test('tier isiyoainishwa inapata route ya balanced', () => {
  assert.equal(resolveModelForTier(undefined), MODEL_ROUTES[DEFAULT_MODEL_TIER]);
  assert.equal(DEFAULT_MODEL_TIER, 'balanced');
});

test('tier isiyojulikana inakataliwa, haijaghushiwa kimya', () => {
  assert.throws(() => resolveModelForTier('ultra' as unknown as ModelTier), /isiyojulikana/);
  assert.throws(() => resolveModelForTier('' as unknown as ModelTier), /isiyojulikana/);
});

test('resolveModelForTier inarudisha route sahihi kwa kila tier halisi', () => {
  const tiers: ModelTier[] = ['fast', 'balanced', 'deep'];
  for (const tier of tiers) {
    assert.equal(resolveModelForTier(tier), MODEL_ROUTES[tier]);
  }
});
