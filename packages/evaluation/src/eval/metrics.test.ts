import { describe, expect, it } from 'vitest';
import type { Label } from '../dataset/schema.js';
import type { MatchDecision } from '../matching/types.js';
import {
  computeDecisionMetrics,
  computeRetrievalMetrics,
  hardNegativeMetrics,
  metricsByTag,
} from './metrics.js';
import { classify, type DecisionRecord, type GoldAction } from './simulate.js';
import { selectThreshold } from './threshold.js';

const label = (overrides: Partial<Label> = {}): Label => ({
  requestId: 'r',
  groupKey: 'g-a',
  family: 'f',
  acceptableGroupKeys: [],
  tags: ['paraphrase'],
  ...overrides,
});

function record(
  goldAction: GoldAction,
  acceptableGroupIds: string[],
  decision: MatchDecision,
  extra: Partial<DecisionRecord> = {},
): DecisionRecord {
  const base = {
    requestId: `r${Math.random()}`,
    goldAction,
    acceptableGroupIds,
    candidates: [],
    label: label(),
    relatedGroupAvailable: false,
  };
  return { ...base, decision, outcome: classify(base, decision), ...extra };
}

describe('classify', () => {
  it('maps decisions to outcomes', () => {
    expect(record('link', ['G1'], { action: 'link', groupId: 'G1' }).outcome).toBe('correct_link');
    expect(record('link', ['G1'], { action: 'link', groupId: 'G2' }).outcome).toBe('wrong_link');
    expect(record('link', ['G1'], { action: 'new_group' }).outcome).toBe('missed_link');
    expect(record('new_group', [], { action: 'new_group' }).outcome).toBe('correct_new');
    expect(record('new_group', [], { action: 'link', groupId: 'G9' }).outcome).toBe('wrong_link');
    expect(record('link', ['G1'], { action: 'abstain', reason: 'unsure' }).outcome).toBe('abstain');
  });

  it('accepts a link to an alternative group listed as acceptable', () => {
    // Gold primary group not yet in the pool, but an acceptable alternative is.
    expect(record('new_group', ['G7'], { action: 'link', groupId: 'G7' }).outcome).toBe(
      'correct_link',
    );
  });
});

describe('computeDecisionMetrics', () => {
  it('computes precision, recall, F1 and error counts from hand-checked cases', () => {
    const records = [
      record('link', ['G1'], { action: 'link', groupId: 'G1' }), // TP
      record('link', ['G1'], { action: 'link', groupId: 'G1' }), // TP
      record('link', ['G1'], { action: 'link', groupId: 'G2' }), // FP + FN
      record('link', ['G1'], { action: 'new_group' }), // FN
      record('link', ['G1'], { action: 'abstain', reason: 'x' }), // FN (abstain)
      record('new_group', [], { action: 'new_group' }), // correct new
      record('new_group', [], { action: 'link', groupId: 'G3' }), // FP
    ];
    const m = computeDecisionMetrics(records);
    expect(m.predictedLinks).toBe(4);
    expect(m.correctLinks).toBe(2);
    expect(m.wrongLinks).toBe(2);
    expect(m.goldLinks).toBe(5);
    expect(m.missedLinks).toBe(3);
    expect(m.precision).toBeCloseTo(2 / 4);
    expect(m.recall).toBeCloseTo(2 / 5);
    expect(m.f1).toBeCloseTo((2 * 0.5 * 0.4) / 0.9);
    expect(m.newGroupAccuracy).toBeCloseTo(1 / 2);
    expect(m.abstentions).toBe(1);
    expect(m.abstentionRate).toBeCloseTo(1 / 7);
  });

  it('returns null instead of dividing by zero', () => {
    const m = computeDecisionMetrics([record('new_group', [], { action: 'new_group' })]);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.f1).toBeNull();
  });

  it('separates within-family (hard negative) from cross-family false positives', () => {
    const within = record(
      'link',
      ['G1'],
      { action: 'link', groupId: 'G2' },
      { predictedFamily: 'f' },
    );
    const cross = record(
      'link',
      ['G1'],
      { action: 'link', groupId: 'G3' },
      { predictedFamily: 'other' },
    );
    const m = computeDecisionMetrics([within, cross]);
    expect(m.wrongLinksWithinFamily).toBe(1);
    expect(m.wrongLinksCrossFamily).toBe(1);
  });

  it('breaks results down by tag and by hard-negative exposure', () => {
    const exposed = record(
      'link',
      ['G1'],
      { action: 'link', groupId: 'G1' },
      { relatedGroupAvailable: true },
    );
    const ambiguous = record(
      'link',
      ['G1'],
      { action: 'new_group' },
      { label: label({ tags: ['ambiguous'] }) },
    );
    expect(hardNegativeMetrics([exposed, ambiguous]).requests).toBe(1);
    const byTag = metricsByTag([exposed, ambiguous]);
    expect(byTag.ambiguous?.recall).toBe(0);
    expect(byTag.paraphrase?.recall).toBe(1);
  });
});

describe('computeRetrievalMetrics', () => {
  it('computes recall@k and MRR over gold-link requests only', () => {
    const trace = (acceptable: string[], ranked: string[], gold: GoldAction = 'link') => ({
      requestId: 'r',
      goldAction: gold,
      acceptableGroupIds: acceptable,
      candidates: ranked.map((groupId, i) => ({
        groupId,
        score: 1 - i * 0.1,
        supportingRequestIds: [],
      })),
      label: label(),
      relatedGroupAvailable: false,
    });
    const m = computeRetrievalMetrics(
      [
        trace(['A'], ['A', 'B']),
        trace(['A'], ['B', 'C', 'A']),
        trace(['A'], []),
        trace([], ['Z'], 'new_group'),
      ],
      [1, 3],
    );
    expect(m.goldLinks).toBe(3);
    expect(m.recallAtK[1]).toBeCloseTo(1 / 3);
    expect(m.recallAtK[3]).toBeCloseTo(2 / 3);
    expect(m.meanReciprocalRank).toBeCloseTo((1 + 1 / 3 + 0) / 3);
    expect(m.emptyCandidateLists).toBe(1);
  });
});

describe('selectThreshold', () => {
  const point = (threshold: number, precision: number | null, recall: number, f1: number) => ({
    threshold,
    metrics: {
      ...computeDecisionMetrics([]),
      precision,
      recall,
      f1,
      predictedLinks: precision === null ? 0 : 5,
    },
  });

  it('maximises recall subject to the precision floor', () => {
    const selection = selectThreshold([
      point(0.2, 0.7, 0.9, 0.79),
      point(0.4, 0.92, 0.5, 0.65),
      point(0.6, 0.98, 0.3, 0.46),
    ]);
    expect(selection).toMatchObject({
      threshold: 0.4,
      rule: 'max-recall-at-min-precision',
      precisionFloorMet: true,
    });
  });

  it('falls back to max F1 and reports that the floor was not met', () => {
    const selection = selectThreshold([point(0.2, 0.7, 0.9, 0.79), point(0.4, 0.8, 0.5, 0.62)]);
    expect(selection).toMatchObject({
      threshold: 0.2,
      rule: 'max-f1-fallback',
      precisionFloorMet: false,
    });
  });
});
