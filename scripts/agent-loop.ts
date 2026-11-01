/**
 * Nightly agent loop: the part that keeps working when nobody is in the chat.
 *
 * What this loop does, on every cycle, without a human:
 *   1. Checks the local model is really there (Ollama / llama-server on loopback).
 *   2. Runs the evaluation suite against it and enforces the promotion gate.
 *   3. Writes the cycle to .cache/eval/cycles.jsonl.
 *   4. Optionally records each failing case as a learning gap in the TEST database.
 *   5. Rewrites .cache/eval/agent-report.md so the next human reads a real report.
 *
 * What this loop deliberately does NOT do — because claiming otherwise would be
 * a lie: it does not invent new code, write new skills or improve the model
 * by itself. It measures, records and reports. The work of deciding what to
 * build next is still a human decision made from the report.
 *
 * Everything stays on this machine: no API key, no hosted model, no request
 * leaves the loopback interface. Exit codes: 0 = finished, 2 = configuration
 * error. A failing cycle is data, not a crash.
 *
 * Usage:
 *   npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120
 *   npx tsx scripts/agent-loop.ts --local qwen2.5:7b --once
 *   npx tsx scripts/agent-loop.ts --local qwen2.5:7b --record-gaps
 *
 * Stop it cleanly from outside: touch .cache/eval/STOP
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config } from '../src/core/config.ts';
import { NeonEvaluationStore } from '../src/core/evaluation/store.ts';

interface Options {
  localModel: string | null;
  localUrl: string | null;
  localApi: 'ollama' | 'openai' | null;
  everyMinutes: number;
  hours: number;
  once: boolean;
  out: string;
  recordGaps: boolean;
  maxUnavailable: number;
}

interface CycleRecord {
  at: string;
  provider: string | null;
  passRate: number | null;
  weightedScore: number | null;
  gate: string;
  exitCode: number;
  unavailable: boolean;
  failing: string[];
  reasons: string[];
  gapsRecorded: number;
  note?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    localModel: null,
    localUrl: null,
    localApi: null,
    everyMinutes: 120,
    hours: 48,
    once: false,
    out: '.cache/eval',
    recordGaps: false,
    maxUnavailable: 12,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') options.once = true;
    else if (arg === '--record-gaps') options.recordGaps = true;
    else if (arg === '--local') {
      const value = argv[++i];
      if (!value) throw new Error('--local inahitaji jina la modeli (mf. qwen2.5:7b).');
      options.localModel = value;
    } else if (arg === '--local-url') {
      const value = argv[++i];
      if (!value) throw new Error('--local-url inahitaji URL (mf. http://127.0.0.1:11434).');
      options.localUrl = value;
    } else if (arg === '--local-api') {
      const value = argv[++i];
      if (value !== 'ollama' && value !== 'openai') {
        throw new Error('--local-api inakubali "ollama" au "openai" tu.');
      }
      options.localApi = value;
    } else if (arg === '--every') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--every inahitaji dakika (> 0).');
      options.everyMinutes = value;
    } else if (arg === '--hours') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--hours inahitaji saa (> 0).');
      options.hours = value;
    } else if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error('--out inahitaji saraka.');
      options.out = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Matumizi: npx tsx scripts/agent-loop.ts [--local MODEL [--local-url URL] [--local-api ollama|openai]] ' +
          '[--every DAKIKA] [--hours SAA] [--once] [--record-gaps] [--out SARAKA]'
      );
      process.exit(0);
    } else {
      throw new Error(`Hoja isiyojulikana: ${arg}. Tumia --help.`);
    }
  }

  if (options.everyMinutes >= 30) options.everyMinutes = Math.round(options.everyMinutes);
  return options;
}

function writeFile(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Runs one evaluation cycle as a child process and returns its exit code. */
function runEvaluationCycle(options: Options): Promise<{ code: number; output: string }> {
  const args = ['tsx', 'scripts/eval-automation.ts', '--out', options.out];
  if (options.localModel) {
    args.push('--local', options.localModel);
    if (options.localUrl) args.push('--local-url', options.localUrl);
    if (options.localApi) args.push('--local-api', options.localApi);
  }

  return new Promise((resolvePromise) => {
    const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => resolvePromise({ code: code ?? 1, output }));
    child.on('error', (err) => resolvePromise({ code: 2, output: `spawn: ${err.message}` }));
  });
}

