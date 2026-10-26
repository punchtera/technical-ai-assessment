import {
  aggregateCandidates,
  cosineSimilarity,
  errorCodeFor,
  redactPersonalData,
  runTriage,
  TriageStageError,
  type MemberHit,
  type RetrievalParams,
  type TriageProviders,
} from '@fis/triage-core';
import type { Label, Manifest, SplitName, Splits, SyntheticRequest } from '../dataset/schema.js';
import type { CandidateGroup, MatchDecision } from '../matching/types.js';
import {
  computeDecisionMetrics,
  computeRetrievalMetrics,
  hardNegativeMetrics,
  metricsByTag,
} from './metrics.js';
import {
  examplesFrom,
  type EvaluationReport,
  type PipelineExtras,
  type SplitReport,
} from './run-lexical-baseline.js';
import { classify, type DecisionRecord, type RetrievalTrace } from './simulate.js';

/**
 * Offline evaluation of the PRODUCTION triage pipeline (@fis/triage-core):
 * the same extraction, retrieval aggregation, assessment and proposal rules
 * the API runs, with pgvector replaced by in-memory cosine similarity.
 *
 * Streaming oracle simulation as in simulate.ts: each request is triaged
 * against earlier requests of its split that a reviewer has (by assumption)
 * grouped correctly. When a new group is "created", its title and need
 * statement come from the first member's own title and AI-extracted need —
 * never from the ground-truth catalog — so labels cannot leak into prompts.
 */

interface PoolMember {
  requestId: string;
  groupId: string;
  embedding: number[];
  title: string;
  description: string;
}

interface SimGroup {
  id: string;
  title: string;
  needStatement: string;
  family: string;
}

/** How a proposal maps onto the harness decision space (strict reading). */
function strictDecision(action: string, groupId: string | null): MatchDecision {
  if (action === 'link_existing' && groupId) return { action: 'link', groupId };
  if (action === 'create_group') return { action: 'new_group' };
  return { action: 'abstain', reason: 'needs_review' };
}

export interface PipelineRunOptions {
  providers: TriageProviders;
  kind: 'deterministic-test' | 'ai';
  retrievalParams: RetrievalParams;
  /** Optional cap per split, for cheap smoke runs against paid providers. */
  limitPerSplit?: number;
  onProgress?: (split: SplitName, done: number, total: number) => void;
}

async function evaluateSplit(
  split: SplitName,
  requests: SyntheticRequest[],
  labels: Map<string, Label>,
  options: PipelineRunOptions,
): Promise<{ records: DecisionRecord[]; extras: PipelineExtras; followed: DecisionRecord[] }> {
  const ordered = [...requests]
    .sort((a, b) => a.arrivalIndex - b.arrivalIndex)
    .slice(0, options.limitPerSplit);
  const pool: PoolMember[] = [];
  const groups = new Map<string, SimGroup>();
  const groupIdByKey = new Map<string, string>();
  const groupFamilies = new Map<string, string>();
  const records: DecisionRecord[] = [];
  const followed: DecisionRecord[] = [];
  const extras: PipelineExtras = {
    suggestionsIfFollowed: computeDecisionMetrics([]),
    proposalActions: { link_existing: 0, create_group: 0, needs_review: 0 },
    failures: { count: 0, byCode: {} },
    invalidQuotes: { extraction: 0, assessment: 0 },
    flags: {},
    providerCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  for (const [index, request] of ordered.entries()) {
    const label = labels.get(request.id)!;
    // Same privacy policy as the API: providers only see redacted text.
    const text = {
      title: redactPersonalData(request.title).text,
      description: redactPersonalData(request.description).text,
    };
    const acceptableGroupIds = [label.groupKey, ...label.acceptableGroupKeys]
      .map((key) => groupIdByKey.get(key))
      .filter((id): id is string => id !== undefined);
    const goldAction = groupIdByKey.has(label.groupKey) ? 'link' : 'new_group';
    const relatedGroupAvailable = [...groupIdByKey.entries()].some(
      ([key, id]) =>
        key !== label.groupKey &&
        !label.acceptableGroupKeys.includes(key) &&
        groups.get(id)?.family === label.family,
    );

    let allHits: MemberHit[] = [];
    let decision: MatchDecision;
    let followedDecision: MatchDecision;
    let embedding: number[] | null = null;
    let extractedNeed: string | null = null;

    try {
      const outcome = await runTriage(
        { requestId: request.id, text },
        {
          providers: options.providers,
          retrievalParams: options.retrievalParams,
          findNearestMembers: async (vector, excludeId) => {
            allHits = pool
              .filter((m) => m.requestId !== excludeId)
              .map((m) => ({
                requestId: m.requestId,
                groupId: m.groupId,
                similarity: cosineSimilarity(vector, m.embedding),
              }))
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 30);
            return allHits;
          },
          loadCandidateDetails: async (candidates) =>
            candidates.map((c) => {
              const group = groups.get(c.groupId)!;
              return {
                groupId: c.groupId,
                title: group.title,
                needStatement: group.needStatement,
                members: c.memberHits.map((hit) => {
                  const member = pool.find((m) => m.requestId === hit.requestId)!;
                  return {
                    requestId: member.requestId,
                    title: member.title,
                    description: member.description,
                  };
                }),
              };
            }),
        },
      );
      embedding = outcome.embedding;
      extractedNeed = outcome.extraction.needStatement;
      const { proposal } = outcome;
      extras.proposalActions[proposal.action] += 1;
      for (const flag of proposal.flags) extras.flags[flag] = (extras.flags[flag] ?? 0) + 1;
      extras.invalidQuotes.extraction += outcome.extractionQuoteChecks.filter(
        (c) => !c.valid,
      ).length;
      extras.invalidQuotes.assessment += outcome.assessmentQuoteChecks.filter(
        (c) => !c.valid,
      ).length;
      extras.providerCalls += outcome.providerCalls;
      for (const u of outcome.usage) {
        extras.usage.inputTokens += u.inputTokens;
        extras.usage.outputTokens += u.outputTokens;
      }
      const groupId =
        proposal.action === 'link_existing'
          ? proposal.groupId
          : proposal.action === 'needs_review'
            ? proposal.suggestedGroupId
            : null;
      decision = strictDecision(proposal.action, groupId);
      followedDecision =
        proposal.action === 'needs_review'
          ? groupId
            ? { action: 'link', groupId }
            : { action: 'new_group' }
          : decision;
    } catch (error) {
      const code = errorCodeFor(error instanceof TriageStageError ? error.cause : error);
      extras.failures.count += 1;
      extras.failures.byCode[code] = (extras.failures.byCode[code] ?? 0) + 1;
      decision = { action: 'abstain', reason: `error:${code}` };
      followedDecision = decision;
    }

    // Retrieval quality is measured on the full ranked list (up to 10 groups), independent of the floor.
    const ranked: CandidateGroup[] = aggregateCandidates(allHits, {
      candidateLimit: 10,
      minSimilarity: -1,
      membersPerCandidate: 3,
    }).map((c) => ({
      groupId: c.groupId,
      score: c.similarity,
      supportingRequestIds: c.memberHits.map((m) => m.requestId),
    }));
    const trace: RetrievalTrace = {
      requestId: request.id,
      goldAction,
      acceptableGroupIds,
      candidates: ranked,
      label,
      relatedGroupAvailable,
    };
    const withOutcome = (d: MatchDecision): DecisionRecord => ({
      ...trace,
      decision: d,
      outcome: classify(trace, d),
      ...(d.action === 'link' ? { predictedFamily: groupFamilies.get(d.groupId) } : {}),
    });
    records.push(withOutcome(decision));
    followed.push(withOutcome(followedDecision));

    // Oracle review: the request joins its true group. A newly created group is
    // titled from the request itself (as a reviewer would, prefilled by the AI).
    let groupId = groupIdByKey.get(label.groupKey);
    if (!groupId) {
      groupId = `G${String(groupIdByKey.size + 1).padStart(3, '0')}`;
      groupIdByKey.set(label.groupKey, groupId);
      groupFamilies.set(groupId, label.family);
      groups.set(groupId, {
        id: groupId,
        title: text.title,
        needStatement: extractedNeed ?? text.description,
        family: label.family,
      });
    }
    if (embedding)
      pool.push({
        requestId: request.id,
        groupId,
        embedding,
        title: text.title,
        description: text.description,
      });
    options.onProgress?.(split, index + 1, ordered.length);
  }

  extras.suggestionsIfFollowed = computeDecisionMetrics(followed);
  return { records, extras, followed };
}

