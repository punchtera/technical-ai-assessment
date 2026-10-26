/**
 * pnpm eval [--matcher lexical] [--k 5] [--threshold 0.3]
 *
 * Runs the offline matching evaluation on the synthetic dataset and writes a
 * JSON report to data/evaluation/results/. Needs no API keys or network.
 * AI matchers (embeddings + LLM) are added in step 2 behind the same interface.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadGroundTruth, loadManifest, loadRequests } from '../dataset/io.js';
import { formatReport } from '../eval/format.js';
import { runLexicalBaseline } from '../eval/run-lexical-baseline.js';
import { RESULTS_DIR } from '../paths.js';

const { values } = parseArgs({
  options: {
    matcher: { type: 'string', default: 'lexical' },
    k: { type: 'string', default: '5' },
    threshold: { type: 'string' },
  },
});

if (values.matcher !== 'lexical') {
  console.error(
    `Unknown matcher "${values.matcher}". Available in this step: lexical (non-AI baseline).`,
  );
  process.exit(2);
}
const k = Number.parseInt(values.k, 10);
if (!Number.isInteger(k) || k < 1 || k > 10)
  throw new Error('--k must be an integer between 1 and 10');
const threshold = values.threshold === undefined ? undefined : Number.parseFloat(values.threshold);
if (threshold !== undefined && !(threshold >= 0 && threshold <= 1))
  throw new Error('--threshold must be in [0, 1]');

const requests = loadRequests();
const { labels, splits } = loadGroundTruth();
const manifest = loadManifest();

const report = await runLexicalBaseline({ requests, labels, splits, manifest, k, threshold });

mkdirSync(RESULTS_DIR, { recursive: true });
const file = resolve(
  RESULTS_DIR,
  `lexical-baseline-${report.generatedAt.replace(/[:.]/g, '-')}.json`,
);
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
writeFileSync(
  resolve(RESULTS_DIR, 'latest-lexical-baseline.json'),
  JSON.stringify(report, null, 2) + '\n',
);

console.log(formatReport(report));
console.log(`\nFull report: ${file}`);
