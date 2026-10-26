import type { DecisionRecord, RetrievalTrace } from './simulate.js';

/**
 * Metric definitions (evaluation unit = one incoming request):
 *
 * - A *gold link* request has at least one earlier request with the same
 *   ground-truth need group; the correct action is to link it.
 * - A *gold new-group* request is the first of its group in the stream.
 * - A predicted link is correct if it targets the true group or a group listed
 *   as `acceptableGroupKeys` (requests with several defensible matches).
 *
 * precision = correct links / predicted links
 * recall    = gold-link requests linked to an acceptable group / gold-link requests
 * Abstentions are not links: they lower recall, never precision, and are
 * reported separately because they hand work back to the reviewer.
 */
export interface DecisionMetrics {
  requests: number;
  goldLinks: number;
  goldNewGroups: number;
  predictedLinks: number;
  correctLinks: number;
  /** False positives: links to a group that does not express the request's need. */
  wrongLinks: number;
  /** Of the false positives, how many picked a related group in the same family (hard negatives). */
  wrongLinksWithinFamily: number;
  wrongLinksCrossFamily: number;
  /** False negatives: gold-link requests not linked to an acceptable group. */
  missedLinks: number;
  correctNewGroups: number;
  abstentions: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  newGroupAccuracy: number | null;
  abstentionRate: number | null;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export function computeDecisionMetrics(records: readonly DecisionRecord[]): DecisionMetrics {
  const goldLinks = records.filter((r) => r.goldAction === 'link');
  const goldNew = records.filter((r) => r.goldAction === 'new_group');
  const predictedLinks = records.filter((r) => r.decision.action === 'link');
  const correctLinks = records.filter((r) => r.outcome === 'correct_link');
  const wrong = records.filter((r) => r.outcome === 'wrong_link');
  const wrongWithinFamily = wrong.filter((r) => r.predictedFamily === r.label.family).length;
  const recalled = goldLinks.filter((r) => r.outcome === 'correct_link').length;

  const precision = ratio(correctLinks.length, predictedLinks.length);
  const recall = ratio(recalled, goldLinks.length);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);

  return {
    requests: records.length,
    goldLinks: goldLinks.length,
    goldNewGroups: goldNew.length,
    predictedLinks: predictedLinks.length,
    correctLinks: correctLinks.length,
    wrongLinks: wrong.length,
    wrongLinksWithinFamily: wrongWithinFamily,
    wrongLinksCrossFamily: wrong.length - wrongWithinFamily,
    missedLinks: goldLinks.length - recalled,
    correctNewGroups: records.filter((r) => r.outcome === 'correct_new').length,
    abstentions: records.filter((r) => r.outcome === 'abstain').length,
    precision,
    recall,
    f1,
    newGroupAccuracy: ratio(
      records.filter((r) => r.outcome === 'correct_new').length,
      goldNew.length,
    ),
    abstentionRate: ratio(records.filter((r) => r.outcome === 'abstain').length, records.length),
  };
}

export interface RetrievalMetrics {
  goldLinks: number;
  /** recall@k: share of gold-link requests with an acceptable group among the top-k candidates. */
  recallAtK: Record<number, number | null>;
  meanReciprocalRank: number | null;
  /** Gold-link requests for which retrieval returned nothing at all. */
  emptyCandidateLists: number;
}

export function computeRetrievalMetrics(
  traces: readonly RetrievalTrace[],
  ks: readonly number[] = [1, 3, 5, 10],
): RetrievalMetrics {
  const goldLinks = traces.filter((t) => t.goldAction === 'link');
  const rankOf = (trace: RetrievalTrace) =>
    trace.candidates.findIndex((candidate) => trace.acceptableGroupIds.includes(candidate.groupId));

  const recallAtK: Record<number, number | null> = {};
  for (const k of ks) {
    recallAtK[k] = ratio(
      goldLinks.filter((t) => {
        const rank = rankOf(t);
        return rank >= 0 && rank < k;
      }).length,
      goldLinks.length,
    );
  }

  const reciprocal = goldLinks.map((t) => {
    const rank = rankOf(t);
    return rank >= 0 ? 1 / (rank + 1) : 0;
  });

  return {
    goldLinks: goldLinks.length,
    recallAtK,
    meanReciprocalRank:
      reciprocal.length === 0 ? null : reciprocal.reduce((a, b) => a + b, 0) / reciprocal.length,
    emptyCandidateLists: goldLinks.filter((t) => t.candidates.length === 0).length,
  };
}

/** Decision metrics for each ground-truth tag (ambiguous, terse, hard_wording, …). */
export function metricsByTag(records: readonly DecisionRecord[]): Record<string, DecisionMetrics> {
  const tags = new Set(records.flatMap((r) => r.label.tags));
  return Object.fromEntries(
    [...tags]
      .sort()
      .map((tag) => [
        tag,
        computeDecisionMetrics(records.filter((r) => r.label.tags.includes(tag))),
      ]),
  );
}

/**
 * Hard-negative view: requests that arrived when a related-but-different group
 * from the same family was already in the pool, so a plausible wrong match existed.
 */
export function hardNegativeMetrics(records: readonly DecisionRecord[]): DecisionMetrics {
  return computeDecisionMetrics(records.filter((r) => r.relatedGroupAvailable));
}
