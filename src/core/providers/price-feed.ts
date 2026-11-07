import type { PriceSnapshot } from './usage.ts';
import committedPrices from './committed-prices.json';

/**
 * Price feed ya kudumu: pigo la bei lilihifadhiwa kwenye repo baada ya
 * kuthibitishwa kutoka chanzo halisi (OpenRouter /api/v1/models, bei za
 * orodha za Google). Hakuna bei inayobuniwa hapa - kila snapshot ina
 * `source` na `effectiveAt` inayoelezwa.
 *
 * Kusasisha: endesha refresh kwa mapumziko (curl kwa OpenRouter), thibitisha
 * thamani, kisha badilisha `committed-prices.json`. Usibadilishe kwa mkono
 * bila chanzo.
 */
export interface CommittedPricesFile {
  version: string;
  source: string;
  snapshots: PriceSnapshot[];
}

function isValidSnapshot(snapshot: unknown): snapshot is PriceSnapshot {
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const s = snapshot as Record<string, unknown>;
  return (
    typeof s.version === 'string' &&
    s.version.length > 0 &&
    (s.modelId === undefined || typeof s.modelId === 'string') &&
    typeof s.source === 'string' &&
    s.source.length > 0 &&
    typeof s.effectiveAt === 'string' &&
    !Number.isNaN(Date.parse(s.effectiveAt)) &&
    typeof s.inputUsdPerMillionTokens === 'number' &&
    s.inputUsdPerMillionTokens > 0 &&
    typeof s.outputUsdPerMillionTokens === 'number' &&
    s.outputUsdPerMillionTokens > 0
  );
}

/** Pigo la bei zilizothibitishwa, tayari kwa GeminiModelProvider.options.prices. */
export function loadCommittedPrices(): PriceSnapshot[] {
  const file = committedPrices as unknown as CommittedPricesFile;
  if (!file || !Array.isArray(file.snapshots)) {
    throw new Error('committed-prices.json haina snapshots array');
  }
  const snapshots = file.snapshots.filter(isValidSnapshot);
  if (snapshots.length !== file.snapshots.length || snapshots.length === 0) {
    throw new Error('committed-prices.json ina snapshot ambazo hazifuata contract ya PriceSnapshot');
  }
  return snapshots.map((snapshot) => ({ ...snapshot }));
}

/**
 * Ramani ya matokeo ya OpenRouter `/api/v1/models` kuwa PriceSnapshot[].
 * Bei za OpenRouter ni per-token USD; hapa zinageuka kuwa per-million tokens.
 * Model isiyo na bei kamili inarukwa, haibuniwi.
 */
export function mapOpenRouterPrices(payload: unknown, now: Date, sourceUrl: string): PriceSnapshot[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new Error('OpenRouter payload haina data array');
  }
  const snapshots: PriceSnapshot[] = [];
  const version = `openrouter-${now.toISOString()}`;
  for (const entry of data) {
    const model = entry as { id?: unknown; pricing?: Record<string, unknown> };
    if (typeof model.id !== 'string' || !model.id.startsWith('google/gemini-')) continue;
    const prompt = Number(model.pricing?.prompt);
    const completion = Number(model.pricing?.completion);
    if (!Number.isFinite(prompt) || prompt < 0 || !Number.isFinite(completion) || completion < 0) continue;
    snapshots.push({
      version,
      modelId: model.id.replace('google/', ''),
      source: `openrouter:${model.id} (${sourceUrl})`,
      effectiveAt: now.toISOString(),
      inputUsdPerMillionTokens: prompt * 1_000_000,
      outputUsdPerMillionTokens: completion * 1_000_000,
    });
  }
  if (snapshots.length === 0) {
    throw new Error('Hakuna model ya Google/Gemini yenye bei kamili kwenye payload');
  }
  return snapshots;
}
