/** A nearest-neighbour hit: one approved group member and its cosine similarity to the query. */
export interface MemberHit {
  requestId: string;
  groupId: string;
  similarity: number;
}

export interface RetrievedCandidate {
  groupId: string;
  /** Best similarity among the group's members. */
  similarity: number;
  /** Members that produced hits, best first. */
  memberHits: { requestId: string; similarity: number }[];
}

export interface RetrievalParams {
  /** Maximum number of candidate groups passed to the assessor. */
  candidateLimit: number;
  /** Groups whose best member is below this cosine similarity are dropped. */
  minSimilarity: number;
  /** Supporting members kept per group (shown to the assessor and reviewer). */
  membersPerCandidate: number;
}

export const DEFAULT_RETRIEVAL_PARAMS: RetrievalParams = {
  candidateLimit: 5,
  minSimilarity: 0.25,
  membersPerCandidate: 3,
};

/**
 * Similarity strategy: nearest approved member requests → group by need
 * group → score each group by its best member (max similarity) → keep groups
 * above the floor → top `candidateLimit`. Retrieval only proposes candidates;
 * the final match decision belongs to the assessor and the reviewer.
 */
export function aggregateCandidates(
  hits: readonly MemberHit[],
  params: RetrievalParams,
  excludeRequestId?: string,
): RetrievedCandidate[] {
  const byGroup = new Map<string, RetrievedCandidate>();
  for (const hit of hits) {
    if (hit.requestId === excludeRequestId) continue; // never compare a request with itself
    if (!Number.isFinite(hit.similarity)) continue;
    const group = byGroup.get(hit.groupId) ?? {
      groupId: hit.groupId,
      similarity: -Infinity,
      memberHits: [],
    };
    group.similarity = Math.max(group.similarity, hit.similarity);
    group.memberHits.push({ requestId: hit.requestId, similarity: hit.similarity });
    byGroup.set(hit.groupId, group);
  }
  return [...byGroup.values()]
    .filter((group) => group.similarity >= params.minSimilarity)
    .map((group) => ({
      ...group,
      memberHits: group.memberHits
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, params.membersPerCandidate),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.groupId.localeCompare(b.groupId))
    .slice(0, params.candidateLimit);
}

/** Cosine similarity for in-memory retrieval (offline evaluation). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
