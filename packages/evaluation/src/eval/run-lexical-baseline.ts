import type { Label, Manifest, Splits, SplitName, SyntheticRequest } from '../dataset/schema.js';
import { LexicalRetriever, TfIdfIndex, ThresholdDecider } from '../matching/lexical-baseline.js';
import {
  computeDecisionMetrics,
  computeRetrievalMetrics,
  hardNegativeMetrics,
  metricsByTag,
  type DecisionMetrics,
  type RetrievalMetrics,
} from './metrics.js';
import {
  applyDecider,
  simulateRetrieval,
  type DecisionRecord,
  type RetrievalTrace,
} from './simulate.js';
import { selectThreshold, THRESHOLD_GRID, type ThresholdSelection } from './threshold.js';

export const MAX_CANDIDATES = 10;

export interface SplitReport {
  requests: number;
  retrieval: RetrievalMetrics;
  decision: DecisionMetrics;
  hardNegatives: DecisionMetrics;
  byTag: Record<string, DecisionMetrics>;
  /** A few concrete errors for manual inspection (titles only; harness-side). */
  examples: {
    wrongLinks: { requestId: string; title: string; trueGroup: string; topScore: number }[];
    missedLinks: { requestId: string; title: string; trueGroup: string; topScore: number | null }[];
  };
}

export interface EvaluationReport {
  generatedAt: string;
  matcher: {
    retriever: string;
    decider: string;
    kind: 'non-ai-baseline';
    candidateLimit: number;
    threshold: number;
    selection: ThresholdSelection | { rule: 'fixed-by-flag' };
  };
  dataset: Pick<Manifest, 'datasetVersion' | 'seed' | 'counts'>;
  splits: Record<SplitName, SplitReport>;
  limitations: string[];
}

interface Inputs {
  requests: SyntheticRequest[];
  labels: Label[];
  splits: Splits;
  manifest: Manifest;
  k: number;
  threshold?: number;
}

async function retrieveSplit(requests: SyntheticRequest[], labels: Map<string, Label>) {
  // IDF is fitted on the split's raw texts (unsupervised; no labels involved).
  const index = new TfIdfIndex(requests.map((r) => `${r.title}. ${r.description}`));
  return simulateRetrieval({ requests, labels }, new LexicalRetriever(index), MAX_CANDIDATES);
}

function examplesFrom(records: DecisionRecord[], requestsById: Map<string, SyntheticRequest>) {
  const describe = (r: DecisionRecord) => ({
    requestId: r.requestId,
    title: requestsById.get(r.requestId)!.title,
    trueGroup: r.label.groupKey,
  });
  return {
    wrongLinks: records
      .filter((r) => r.outcome === 'wrong_link')
      .slice(0, 8)
      .map((r) => ({ ...describe(r), topScore: round(r.candidates[0]?.score ?? 0) })),
    missedLinks: records
      .filter((r) => r.outcome === 'missed_link')
      .slice(0, 8)
      .map((r) => ({
        ...describe(r),
        topScore: r.candidates[0] ? round(r.candidates[0].score) : null,
      })),
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export async function runLexicalBaseline(inputs: Inputs): Promise<EvaluationReport> {
  const labelsById = new Map(inputs.labels.map((l) => [l.requestId, l]));
  const requestsById = new Map(inputs.requests.map((r) => [r.id, r]));
  const subset = (ids: string[]) => ids.map((id) => requestsById.get(id)!);

  const retrieved: Record<
    SplitName,
    { traces: RetrievalTrace[]; groupFamilies: Map<string, string> }
  > = {
    dev: await retrieveSplit(subset(inputs.splits.dev.requestIds), labelsById),
    test: await retrieveSplit(subset(inputs.splits.test.requestIds), labelsById),
  };

  const decide = (split: SplitName, threshold: number) =>
    applyDecider(
      retrieved[split].traces,
      new ThresholdDecider(threshold),
      inputs.k,
      retrieved[split].groupFamilies,
      requestsById,
    );

  // Tune on dev only; test stays held out.
  let threshold: number;
  let selection: EvaluationReport['matcher']['selection'];
  if (inputs.threshold !== undefined) {
    threshold = inputs.threshold;
    selection = { rule: 'fixed-by-flag' };
  } else {
    const sweep = [];
    for (const t of THRESHOLD_GRID)
      sweep.push({ threshold: t, metrics: computeDecisionMetrics(await decide('dev', t)) });
    selection = selectThreshold(sweep);
    threshold = selection.threshold;
  }

  const splitReport = async (split: SplitName): Promise<SplitReport> => {
    const records = await decide(split, threshold);
    return {
      requests: records.length,
      retrieval: computeRetrievalMetrics(retrieved[split].traces),
      decision: computeDecisionMetrics(records),
      hardNegatives: hardNegativeMetrics(records),
      byTag: metricsByTag(records),
      examples: examplesFrom(records, requestsById),
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    matcher: {
      retriever: 'lexical-tfidf',
      decider: `threshold@${threshold.toFixed(2)}`,
      kind: 'non-ai-baseline',
      candidateLimit: inputs.k,
      threshold,
      selection,
    },
    dataset: {
      datasetVersion: inputs.manifest.datasetVersion,
      seed: inputs.manifest.seed,
      counts: inputs.manifest.counts,
    },
    splits: { dev: await splitReport('dev'), test: await splitReport('test') },
    limitations: [
      'Synthetic data written for evaluation; results do not describe real customer behaviour.',
      'Oracle review is simulated: earlier requests are assumed correctly grouped, so matching errors do not compound as they would in production.',
      'Dev and test are small (≈100 requests each); a handful of requests moves precision/recall by several points.',
      'The threshold is tuned on dev and applied unchanged to test.',
    ],
  };
}
