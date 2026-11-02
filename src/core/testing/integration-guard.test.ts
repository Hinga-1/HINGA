import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntegrationEnv } from './integration-guard';

test('integration guard: refuses everything without an explicit opt-in', () => {
  const refusals = [
    resolveIntegrationEnv({}),
    resolveIntegrationEnv({ RUN_NEON_INTEGRATION: 'false', NEON_BRANCH: 'mission-003-test-20261030' }),
    resolveIntegrationEnv({ RUN_NEON_INTEGRATION: '1', NEON_BRANCH: 'mission-003-test-20261030' }),
  ];
  for (const decision of refusals) {
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.length > 0, 'refusals must explain themselves');
  }
});

test('integration guard: an unset NEON_BRANCH never passes (production bypass closed)', () => {
  // Regression for the 2026-10-31 finding: the old check
  // `NEON_BRANCH !== 'production'` allowed undefined through, so a stray
  // DATABASE_URL (production) could receive test writes.
  const decision = resolveIntegrationEnv({ RUN_NEON_INTEGRATION: 'true' });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /NEON_BRANCH/);
});

test('integration guard: refuses production and blank-string branches', () => {
  assert.equal(resolveIntegrationEnv({ RUN_NEON_INTEGRATION: 'true', NEON_BRANCH: 'production' }).allowed, false);
  assert.equal(resolveIntegrationEnv({ RUN_NEON_INTEGRATION: 'true', NEON_BRANCH: '   ' }).allowed, false);
});

test('integration guard: allows an explicit non-production test branch', () => {
  const decision = resolveIntegrationEnv({
    RUN_NEON_INTEGRATION: 'true',
    NEON_BRANCH: 'mission-003-test-20261030',
  });
  assert.deepEqual(decision, { allowed: true, reason: '' });
});

test('integration guard: expects NEON_EXPECTED_BRANCH to agree when both are set', () => {
  const agree = resolveIntegrationEnv({
    RUN_NEON_INTEGRATION: 'true',
    NEON_BRANCH: 'mission-003-test-20261030',
    NEON_EXPECTED_BRANCH: 'Mission-003-Test-20261030',
  });
  assert.equal(agree.allowed, true);

  const disagree = resolveIntegrationEnv({
    RUN_NEON_INTEGRATION: 'true',
    NEON_BRANCH: 'mission-003-test-20261030',
    NEON_EXPECTED_BRANCH: 'production',
  });
  assert.equal(disagree.allowed, false);
  assert.match(disagree.reason, /does not match/);
});
