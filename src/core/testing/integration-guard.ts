/**
 * Integration-test guard: the single place that decides whether live
 * integration tests may touch a Neon database.
 *
 * Rule (learned the hard way on 2026-10-31, when `npm test` was writing to
 * and deleting from the production database): silence is NOT consent.
 *
 *   - RUN_NEON_INTEGRATION must be an explicit "true".
 *   - NEON_BRANCH must be set. An unset branch used to pass the old check
 *     (`NEON_BRANCH !== 'production'`), silently letting tests fall back to
 *     whatever DATABASE_URL was lying around - which is production.
 *   - NEON_BRANCH must not be "production".
 *   - NEON_EXPECTED_BRANCH, when set, must agree with NEON_BRANCH.
 *
 * Add the DATABASE_URL/UNPOOLED variables ONLY in the caller, AFTER this
 * guard has allowed the run. The guard never reads DATABASE_URL on purpose:
 * it must stay pure so unit tests can exercise every branch (see
 * integration-guard.test.ts, which runs in CI via `npm test`).
 */

export interface IntegrationDecision {
  allowed: boolean;
  /** Human-readable refusal reason; empty string when allowed. */
  reason: string;
}

/** Fields the guard looks at; a narrow slice of NodeJS.ProcessEnv for testability. */
export interface IntegrationEnv {
  RUN_NEON_INTEGRATION?: string;
  NEON_BRANCH?: string;
  NEON_EXPECTED_BRANCH?: string;
}

export function resolveIntegrationEnv(env: IntegrationEnv): IntegrationDecision {
  if (env.RUN_NEON_INTEGRATION !== 'true') {
    return { allowed: false, reason: 'Set RUN_NEON_INTEGRATION=true to opt in to live Neon integration tests' };
  }

  const branch = (env.NEON_BRANCH ?? '').trim();
  if (!branch) {
    return {
      allowed: false,
      reason:
        'NEON_BRANCH must name an explicit non-production test branch; unset means DATABASE_URL would default to production',
    };
  }
  if (branch === 'production') {
    return { allowed: false, reason: 'NEON_BRANCH "production" is never a test target' };
  }

  const expected = (env.NEON_EXPECTED_BRANCH ?? '').trim().toLowerCase();
  if (expected && expected !== branch.toLowerCase()) {
    return {
      allowed: false,
      reason: `NEON_EXPECTED_BRANCH "${env.NEON_EXPECTED_BRANCH}" does not match NEON_BRANCH "${branch}"`,
    };
  }

  return { allowed: true, reason: '' };
}
