/**
 * Matcher contract used by the offline evaluation harness.
 *
 * A matcher only ever sees request text plus *opaque* group ids of past,
 * human-approved assignments. It never sees ground-truth labels, group keys,
 * need descriptions, tags or families.
 */

export interface MatcherRequest {
  id: string;
  title: string;
  description: string;
}

/** A previously triaged request together with the (opaque) group it was approved into. */
export interface PoolEntry extends MatcherRequest {
  groupId: string;
}

/** Retrieval output: a ranked candidate group with the evidence that surfaced it. */
export interface CandidateGroup {
  groupId: string;
  score: number;
  /** Pool requests in this group that matched, best first. */
  supportingRequestIds: string[];
}

export type MatchDecision =
  | { action: 'link'; groupId: string }
  | { action: 'new_group' }
  | { action: 'abstain'; reason: string };

/** Stage C: candidate retrieval. Must not rely on anything but the inputs. */
export interface Retriever {
  readonly name: string;
  retrieve(
    query: MatcherRequest,
    pool: readonly PoolEntry[],
    limit: number,
  ): Promise<CandidateGroup[]>;
}

/** Stage D: decide among the retrieved candidates (or decline to). */
export interface Decider {
  readonly name: string;
  decide(query: MatcherRequest, candidates: readonly CandidateGroup[]): Promise<MatchDecision>;
}
