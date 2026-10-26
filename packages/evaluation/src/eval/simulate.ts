import type { Label, SyntheticRequest } from '../dataset/schema.js';
import type {
  CandidateGroup,
  Decider,
  MatchDecision,
  PoolEntry,
  Retriever,
} from '../matching/types.js';

/**
 * Streaming simulation of intake triage.
 *
 * Requests are processed in arrival order. Each request is matched against
 * the requests that arrived *before* it, which are assumed to have been
 * correctly approved into groups by a product manager (oracle review). The
 * matcher sees only text and opaque group ids; labels stay inside the harness.
 */

export type GoldAction = 'link' | 'new_group';

export interface RetrievalTrace {
  requestId: string;
  goldAction: GoldAction;
  /** Opaque ids of groups a reviewer could correctly link this request to. */
  acceptableGroupIds: string[];
  candidates: CandidateGroup[];
  label: Label;
  /** True when a related but different group (same family) already existed: a hard negative was available. */
  relatedGroupAvailable: boolean;
}

export type Outcome = 'correct_link' | 'wrong_link' | 'correct_new' | 'missed_link' | 'abstain';

export interface DecisionRecord extends RetrievalTrace {
  decision: MatchDecision;
  outcome: Outcome;
  /** Harness-side annotation of the predicted group, for hard-negative analysis. */
  predictedFamily?: string;
}

export interface SimulationInput {
  requests: readonly SyntheticRequest[];
  labels: ReadonlyMap<string, Label>;
}

/** Stage C over the whole stream. Retrieval is independent of the decision threshold. */
export async function simulateRetrieval(
  input: SimulationInput,
  retriever: Retriever,
  maxCandidates: number,
): Promise<{ traces: RetrievalTrace[]; groupFamilies: Map<string, string> }> {
  const ordered = [...input.requests].sort((a, b) => a.arrivalIndex - b.arrivalIndex);
  const pool: PoolEntry[] = [];
  const groupIdByKey = new Map<string, string>();
  const groupFamilies = new Map<string, string>();
  const familyByKey = new Map<string, string>();
  const traces: RetrievalTrace[] = [];

  for (const request of ordered) {
    const label = input.labels.get(request.id);
    if (!label) throw new Error(`missing label for ${request.id}`);

    const query = { id: request.id, title: request.title, description: request.description };
    const candidates = await retriever.retrieve(query, pool, maxCandidates);

    const acceptableGroupIds = [label.groupKey, ...label.acceptableGroupKeys]
      .map((key) => groupIdByKey.get(key))
      .filter((id): id is string => id !== undefined);

    traces.push({
      requestId: request.id,
      goldAction: groupIdByKey.has(label.groupKey) ? 'link' : 'new_group',
      acceptableGroupIds,
      candidates,
      label,
      relatedGroupAvailable: [...groupIdByKey.keys()].some(
        (key) =>
          key !== label.groupKey &&
          !label.acceptableGroupKeys.includes(key) &&
          familyByKey.get(key) === label.family,
      ),
    });

    // Oracle review: the request joins its true group (created on first sight).
    let groupId = groupIdByKey.get(label.groupKey);
    if (!groupId) {
      groupId = `G${String(groupIdByKey.size + 1).padStart(3, '0')}`;
      groupIdByKey.set(label.groupKey, groupId);
      groupFamilies.set(groupId, label.family);
      familyByKey.set(label.groupKey, label.family);
    }
    pool.push({ ...query, groupId });
  }

  return { traces, groupFamilies };
}

export function classify(trace: RetrievalTrace, decision: MatchDecision): Outcome {
  if (decision.action === 'abstain') return 'abstain';
  if (decision.action === 'new_group')
    return trace.goldAction === 'new_group' ? 'correct_new' : 'missed_link';
  return trace.acceptableGroupIds.includes(decision.groupId) ? 'correct_link' : 'wrong_link';
}

/** Stage D over pre-computed traces; the decider sees only the top-k candidates. */
export async function applyDecider(
  traces: readonly RetrievalTrace[],
  decider: Decider,
  k: number,
  groupFamilies: ReadonlyMap<string, string>,
  requestsById: ReadonlyMap<string, SyntheticRequest>,
): Promise<DecisionRecord[]> {
  const records: DecisionRecord[] = [];
  for (const trace of traces) {
    const request = requestsById.get(trace.requestId)!;
    const decision = await decider.decide(
      { id: request.id, title: request.title, description: request.description },
      trace.candidates.slice(0, k),
    );
    records.push({
      ...trace,
      decision,
      outcome: classify(trace, decision),
      ...(decision.action === 'link'
        ? { predictedFamily: groupFamilies.get(decision.groupId) }
        : {}),
    });
  }
  return records;
}
