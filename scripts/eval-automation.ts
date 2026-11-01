/**
 * Evaluation automation: run the suite, enforce the gate, write a checkpoint.
 *
 * No API key, network call or database is required. By default it runs the
 * deterministic mock provider; `--live` uses the configured provider only when
 * its key exists in the environment.
 *
 * Usage:
 *   npx tsx scripts/eval-automation.ts                       # local, informational
 *   npx tsx scripts/eval-automation.ts --strict              # CI: no baseline = fail
 *   npx tsx scripts/eval-automation.ts --update-baseline     # record after a passing run
 *   npx tsx scripts/eval-automation.ts --live                # real provider (needs key)
 *   npx tsx scripts/eval-automation.ts --out .cache/eval     # artifact directory
 *
 * Exit codes: 0 = pass/informational, 1 = failed or regressed, 2 = configuration error.
 * Prints no secrets and never writes one to disk.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { HINGA_BASELINE_SUITE } from '../src/core/evaluation/suites/hinga-baseline.ts';
import { runSuite, summarize } from '../src/core/evaluation/suite.ts';
import {
  BaselineFileError,
  buildCheckpoint,
  decideAutomation,
  parseBaseline,
  renderCheckpointMarkdown,
  serializeBaseline,
} from '../src/core/evaluation/automation.ts';
import type { BaselineFile } from '../src/core/evaluation/automation.ts';
import { MockModelProvider } from '../src/core/providers/mock-provider.ts';
import { GeminiModelProvider } from '../src/core/providers/gemini-provider.ts';
import { config } from '../src/core/config.ts';

interface Options {
  strict: boolean;
  updateBaseline: boolean;
  live: boolean;
  allowMockBaseline: boolean;
  out: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    strict: false,
    updateBaseline: false,
    live: false,
    allowMockBaseline: false,
    out: '.cache/eval',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else if (arg === '--live') options.live = true;
    else if (arg === '--allow-mock-baseline') options.allowMockBaseline = true;
    else if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error('--out inahitaji njia ya saraka.');
      options.out = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Tumia: npx tsx scripts/eval-automation.ts [--strict] [--update-baseline] [--live] [--allow-mock-baseline] [--out dir]');
      process.exit(0);
    } else {
      throw new Error(`Chaguo lisilojulikana: ${arg}`);
    }
  }
  return options;
}

function tryGit(command: string): string | null {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

function loadBaseline(path: string): { baseline: BaselineFile | null; note: string } {
  try {
    return { baseline: parseBaseline(readFileSync(path, 'utf8')), note: `imepatikana (${path})` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { baseline: null, note: `haipo (${path})` };
    }
    if (err instanceof BaselineFileError) {
      console.error(`✗ Baseline imekataliwa: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (options.live && !config.geminiApiKey) {
    console.error('✗ --live imetumika lakini hakuna provider key kwenye mazingira. Hakuna ombi lililotumwa.');
    process.exit(2);
  }

  const provider = options.live && config.geminiApiKey
    ? new GeminiModelProvider(config.geminiApiKey)
    : new MockModelProvider();
  const providerIsMock = provider.name.toLowerCase().includes('mock');

  console.log(`[1/5] Suite: ${HINGA_BASELINE_SUITE.id} v${HINGA_BASELINE_SUITE.version}`);
  console.log(`[2/5] Provider: ${provider.name}${providerIsMock ? ' (deterministic sandbox stub)' : ''}`);

  const run = await runSuite(HINGA_BASELINE_SUITE, async (prompt) => {
    const response = await provider.generateText({ prompt, tier: 'balanced', temperature: 0.1 });
    return response.content;
  });

  const baselinePath = join(options.out, 'baseline.json');
  const { baseline, note } = loadBaseline(baselinePath);

  const decision = decideAutomation({
    run,
    baseline,
    providerIsMock,
    strict: options.strict,
    updateBaseline: options.updateBaseline,
    allowMockBaseline: options.allowMockBaseline,
  });

  const summary = summarize(run);
  console.log(`[3/5] Pass rate: ${(summary.passRate * 100).toFixed(1)}% | weighted: ${(summary.weightedScore * 100).toFixed(1)}%`);
  console.log(`[4/5] Baseline: ${note}`);
  console.log(`      Gate: ${decision.verdict} (exit ${decision.exitCode})`);
  for (const reason of decision.reasons) console.log(`      - ${reason}`);

  const stamp = new Date().toISOString();
  writeFile(
    join(options.out, 'runs', `${stamp.replace(/[:.]/g, '-')}.json`),
    `${JSON.stringify({ createdAt: stamp, provider: provider.name, summary, gate: decision.verdict, reasons: decision.reasons }, null, 2)}\n`
  );

  if (decision.writeBaseline && decision.nextBaseline) {
    writeFile(baselinePath, serializeBaseline(decision.nextBaseline));
    console.log(`[5/5] Baseline imehifadhiwa: ${baselinePath}`);
  } else if (decision.nextBaseline === null && options.updateBaseline) {
    console.log('[5/5] Baseline haikuhifadhiwa.');
  } else {
    console.log('[5/5] Baseline haijabadilishwa.');
  }

  const checkpoint = buildCheckpoint({
    run,
    decision,
    providerId: provider.name,
    modelId: options.live ? 'live-provider' : 'mock',
    providerIsMock,
    codeCommit: tryGit('git rev-parse --short HEAD'),
    branch: tryGit('git rev-parse --abbrev-ref HEAD'),
    baseline,
    createdAt: stamp,
  });

  writeFile(join(options.out, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  writeFile(join(options.out, 'checkpoint.md'), renderCheckpointMarkdown(checkpoint));
  console.log(`      Checkpoint: ${join(options.out, 'checkpoint.md')}`);

  process.exitCode = decision.exitCode;
}

main().catch((err) => {
  console.error('Hitilafu:', err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
