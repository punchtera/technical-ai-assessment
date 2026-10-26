/**
 * DETERMINISTIC TEST PROVIDER — NOT AI.
 *
 * A rule-based stand-in used for automated tests, offline demos and local
 * development without API keys. Every run it produces is labelled
 * `deterministic-test` in the database, API and UI. It must never be presented
 * as an AI result, and it is never selected implicitly: AI_PROVIDER must be
 * set to `deterministic-test` explicitly.
 *
 * v2 (demo-capable): light stemming, character n-gram hashing embeddings and a
 * token-overlap assessor that can return match / uncertain / no-match. It uses
 * only the text it is given — no domain synonym lists, no dataset knowledge.
 * Its thresholds were chosen on the synthetic DEV split (docs/evaluation.md).
 */
import { createHash } from 'node:crypto';
import { ASSESSMENT_SCHEMA_VERSION, type CandidateAssessment } from '../schemas/assessment.js';
import { NEED_EXTRACTION_SCHEMA_VERSION, type NeedExtraction } from '../schemas/need-extraction.js';
import type {
  CandidateAssessor,
  CandidateContext,
  Embedder,
  NeedExtractor,
  ProviderCallResult,
  ProviderRequestText,
  TriageProviders,
} from './types.js';

export const DETERMINISTIC_PROVIDER_LABEL = 'deterministic-test';
export const DETERMINISTIC_DIMENSIONS = 1024;

/** Thresholds for the overlap assessor (chosen on the dev split only). */
export const DETERMINISTIC_THRESHOLDS = {
  match: 0.5,
  highConfidence: 0.7,
  /** If the runner-up is within this margin of a match, the result is "uncertain". */
  ambiguityMargin: 0.05,
  related: 0.25,
} as const;

const STOPWORDS = new Set(
  `a an and are as at be by can for from i in is it me my of on or our please pls so that the this to we with you your
  would like need needs want add get got has have had its just than then them they their there these those when which
  who what also all any every one way able let make lot lots very much more some into out about after before over only
  same each other still really thing things something every app tasklane`
    .split(/\s+/)
    .filter(Boolean),
);

/** Very light suffix stemming so "notifications" ≈ "notification", "emails" ≈ "email". */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es') && /(ch|sh|x|ss)es$/.test(token))
    return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** First sentence of the text that is at least `min` characters long, as an exact substring. */
function firstSentence(text: string, min = 10): string | null {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const sentence = (match ? match[0] : text).trim();
  return sentence.length >= min ? sentence.slice(0, 380) : null;
}

export class DeterministicNeedExtractor implements NeedExtractor {
  readonly model = 'deterministic-test-extractor-v2';

  async extract(request: ProviderRequestText): Promise<ProviderCallResult<NeedExtraction>> {
    const sentence = firstSentence(request.description);
    // Rule: title + first sentence. A real model would abstract the need; this does not.
    const needStatement = `${request.title.trim()}. ${sentence ?? request.description.trim()}`
      .slice(0, 400)
      .padEnd(10, '.');
    const evidence = [
      ...(request.title.trim().length >= 3
        ? [{ field: 'title' as const, quote: request.title.trim() }]
        : []),
      ...(sentence ? [{ field: 'description' as const, quote: sentence }] : []),
    ];
    const contentTokens = new Set(tokens(`${request.title} ${request.description}`));
    const raw: NeedExtraction = {
      schemaVersion: NEED_EXTRACTION_SCHEMA_VERSION,
      needStatement,
      proposedSolution: null,
      affectedUsers: null,
      contextDetails: [],
      evidence:
        evidence.length > 0
          ? evidence
          : [{ field: 'description', quote: request.description.slice(0, 200) }],
      clarity: contentTokens.size < 4 ? 'vague' : 'clear',
      ambiguityNote:
        contentTokens.size < 4
          ? 'Very few content words; the need cannot be identified reliably.'
          : null,
    };
    return { raw, model: this.model };
  }
}

function hashInto(vector: number[], feature: string, weight: number): void {
  const hash = createHash('sha1').update(feature).digest();
  const index = hash.readUInt32BE(0) % DETERMINISTIC_DIMENSIONS;
  vector[index]! += (hash[4]! % 2 === 0 ? 1 : -1) * weight;
}

