/**
 * Promotion gate for learned facts (Mission 002).
 *
 * Research basis: durable memory only helps when promotion is gated. Published
 * gates (Compiled Memory / Atlas, 2026) combine three cheap checks — dedup,
 * verification, and lexical grounding against the source episode — plus a
 * confidence recurrence where corroboration raises and contradiction lowers
 * confidence. Ungated "the model said so" memories propagate errors, and
 * MemoryAgentBench (2025) shows no current system masters selective forgetting.
 *
 * This module is deliberately model-free: the gate is arithmetic and string
 * matching, so a model cannot argue its way past it.
 */

export interface CandidateLesson {
  id: string;
  topic: string;
  summary: string;
  content: string;
  /** Raw context the lesson was extracted from (episode text, doc excerpt). */
  sourceContext: string;
  verificationQuestion: string;
  expectedAnswer: string;
  /** How many independent sources confirmed this lesson (default 0). */
  corroborations?: number;
  /** How many sources contradicted it (default 0). */
  contradictions?: number;
}

export interface PromotedFact {
  id: string;
  topic: string;
  content: string;
  confidence: number;
}

export type PromotionVerdict = 'promote' | 'needs_review' | 'reject';

export interface PromotionDecision {
  verdict: PromotionVerdict;
  /** Final confidence after corroboration/contradiction updates (0..1). */
  confidence: number;
  reasons: string[];
  /** Existing fact this candidate duplicates or overlaps, when detected. */
  matchedExistingId?: string;
  /** Significant terms shared with the source context. */
  groundingTerms: string[];
}

export interface PromotionOptions {
  existing?: PromotedFact[];
  /** Minimum confidence to promote. Defaults to 0.85. */
  threshold?: number;
  /** Minimum shared significant terms with source context. Defaults to 2. */
  minGroundingTerms?: number;
  /** Jaccard similarity that counts as a duplicate. Defaults to 0.9. */
  duplicateThreshold?: number;
  /** Jaccard similarity that requires human review. Defaults to 0.75. */
  overlapThreshold?: number;
}

const STOPWORDS = new Set([
  'na', 'ya', 'wa', 'kwa', 'katika', 'ni', 'kuwa', 'hii', 'hiyo', 'hilo', 'hizi', 'hizo',
  'kama', 'lakini', 'au', 'pia', 'zaidi', 'sana', 'hivyo', 'kutoka', 'hadi', 'bila',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were',
  'not', 'can', 'will', 'has', 'have', 'its', 'their', 'than', 'then', 'when', 'what',
]);

/** Lowercase alphanumeric terms longer than 3 characters, minus stopwords. */
export function significantTerms(text: string): string[] {
  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 3 && !STOPWORDS.has(term));
  return [...new Set(terms)];
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Confidence recurrence used by gated memory systems:
 *   start at 0.5, corroboration c <- 1 - (1 - c) * 0.3, contradiction c <- c * 0.7.
 * One corroboration yields 0.85, two yield 0.955; one contradiction from 0.95
 * drops to 0.665, which is below the default promote threshold.
 */
export function confidenceAfter(corroborations = 0, contradictions = 0): number {
  let confidence = 0.5;
  for (let i = 0; i < Math.max(0, Math.floor(corroborations)); i++) {
    confidence = 1 - (1 - confidence) * 0.3;
  }
  for (let i = 0; i < Math.max(0, Math.floor(contradictions)); i++) {
    confidence *= 0.7;
  }
  return Math.min(1, Math.max(0, confidence));
}

function requireText(value: unknown, field: string, reasons: string[]): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    reasons.push(`Sehemu "${field}" haipo au ni tupu.`);
    return null;
  }
  return value.trim();
}

