import type { EvaluationReport } from './run-lexical-baseline.js';

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);

/** Human-readable summary printed by `pnpm eval`. */
export function formatReport(report: EvaluationReport): string {
  const lines: string[] = [];
  const m = report.matcher;
  lines.push(
    `Matcher: ${m.retriever} + ${m.decider} (${m.kind}), top-${m.candidateLimit} candidates`,
  );
  if ('precisionFloorMet' in m.selection) {
    lines.push(
      `Threshold selected on dev by ${m.selection.rule} (precision floor ${m.selection.minPrecision}` +
        `${m.selection.precisionFloorMet ? ' met' : ' NOT met'})`,
    );
  } else {
    lines.push('Threshold fixed by --threshold flag');
  }
  lines.push(
    `Dataset v${report.dataset.datasetVersion}, seed ${report.dataset.seed}, ${report.dataset.counts.requests} requests`,
  );
  lines.push('');

  const header = ['metric', 'dev', 'test'];
  const rows: [string, string, string][] = [];
  const both = <T>(
    pick: (split: EvaluationReport['splits']['dev']) => T,
    show: (value: T) => string,
  ) => [show(pick(report.splits.dev)), show(pick(report.splits.test))] as [string, string];

  rows.push(['requests', ...both((s) => s.requests, String)]);
  rows.push([
    'gold links / gold new groups',
    ...both((s) => `${s.decision.goldLinks} / ${s.decision.goldNewGroups}`, String),
  ]);
  rows.push(['— retrieval (stage C) —', '', '']);
  for (const k of [1, 3, 5, 10])
    rows.push([`recall@${k}`, ...both((s) => s.retrieval.recallAtK[k] ?? null, pct)]);
  rows.push([
    'MRR',
    ...both(
      (s) => s.retrieval.meanReciprocalRank,
      (v) => (v === null ? 'n/a' : v.toFixed(3)),
    ),
  ]);
  rows.push(['— decision (stage D) —', '', '']);
  rows.push(['precision', ...both((s) => s.decision.precision, pct)]);
  rows.push(['recall', ...both((s) => s.decision.recall, pct)]);
  rows.push(['F1', ...both((s) => s.decision.f1, pct)]);
  rows.push(['new-group accuracy', ...both((s) => s.decision.newGroupAccuracy, pct)]);
  rows.push([
    'false positives (within / cross family)',
    ...both(
      (s) =>
        `${s.decision.wrongLinks} (${s.decision.wrongLinksWithinFamily} / ${s.decision.wrongLinksCrossFamily})`,
      String,
    ),
  ]);
  rows.push(['false negatives', ...both((s) => s.decision.missedLinks, String)]);
  rows.push(['abstentions', ...both((s) => s.decision.abstentions, String)]);
  rows.push(['hard-negative subset precision', ...both((s) => s.hardNegatives.precision, pct)]);
  rows.push(['hard-negative subset recall', ...both((s) => s.hardNegatives.recall, pct)]);
  for (const tag of ['ambiguous', 'terse', 'solution_shaped', 'paraphrase', 'near_duplicate']) {
    rows.push([`recall · ${tag}`, ...both((s) => s.byTag[tag]?.recall ?? null, pct)]);
  }

  const widths = header.map((_, i) =>
    Math.max(header[i]!.length, ...rows.map((row) => row[i]!.length)),
  );
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
  lines.push(line(header));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) lines.push(line(row));
  lines.push('');
  lines.push('Limitations:');
  for (const limitation of report.limitations) lines.push(`  - ${limitation}`);
  return lines.join('\n');
}