/** Feature hashing of stemmed words plus character 4-grams, L2-normalised. Deterministic and offline. */
export class DeterministicEmbedder implements Embedder {
  readonly space = {
    provider: DETERMINISTIC_PROVIDER_LABEL,
    model: 'hashing-ngram-v2',
    dimensions: DETERMINISTIC_DIMENSIONS,
  };

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(DETERMINISTIC_DIMENSIONS).fill(0);
      for (const token of tokens(text)) {
        hashInto(vector, `w:${token}`, 1);
        const padded = `_${token}_`;
        for (let i = 0; i + 4 <= padded.length; i++)
          hashInto(vector, `g:${padded.slice(i, i + 4)}`, 0.35);
      }
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
      return vector.map((v) => v / norm);
    });
  }
}

/** Overlap coefficient |A∩B| / min(|A|,|B|) over stemmed content words. */
function overlap(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
  const shared = [...a].filter((t) => b.has(t));
  return { score: shared.length / Math.min(a.size, b.size), shared };
}

/** Token-overlap judgement over the supplied candidates only. */
export class DeterministicAssessor implements CandidateAssessor {
  readonly model = 'deterministic-test-assessor-v2';

  constructor(private readonly thresholds = DETERMINISTIC_THRESHOLDS) {}

  async assess(
    request: ProviderRequestText,
    need: NeedExtraction,
    candidates: CandidateContext[],
  ): Promise<ProviderCallResult<CandidateAssessment>> {
    const requestTokens = new Set(tokens(`${request.title} ${request.description}`));
    const scored = candidates
      .map((candidate) => {
        const best = candidate.members
          .map((member) => ({
            member,
            ...overlap(requestTokens, new Set(tokens(`${member.title} ${member.description}`))),
          }))
          .sort((a, b) => b.score - a.score)[0];
        return { candidate, best, score: best?.score ?? 0 };
      })
      .sort((a, b) => b.score - a.score);

    const t = this.thresholds;
    const judgements = scored.map(({ candidate, best, score }) => ({
      candidateRef: candidate.ref,
      relation:
        score >= t.match
          ? ('same_need' as const)
          : score >= t.related
            ? ('related_different_need' as const)
            : ('unrelated' as const),
      similarities: `${best?.shared.length ? `shared words: ${best.shared.slice(0, 6).join(', ')}` : 'no shared content words'}; word overlap ${score.toFixed(2)} (deterministic test provider)`,
      differences: '',
    }));

    const [top, runnerUp] = scored;
    const base = { schemaVersion: ASSESSMENT_SCHEMA_VERSION, candidates: judgements } as const;
    void need;

    if (top && top.best && top.score >= t.match) {
      if (runnerUp && runnerUp.score >= t.match && top.score - runnerUp.score < t.ambiguityMargin) {
        return {
          model: this.model,
          raw: {
            ...base,
            result: {
              outcome: 'uncertain',
              rationale: `Deterministic test provider: two groups overlap almost equally (${top.score.toFixed(2)} vs ${runnerUp.score.toFixed(2)}). Not an AI judgement.`,
              possibleCandidateRefs: [top.candidate.ref, runnerUp.candidate.ref],
            },
          },
        };
      }
      return {
        model: this.model,
        raw: {
          ...base,
          result: {
            outcome: 'match',
            candidateRef: top.candidate.ref,
            confidence: top.score >= t.highConfidence ? 'high' : 'medium',
            rationale: `Deterministic test provider: ${Math.round(top.score * 100)}% of the shorter text's content words also appear in an approved member (${top.best.shared.slice(0, 5).join(', ')}). Not an AI judgement.`,
            evidence: [
              { ref: 'request.title', quote: request.title },
              { ref: top.best.member.ref, quote: top.best.member.title },
            ],
          },
        },
      };
    }

    return {
      model: this.model,
      raw: {
        ...base,
        result: {
          outcome: 'no_match',
          rationale: top
            ? `Deterministic test provider: the closest group shares only ${Math.round(top.score * 100)}% of content words (below ${Math.round(t.match * 100)}%). Not an AI judgement.`
            : 'Deterministic test provider: no candidates. Not an AI judgement.',
        },
      },
    };
  }
}

export function createDeterministicTestProviders(): TriageProviders {
  return {
    label: DETERMINISTIC_PROVIDER_LABEL,
    isTestProvider: true,
    extractor: new DeterministicNeedExtractor(),
    embedder: new DeterministicEmbedder(),
    assessor: new DeterministicAssessor(),
  };
}
