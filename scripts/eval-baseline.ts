/**
 * Runs the frozen HINGA baseline suite against a real provider.
 *
 * Usage:
 *   npx tsx scripts/eval-baseline.ts                    # mock provider (no network, no cost)
 *   GEMINI_API_KEY=... npx tsx scripts/eval-baseline.ts # live provider
 *   EVAL_BASELINE_JSON=path.json npx tsx scripts/eval-baseline.ts  # compare to a saved summary
 *
 * Exit codes: 0 = suite passed and did not regress, 1 = failed or regressed,
 * 2 = configuration problem. Prints no secrets.
 */

import { readFileSync } from 'node:fs';
import { HINGA_BASELINE_SUITE } from '../src/core/evaluation/suites/hinga-baseline.ts';
import { compareToBaseline, runSuite, summarize } from '../src/core/evaluation/suite.ts';
import type { RunSummary } from '../src/core/evaluation/suite.ts';
import { MockModelProvider } from '../src/core/providers/mock-provider.ts';
import { GeminiModelProvider } from '../src/core/providers/gemini-provider.ts';
import { config } from '../src/core/config.ts';

function loadBaseline(): RunSummary | null {
  const path = process.env.EVAL_BASELINE_JSON;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RunSummary;
  } catch (err) {
    console.error(`✗ Imeshindikana kusoma baseline "${path}":`, err instanceof Error ? err.message : err);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const provider = config.geminiApiKey ? new GeminiModelProvider(config.geminiApiKey) : new MockModelProvider();
  console.log(`Suite: ${HINGA_BASELINE_SUITE.id} v${HINGA_BASELINE_SUITE.version}`);
  console.log(`Provider: ${provider.name}${config.geminiApiKey ? ' (live)' : ' (deterministic sandbox stub)'}\n`);

  const run = await runSuite(HINGA_BASELINE_SUITE, async (prompt) => {
    const response = await provider.generateText({ prompt, tier: 'balanced', temperature: 0.1 });
    return response.content;
  });

  for (const result of run.results) {
    const mark = result.passed ? '✓' : '✗';
    console.log(`${mark} ${result.caseId} (${Math.round(result.score * 100)}%, ${result.durationMs} ms)`);
    for (const outcome of result.outcomes.filter((item) => !item.passed)) {
      console.log(`    - ${outcome.graderId}: ${outcome.detail}`);
    }
  }

  console.log(
    `\nPass rate: ${(run.passRate * 100).toFixed(1)}% | weighted score: ${(run.weightedScore * 100).toFixed(1)}%`
  );

  const baseline = loadBaseline();
  const report = compareToBaseline(summarize(run), baseline);
  console.log(`Gate: ${report.verdict}`);
  for (const reason of report.reasons) console.log(`  - ${reason}`);

  if (!run.passed || report.verdict === 'regression') process.exit(1);
}

main().catch((err) => {
  console.error('Hitilafu:', err instanceof Error ? err.message : err);
  process.exit(2);
});