export async function runPipelineEvaluation(
  inputs: { requests: SyntheticRequest[]; labels: Label[]; splits: Splits; manifest: Manifest },
  options: PipelineRunOptions,
): Promise<EvaluationReport> {
  const labelsById = new Map(inputs.labels.map((l) => [l.requestId, l]));
  const requestsById = new Map(inputs.requests.map((r) => [r.id, r]));
  const subset = (ids: string[]) => ids.map((id) => requestsById.get(id)!);

  const report = async (split: SplitName): Promise<SplitReport> => {
    const { records, extras } = await evaluateSplit(
      split,
      subset(inputs.splits[split].requestIds),
      labelsById,
      options,
    );
    return {
      requests: records.length,
      retrieval: computeRetrievalMetrics(records),
      decision: computeDecisionMetrics(records),
      hardNegatives: hardNegativeMetrics(records),
      byTag: metricsByTag(records),
      pipeline: extras,
      examples: examplesFrom(records, requestsById),
    };
  };

  const p = options.providers;
  const label = options.kind === 'ai' ? 'AI pipeline' : 'DETERMINISTIC TEST PROVIDER (not AI)';
  return {
    generatedAt: new Date().toISOString(),
    matcher: {
      name: `pipeline:${p.label}`,
      kind: options.kind,
      summary: [
        `Matcher: triage pipeline with ${p.label} — ${label}`,
        `Models: extraction=${p.extractor.model}, assessment=${p.assessor.model}, embedding=${p.embedder.space.model}`,
        `Retrieval: top-${options.retrievalParams.candidateLimit} groups, min similarity ${options.retrievalParams.minSimilarity}` +
          (options.limitPerSplit ? `; first ${options.limitPerSplit} requests per split only` : ''),
        'Decision: link_existing = link, create_group = new group, needs_review = abstain (strict)',
      ],
      details: {
        provider: p.label,
        retrievalParams: options.retrievalParams,
        limitPerSplit: options.limitPerSplit ?? null,
      },
    },
    dataset: {
      datasetVersion: inputs.manifest.datasetVersion,
      seed: inputs.manifest.seed,
      counts: inputs.manifest.counts,
    },
    splits: { dev: await report('dev'), test: await report('test') },
    limitations: [
      'Synthetic data written for evaluation; results do not describe real customer behaviour.',
      'Oracle review is simulated: earlier requests are assumed correctly grouped, so errors do not compound.',
      'Group titles/need statements in the simulation come from the first member request, not from a human reviewer.',
      'Small splits (≈100 requests); one request moves precision/recall by about one point.',
      ...(options.kind === 'deterministic-test'
        ? ['Deterministic test provider: measures the pipeline mechanics, NOT AI quality.']
        : []),
    ],
  };
}
