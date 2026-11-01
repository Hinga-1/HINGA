/**
 * Deterministic graders for the HINGA evaluation harness (Mission 002).
 *
 * Why deterministic: research on LLM self-correction (Huang et al., ICLR 2024)
 * shows that a model judging its own answer does not reliably detect errors and
 * can turn correct answers wrong. A grader that can be computed from the output
 * alone is cheap, reproducible in CI and cannot be talked into agreement by the
 * model under test.
 *
 * No network, no model calls, no randomness.
 */

export class EvaluationConfigError extends Error {
  constructor(message: string) {
    super(`Usanidi wa tathmini si sahihi: ${message}`);
    this.name = 'EvaluationConfigError';
  }
}

export type Grader =
  | { kind: 'contains_all'; phrases: string[]; caseSensitive?: boolean; id?: string }
  | { kind: 'contains_none'; phrases: string[]; caseSensitive?: boolean; id?: string }
  | { kind: 'regex'; pattern: string; flags?: string; id?: string }
  | { kind: 'min_words'; count: number; id?: string }
  | { kind: 'max_words'; count: number; id?: string }
  | { kind: 'json_keys'; keys: string[]; id?: string }
  | { kind: 'equals'; expected: string; caseSensitive?: boolean; id?: string };

export interface GraderOutcome {
  graderId: string;
  kind: Grader['kind'];
  passed: boolean;
  detail: string;
}

export interface GradeResult {
  passed: boolean;
  score: number;
  outcomes: GraderOutcome[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(value: string, caseSensitive?: boolean): string {
  const collapsed = normalizeWhitespace(value);
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function describeGrader(grader: Grader): string {
  switch (grader.kind) {
    case 'contains_all':
      return `Lazima iwe na maneno yote: ${grader.phrases.join(', ')}`;
    case 'contains_none':
      return `Haipaswi kuwa na: ${grader.phrases.join(', ')}`;
    case 'regex':
      return `Lazima ifanane na /${grader.pattern}/`;
    case 'min_words':
      return `Lazima iwe na maneno ${grader.count} au zaidi`;
    case 'max_words':
      return `Haipaswi kuzidi maneno ${grader.count}`;
    case 'json_keys':
      return `Lazima iwe JSON yenye funguo: ${grader.keys.join(', ')}`;
    case 'equals':
      return 'Lazima ilingane na jibu lililowekwa';
  }
}

function graderId(grader: Grader, index: number): string {
  return grader.id ?? `g${index + 1}-${grader.kind}`;
}

function runGrader(output: string, grader: Grader): { passed: boolean; detail: string } {
  const caseSensitive = 'caseSensitive' in grader ? grader.caseSensitive : undefined;
  const haystack = normalizeForCompare(output, caseSensitive);

  switch (grader.kind) {
    case 'contains_all': {
      if (grader.phrases.length === 0) throw new EvaluationConfigError('contains_all haina maneno');
      const missing = grader.phrases.filter(
        (phrase) => !haystack.includes(normalizeForCompare(phrase, caseSensitive))
      );
      return missing.length === 0
        ? { passed: true, detail: 'Maneno yote yapo' }
        : { passed: false, detail: `Haipo: ${missing.join(', ')}` };
    }
    case 'contains_none': {
      if (grader.phrases.length === 0) throw new EvaluationConfigError('contains_none haina maneno');
      const found = grader.phrases.filter((phrase) =>
        haystack.includes(normalizeForCompare(phrase, caseSensitive))
      );
      return found.length === 0
        ? { passed: true, detail: 'Hakuna maneno yaliyokatazwa' }
        : { passed: false, detail: `Yamepatikana yaliyokatazwa: ${found.join(', ')}` };
    }
    case 'regex': {
      let regex: RegExp;
      try {
        regex = new RegExp(grader.pattern, grader.flags);
      } catch (err) {
        throw new EvaluationConfigError(
          `regex "${grader.pattern}" haiwezi kutengenezwa: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return regex.test(output)
        ? { passed: true, detail: 'Muundo umepatikana' }
        : { passed: false, detail: `Muundo /${grader.pattern}/ haujapatikana` };
    }
    case 'min_words': {
      if (!Number.isInteger(grader.count) || grader.count < 1) {
        throw new EvaluationConfigError('min_words inahitaji namba kamili >= 1');
      }
      const words = countWords(output);
      return words >= grader.count
        ? { passed: true, detail: `Maneno ${words} >= ${grader.count}` }
        : { passed: false, detail: `Maneno ${words} < ${grader.count}` };
    }
    case 'max_words': {
      if (!Number.isInteger(grader.count) || grader.count < 1) {
        throw new EvaluationConfigError('max_words inahitaji namba kamili >= 1');
      }
      const words = countWords(output);
      return words <= grader.count
        ? { passed: true, detail: `Maneno ${words} <= ${grader.count}` }
        : { passed: false, detail: `Maneno ${words} > ${grader.count}` };
    }
    case 'json_keys': {
      if (grader.keys.length === 0) throw new EvaluationConfigError('json_keys haina funguo');
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFence(output));
      } catch {
        return { passed: false, detail: 'Jibu si JSON halali' };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { passed: false, detail: 'JSON lazima iwe object' };
      }
      const record = parsed as Record<string, unknown>;
      const missing = grader.keys.filter((key) => !(key in record));
      return missing.length === 0
        ? { passed: true, detail: 'Funguo zote zipo' }
        : { passed: false, detail: `Funguo haipo: ${missing.join(', ')}` };
    }
    case 'equals': {
      if (!grader.expected.trim()) throw new EvaluationConfigError('equals haina jibu la kutarajia');
      const expected = normalizeForCompare(grader.expected, caseSensitive);
      const actual = normalizeForCompare(output, caseSensitive);
      return actual === expected
        ? { passed: true, detail: 'Jibu linalingana' }
        : { passed: false, detail: 'Jibu halilingani' };
    }
  }
}

/** Grades one output against every grader; the case passes only if all pass. */
export function gradeOutput(output: string, graders: Grader[]): GradeResult {
  if (!Array.isArray(graders) || graders.length === 0) {
    throw new EvaluationConfigError('kila kesi inahitaji angalau grader mmoja');
  }

  const outcomes: GraderOutcome[] = graders.map((grader, index) => {
    const result = runGrader(output, grader);
    return {
      graderId: graderId(grader, index),
      kind: grader.kind,
      passed: result.passed,
      detail: result.detail,
    };
  });

  const passedCount = outcomes.filter((outcome) => outcome.passed).length;
  return {
    passed: passedCount === outcomes.length,
    score: passedCount / outcomes.length,
    outcomes,
  };
}
