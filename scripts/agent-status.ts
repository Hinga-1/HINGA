/**
 * Answers one question, fast: what happened, and what failed?
 *
 *   npx tsx scripts/agent-status.ts
 *
 * Read-only. It never talks to a model, never writes to a database and never
 * needs a key. It reads the artifacts the loop already wrote, so it works while
 * the loop is still running and after the machine has been restarted.
 *
 * Exit codes: 0 = ripoti imeonyeshwa (hata kama kuna kushindwa),
 *             1 = hakuna data bado (mzunguko haujaanza).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface CycleRecord {
  at: string;
  provider: string | null;
  passRate: number | null;
  weightedScore: number | null;
  gate: string;
  exitCode: number;
  unavailable: boolean;
  failing: string[];
  reasons?: string[];
  gapsRecorded: number;
  note?: string;
}

function parseOut(argv: string[]): string {
  const index = argv.indexOf('--out');
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value) throw new Error('--out inahitaji saraka.');
    return value;
  }
  return '.cache/eval';
}

function readCycles(path: string): CycleRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CycleRecord];
      } catch {
        return [];
      }
    });
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function duration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `saa ${hours} na dakika ${minutes}` : `dakika ${minutes}`;
}

function main(): void {
  const outDir = parseOut(process.argv.slice(2));
  const cycles = readCycles(join(outDir, 'cycles.jsonl'));

  if (cycles.length === 0) {
    console.log('Hakuna duru bado kwenye ' + outDir + '.');
    console.log('Anzisha: npx tsx scripts/agent-loop.ts --local <modeli> --hours 48 --every 120');
    process.exit(1);
  }

  const measured = cycles.filter((cycle) => !cycle.unavailable);
  const unavailable = cycles.length - measured.length;
  const latest = cycles[cycles.length - 1];
  const lastMeasured = measured[measured.length - 1] ?? null;
  const firstMeasured = measured[0] ?? null;
  const best = measured.reduce<CycleRecord | null>(
    (top, cycle) => (top === null || (cycle.passRate ?? 0) > (top.passRate ?? 0) ? cycle : top),
    null
  );
  const gaps = cycles.reduce((sum, cycle) => sum + cycle.gapsRecorded, 0);
  const gates = cycles.reduce<Record<string, number>>((acc, cycle) => {
    acc[cycle.gate] = (acc[cycle.gate] ?? 0) + 1;
    return acc;
  }, {});
  const failures = latest.failing ?? [];
  const lastWithReasons = [...cycles].reverse().find((cycle) => (cycle.reasons ?? []).length > 0) ?? null;
  const stopped = existsSync(join(outDir, 'STOP'));

  console.log('=== KIMEFANYIKA ===');
  console.log(`Kipindi: ${cycles[0].at} → ${latest.at} (${duration(cycles[0].at, latest.at)})`);
  console.log(`Duru: ${cycles.length} · zilizopima kweli: ${measured.length}${unavailable > 0 ? ` · modeli haipo: ${unavailable}` : ''}`);
  console.log(`Modeli: ${lastMeasured?.provider ?? latest.provider ?? 'haijulikani'}`);
  console.log(`Hali za lango: ${Object.entries(gates).map(([gate, count]) => `${gate} ×${count}`).join(', ')}`);
  if (firstMeasured && lastMeasured && firstMeasured.passRate !== null && lastMeasured.passRate !== null) {
    console.log(
      `Mwenendo: ${percent(firstMeasured.passRate)} → ${percent(lastMeasured.passRate)}` +
        (best ? ` · bora ${percent(best.passRate)}` : '')
    );
  }
  if (gaps > 0) console.log(`Gaps zilizoandikwa kwenye database ya majaribio: ${gaps}`);
  if (stopped) console.log('Kumbuka: faili STOP ipo — mzunguko umeachishwa.');

  console.log('\n=== KIMEFELI (duru ya mwisho) ===');
  if (latest.unavailable) {
    console.log('Modeli haipo — duru ya mwisho haikupima kitu. Anzisha Ollama kisha mzunguko unaendelea.');
  }
  if (failures.length === 0) {
    console.log('Hakuna kesi iliyoshindwa kwenye duru ya mwisho.');
  } else {
    for (const caseId of failures) console.log(`- ${caseId}`);
  }
  if (lastWithReasons?.reasons && lastWithReasons.reasons.length > 0) {
    console.log(`\nSababu za lango (duru ya ${lastWithReasons.at}):`);
    for (const reason of lastWithReasons.reasons) console.log(`- ${reason}`);
  }

  console.log('\nRipoti kamili: ' + join(outDir, 'agent-report.md'));
  console.log('Duru 5 za mwisho:');
  for (const cycle of cycles.slice(-5)) {
    const status = cycle.unavailable ? 'modeli haipo' : cycle.gate;
    console.log(`  ${cycle.at} · ${percent(cycle.passRate)} · ${status}`);
  }
}

main();
