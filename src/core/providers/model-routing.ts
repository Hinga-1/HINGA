import { ModelTier } from '../types.ts';

/**
 * Stable model-ID route table for Gemini tier routing (Mission 003).
 *
 * The rolling aliases (`gemini-flash-latest`, `gemini-pro-latest`) can silently change
 * the underlying model under a deployed system. This table pins a stable model ID per
 * tier so behavior is reproducible and auditable in the usage ledger.
 */
export const MODEL_ROUTES: Readonly<Record<ModelTier, string>> = Object.freeze({
  fast: 'gemini-2.5-flash',
  balanced: 'gemini-2.5-flash',
  deep: 'gemini-2.5-pro',
});

/** Requests that do not specify a tier are routed as `balanced`. */
export const DEFAULT_MODEL_TIER: ModelTier = 'balanced';

/**
 * Resolves the stable model ID for a request tier.
 *
 * An explicit unknown tier is rejected instead of being silently re-routed: a typo in
 * call-site code must fail loudly (and hit the fallback path) rather than quietly
 * changing which model serves production traffic.
 */
export function resolveModelForTier(tier: ModelTier | undefined): string {
  if (tier === undefined) return MODEL_ROUTES[DEFAULT_MODEL_TIER];
  const model = MODEL_ROUTES[tier];
  if (!model) throw new Error(`Tier ya model isiyojulikana: ${String(tier)}`);
  return model;
}