/** Reads the newest run artifact written by eval-automation.ts. */
function readLatestRun(outDir: string): {
  provider?: string;
  summary?: { passRate: number; weightedScore: number; cases: { caseId: string; passed: boolean }[] };
  gate?: string;
  reasons?: string[];
} | null {
  const runsDir = join(outDir, 'runs');
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(runsDir, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

/** True only when a test database is configured and is not production. */
function testDatabaseUrl(): string | null {
  const testUrl = config.databaseUrlTest;
  if (!testUrl) return null;
  if (testUrl === config.databaseUrl) return null;
  return testUrl;
}

async function recordGaps(record: CycleRecord, failing: string[]): Promise<number> {
  const url = testDatabaseUrl();
  if (!url || failing.length === 0) return 0;
  const store = new NeonEvaluationStore(url);
  try {
    await store.assertSchema();
  } catch {
    return 0;
  }
  let written = 0;
  for (const caseId of failing) {
    try {
      await store.recordGap({
        gapId: `gap_auto_${caseId}`,
        topic: `Kesi inayoshindwa: ${caseId}`,
        context: `Mzunguko wa kiotomatiki ${record.at} — gate: ${record.gate}.`,
        severity: 'medium',
      });
      written++;
    } catch {
      // A gap that cannot be written must never stop the loop.
    }
  }
  return written;
}

function renderReport(cycles: CycleRecord[], options: Options, startedAt: string): string {
  const available = cycles.filter((cycle) => !cycle.unavailable);
  const latest = available[available.length - 1] ?? null;
  const best = available.reduce<CycleRecord | null>(
    (top, cycle) => (top === null || (cycle.passRate ?? 0) > (top.passRate ?? 0) ? cycle : top),
    null
  );
  const first = available[0] ?? null;
  const failing = latest?.failing ?? [];
  const gateCounts = cycles.reduce<Record<string, number>>((acc, cycle) => {
    acc[cycle.gate] = (acc[cycle.gate] ?? 0) + 1;
    return acc;
  }, {});

  const rows = cycles
    .slice(-30)
    .map((cycle) => {
      const rate = cycle.passRate === null ? '—' : `${(cycle.passRate * 100).toFixed(1)}%`;
      const weighted = cycle.weightedScore === null ? '—' : `${(cycle.weightedScore * 100).toFixed(1)}%`;
      const status = cycle.unavailable ? 'modeli haipo' : cycle.gate;
      return `| ${cycle.at} | ${rate} | ${weighted} | ${status} | ${cycle.exitCode} |`;
    })
    .join('\n');

  const trend =
    first && latest && first.passRate !== null && latest.passRate !== null
      ? `${(first.passRate * 100).toFixed(1)}% → ${(latest.passRate * 100).toFixed(1)}%`
      : 'hakuna data ya kutosha';

  return `# Ripoti ya mzunguko — HINGA

Imeandikwa: ${new Date().toISOString()}
Mzunguko ulianza: ${startedAt}
Modeli: ${options.localModel ?? 'mock (jaribio la mfumo pekee)'}
Kila: ${options.everyMinutes} dakika · Kikomo: ${options.hours} saa
Duru: ${cycles.length} · Zilizofanikiwa kupima: ${available.length}

## Muhtasari

- Pass rate ya mwisho: ${latest && latest.passRate !== null ? `${(latest.passRate * 100).toFixed(1)}%` : 'hakuna'}
- Pass rate iliyobora: ${best && best.passRate !== null ? `${(best.passRate * 100).toFixed(1)}% (${best.at})` : 'hakuna'}
- Mwenendo: ${trend}
- Hali za lango: ${Object.entries(gateCounts).map(([gate, count]) => `${gate} ×${count}`).join(', ') || 'hakuna'}

## Duru (hadi 30 za mwisho)

| Wakati | Pass rate | Weighted | Lango | Exit |
|---|---|---|---|---|
${rows || '| — | — | — | hakuna duru | — |'}

## Kesi zinazoshindwa sasa

${failing.length === 0 ? 'Hakuna.' : failing.map((caseId) => `- ${caseId}`).join('\n')}

## Kinachohitaji mtu

Mzunguko huu unapima, unaandika na unaripoti. Hauandiki code mpya, haubuni
skills mpya na hauboresha modeli yenyewe. Maamuzi ya nini kujenga yanabaki kwa
mtu — lakini sasa yanafanywa kwa kusoma data halisi, sio kwa kukisia.
`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const stopFile = join(options.out, 'STOP');
  const cyclesPath = join(options.out, 'cycles.jsonl');
  const reportPath = join(options.out, 'agent-report.md');
  mkdirSync(options.out, { recursive: true });

  const deadline = Date.now() + options.hours * 3_600_000;
  const cycles: CycleRecord[] = [];
  let consecutiveUnavailable = 0;
  let stopping = false;

  const stop = (): void => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`Mzunguko umeanza: ${startedAt}`);
  console.log(`Modeli: ${options.localModel ?? 'mock'} · kila ${options.everyMinutes} dakika · kikomo ${options.hours} saa`);
  console.log(`Ripoti: ${reportPath} · Acha kwa: touch ${stopFile}`);

  while (!stopping) {
    if (existsSync(stopFile)) {
      console.log(`Faili ${stopFile} imepatikana — naacha kwa utulivu.`);
      break;
    }

    const { code, output } = await runEvaluationCycle(options);
    const run = code === 2 ? null : readLatestRun(options.out);
    const unavailable = code === 2 && /haipatikani/i.test(output);
    const failing = (run?.summary?.cases ?? []).filter((item) => !item.passed).map((item) => item.caseId);

    const record: CycleRecord = {
      at: new Date().toISOString(),
      provider: run?.provider ?? null,
      passRate: run?.summary?.passRate ?? null,
      weightedScore: run?.summary?.weightedScore ?? null,
      gate: run?.gate ?? (unavailable ? 'model_unavailable' : 'error'),
      exitCode: code,
      unavailable,
      failing,
      reasons: run?.reasons ?? [],
      gapsRecorded: 0,
      note: unavailable ? 'Modeli ya ndani haipatikani — duru hii haikupima kitu.' : undefined,
    };

    if (options.recordGaps && failing.length > 0) {
      record.gapsRecorded = await recordGaps(record, failing);
    }

    cycles.push(record);
    appendFileSync(cyclesPath, `${JSON.stringify(record)}\n`, 'utf8');
    writeFileSync(reportPath, renderReport(cycles, options, startedAt), 'utf8');

    const rate = record.passRate === null ? '—' : `${(record.passRate * 100).toFixed(1)}%`;
    console.log(
      `[${record.at}] pass ${rate} · lango ${record.gate} · exit ${code}` +
        (record.gapsRecorded > 0 ? ` · gaps ${record.gapsRecorded}` : '')
    );

    consecutiveUnavailable = unavailable ? consecutiveUnavailable + 1 : 0;
    if (consecutiveUnavailable >= options.maxUnavailable) {
      console.log(`Modeli haijapatikana duru ${consecutiveUnavailable} mfululizo — naacha. Anzisha Ollama kisha rudia.`);
      break;
    }

    if (options.once || stopping) break;
    if (Date.now() + options.everyMinutes * 60_000 > deadline) {
      console.log('Kikomo cha muda kimefikiwa — naacha kwa utulivu.');
      break;
    }

    const wakeAt = new Date(Date.now() + options.everyMinutes * 60_000).toISOString();
    console.log(`Inalala hadi ${wakeAt}…`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, options.everyMinutes * 60_000));
  }

  writeFileSync(reportPath, renderReport(cycles, options, startedAt), 'utf8');
  console.log(`Duru ${cycles.length} zimekamilika. Ripoti: ${reportPath}`);
}

await main();