export function evaluatePromotion(
  candidate: CandidateLesson,
  options: PromotionOptions = {}
): PromotionDecision {
  const threshold = options.threshold ?? 0.85;
  const minGroundingTerms = options.minGroundingTerms ?? 2;
  const duplicateThreshold = options.duplicateThreshold ?? 0.9;
  const overlapThreshold = options.overlapThreshold ?? 0.75;
  const existing = options.existing ?? [];
  const reasons: string[] = [];

  const topic = requireText(candidate?.topic, 'topic', reasons);
  const summary = requireText(candidate?.summary, 'summary', reasons);
  const content = requireText(candidate?.content, 'content', reasons);
  const sourceContext = requireText(candidate?.sourceContext, 'sourceContext', reasons);
  const expectedAnswer = requireText(candidate?.expectedAnswer, 'expectedAnswer', reasons);
  requireText(candidate?.verificationQuestion, 'verificationQuestion', reasons);
  requireText(candidate?.id, 'id', reasons);

  const confidence = confidenceAfter(candidate?.corroborations ?? 0, candidate?.contradictions ?? 0);

  if (reasons.length > 0 || !topic || !summary || !content || !sourceContext || !expectedAnswer) {
    return {
      verdict: 'reject',
      confidence,
      reasons,
      groundingTerms: [],
    };
  }

  // 1. The lesson must contain the answer it claims to teach.
  const body = `${summary} ${content}`.toLowerCase();
  if (!body.includes(expectedAnswer.toLowerCase())) {
    return {
      verdict: 'reject',
      confidence,
      reasons: ['Jibu la uthibitisho halipo ndani ya somo; somo haliwezi kuthibitisha lenyewe.'],
      groundingTerms: [],
    };
  }

  // 2. Lexical grounding against the source: a lesson that shares almost no
  //    vocabulary with its source is likely fabricated or about something else.
  const sourceTerms = new Set(significantTerms(sourceContext));
  const lessonTerms = new Set(significantTerms(`${topic} ${summary} ${content}`));
  const groundingTerms = [...lessonTerms].filter((term) => sourceTerms.has(term));
  if (groundingTerms.length < minGroundingTerms) {
    return {
      verdict: 'reject',
      confidence,
      reasons: [
        `Somo halina msingi wa kutosha kwenye chanzo (maneno ${groundingTerms.length}, yanahitajika ${minGroundingTerms}).`,
      ],
      groundingTerms,
    };
  }

  // 3. Dedup: never store the same fact twice, and flag near-duplicates.
  const contentTerms = new Set(significantTerms(content));
  let bestMatchId: string | undefined;
  let bestSimilarity = 0;
  for (const fact of existing) {
    const similarity = jaccardSimilarity(contentTerms, new Set(significantTerms(fact.content)));
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatchId = fact.id;
    }
  }

  if (bestSimilarity >= duplicateThreshold) {
    return {
      verdict: 'reject',
      confidence,
      reasons: [`Somo ni nakala ya maarifa yaliyopo (ulinganifu ${bestSimilarity.toFixed(2)}).`],
      matchedExistingId: bestMatchId,
      groundingTerms,
    };
  }

  if (bestSimilarity >= overlapThreshold) {
    return {
      verdict: 'needs_review',
      confidence,
      reasons: [`Somo linakaribiana na maarifa yaliyopo (ulinganifu ${bestSimilarity.toFixed(2)}); linahitaji ukaguzi.`],
      matchedExistingId: bestMatchId,
      groundingTerms,
    };
  }

  // 4. Confidence gate: unconfirmed lessons stay out of durable memory.
  if (confidence < threshold) {
    return {
      verdict: 'needs_review',
      confidence,
      reasons: [
        `Uhakika ${confidence.toFixed(3)} uko chini ya kiwango ${threshold}; inahitaji uthibitisho wa ziada.`,
      ],
      groundingTerms,
    };
  }

  return {
    verdict: 'promote',
    confidence,
    reasons: [
      `Uhakika ${confidence.toFixed(3)} umefikia kiwango ${threshold}.`,
      `Maneno ${groundingTerms.length} yanalingana na chanzo.`,
    ],
    groundingTerms,
  };
}
