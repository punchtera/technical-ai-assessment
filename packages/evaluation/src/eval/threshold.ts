import type { DecisionMetrics } from './metrics.js';

export interface SweepPoint {
  threshold: number;
  metrics: DecisionMetrics;
}

export interface ThresholdSelection {
  threshold: number;
  rule: 'max-recall-at-min-precision' | 'max-f1-fallback';
  minPrecision: number;
  /** False when no threshold reached the precision floor on the tuning split. */
  precisionFloorMet: boolean;
}

/**
 * Picks an operating point on the *tuning* split only.
 * Precision is prioritised (a wrong merge hides a distinct need — see
 * docs/product-design.md §10.4): take the highest recall among thresholds whose
 * precision ≥ `minPrecision`; ties go to the higher (more conservative) threshold.
 * If none qualifies, fall back to max F1 and say so.
 */
export function selectThreshold(
  sweep: readonly SweepPoint[],
  minPrecision = 0.9,
): ThresholdSelection {
  const qualifying = sweep.filter(
    (point) =>
      point.metrics.precision !== null &&
      point.metrics.precision >= minPrecision &&
      point.metrics.predictedLinks > 0,
  );

  if (qualifying.length > 0) {
    const best = [...qualifying].sort(
      (a, b) => (b.metrics.recall ?? 0) - (a.metrics.recall ?? 0) || b.threshold - a.threshold,
    )[0]!;
    return {
      threshold: best.threshold,
      rule: 'max-recall-at-min-precision',
      minPrecision,
      precisionFloorMet: true,
    };
  }

  const best = [...sweep].sort(
    (a, b) => (b.metrics.f1 ?? -1) - (a.metrics.f1 ?? -1) || b.threshold - a.threshold,
  )[0];
  if (!best) throw new Error('empty threshold sweep');
  return {
    threshold: best.threshold,
    rule: 'max-f1-fallback',
    minPrecision,
    precisionFloorMet: false,
  };
}

export const THRESHOLD_GRID: readonly number[] = Array.from(
  { length: 101 },
  (_, i) => Math.round(i) / 100,
);
