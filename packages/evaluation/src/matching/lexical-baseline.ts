import type {
  CandidateGroup,
  Decider,
  MatchDecision,
  MatcherRequest,
  PoolEntry,
  Retriever,
} from './types.js';

/**
 * NON-AI BASELINE. TF-IDF bag-of-words cosine similarity.
 *
 * Exists so that later AI stages (embeddings + LLM assessment) are compared
 * against an honest, cheap reference point rather than against nothing.
 */

const STOPWORDS = new Set(
  `a an and are as at be but by can could do does for from had has have i if in into is it its
  just me my need needs no not of on or our please pls so some that the their them then there
  these they this to too us want was we were what when where which while who why will with would
  you your also all any every get got like more much very lot lots one way able let make add`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .map((token) =>
      token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token,
    );
}

type SparseVector = Map<string, number>;

function cosine(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, weight] of a) {
    normA += weight * weight;
    const other = b.get(term);
    if (other !== undefined) dot += weight * other;
  }
  for (const weight of b.values()) normB += weight * weight;
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

export class TfIdfIndex {
  private readonly idf = new Map<string, number>();

  /** Fit inverse document frequencies on raw texts only (unsupervised; no labels). */
  constructor(corpus: readonly string[]) {
    const documentFrequency = new Map<string, number>();
    for (const text of corpus) {
      for (const term of new Set(tokenize(text))) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
    for (const [term, df] of documentFrequency) {
      this.idf.set(term, Math.log((1 + corpus.length) / (1 + df)) + 1);
    }
  }

  vectorize(text: string): SparseVector {
    const counts = new Map<string, number>();
    for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    const vector: SparseVector = new Map();
    for (const [term, count] of counts) {
      vector.set(term, count * (this.idf.get(term) ?? Math.log(2) + 1));
    }
    return vector;
  }

  similarity(a: string, b: string): number {
    return cosine(this.vectorize(a), this.vectorize(b));
  }
}

const textOf = (request: MatcherRequest) => `${request.title}. ${request.description}`;

/** Ranks pool requests by TF-IDF cosine and aggregates them to groups (max score per group). */
export class LexicalRetriever implements Retriever {
  readonly name = 'lexical-tfidf';

  constructor(private readonly index: TfIdfIndex) {}

  async retrieve(
    query: MatcherRequest,
    pool: readonly PoolEntry[],
    limit: number,
  ): Promise<CandidateGroup[]> {
    const queryVector = this.index.vectorize(textOf(query));
    const byGroup = new Map<string, { score: number; hits: { id: string; score: number }[] }>();

    for (const entry of pool) {
      if (entry.id === query.id) continue; // never compare a request with itself
      const score = cosine(queryVector, this.index.vectorize(textOf(entry)));
      if (score <= 0) continue;
      const group = byGroup.get(entry.groupId) ?? { score: 0, hits: [] };
      group.score = Math.max(group.score, score);
      group.hits.push({ id: entry.id, score });
      byGroup.set(entry.groupId, group);
    }

    return [...byGroup.entries()]
      .map(([groupId, group]) => ({
        groupId,
        score: group.score,
        supportingRequestIds: group.hits.sort((a, b) => b.score - a.score).map((hit) => hit.id),
      }))
      .sort((a, b) => b.score - a.score || a.groupId.localeCompare(b.groupId))
      .slice(0, limit);
  }
}

/** Links to the top candidate when its score clears a fixed threshold; otherwise proposes a new group. */
export class ThresholdDecider implements Decider {
  readonly name: string;

  constructor(readonly threshold: number) {
    this.name = `threshold@${threshold.toFixed(2)}`;
  }

  async decide(
    _query: MatcherRequest,
    candidates: readonly CandidateGroup[],
  ): Promise<MatchDecision> {
    const best = candidates[0];
    return best && best.score >= this.threshold
      ? { action: 'link', groupId: best.groupId }
      : { action: 'new_group' };
  }
}
