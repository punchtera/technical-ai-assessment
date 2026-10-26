/**
 * pnpm eval [--matcher lexical|deterministic|ai] [--k 5] [--threshold 0.3]
 *           [--min-similarity 0.25] [--limit N]
 *
 * lexical        NON-AI TF-IDF baseline (default). No keys, no network.
 * deterministic  Production pipeline with the labelled deterministic test
 *                provider. No keys, no network. Measures mechanics, not AI.
 * ai             Production pipeline with Anthropic + Voyage. PAID and
 *                opt-in: requires RUN_LIVE_AI_EVAL=1, ANTHROPIC_API_KEY and
 *                VOYAGE_API_KEY. Synthetic data only.
 *
 * Writes a JSON report to data/evaluation/results/ and prints a summary.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createDeterministicTestProviders,
  createProviders,
  DEFAULT_PROVIDER_SETTINGS,
  DEFAULT_RETRIEVAL_PARAMS,
} from '@fis/triage-core';
import { loadGroundTruth, loadManifest, loadRequests } from '../dataset/io.js';
import { formatReport } from '../eval/format.js';
import { runLexicalBaseline } from '../eval/run-lexical-baseline.js';
import { runPipelineEvaluation } from '../eval/run-pipeline.js';
import { RESULTS_DIR } from '../paths.js';

const { values } = parseArgs({
  options: {
    matcher: { type: 'string', default: 'lexical' },
    k: { type: 'string', default: '5' },
    threshold: { type: 'string' },
    'min-similarity': { type: 'string' },
    limit: { type: 'string' },
  },
});

const k = Number.parseInt(values.k, 10);
if (!Number.isInteger(k) || k < 1 || k > 10)
  throw new Error('--k must be an integer between 1 and 10');
const threshold = values.threshold === undefined ? undefined : Number.parseFloat(values.threshold);
if (threshold !== undefined && !(threshold >= 0 && threshold <= 1))
  throw new Error('--threshold must be in [0, 1]');
const minSimilarity =
  values['min-similarity'] === undefined
    ? DEFAULT_RETRIEVAL_PARAMS.minSimilarity
    : Number.parseFloat(values['min-similarity']);
const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);

const requests = loadRequests();
const { labels, splits } = loadGroundTruth();
const manifest = loadManifest();
const retrievalParams = { ...DEFAULT_RETRIEVAL_PARAMS, candidateLimit: k, minSimilarity };
const progress = (split: string, done: number, total: number) => {
  if (done % 10 === 0 || done === total) process.stderr.write(`  ${split}: ${done}/${total}\n`);
};

let report;
switch (values.matcher) {
  case 'lexical':
    report = await runLexicalBaseline({ requests, labels, splits, manifest, k, threshold });
    break;
  case 'deterministic':
    report = await runPipelineEvaluation(
      { requests, labels, splits, manifest },
      {
        providers: createDeterministicTestProviders(),
        kind: 'deterministic-test',
        retrievalParams,
        limitPerSplit: limit,
      },
    );
    break;
  case 'ai': {
    if (process.env.RUN_LIVE_AI_EVAL !== '1') {
      console.error(
        'The AI evaluation calls paid APIs. Set RUN_LIVE_AI_EVAL=1 (and ANTHROPIC_API_KEY, VOYAGE_API_KEY) to run it.',
      );
      process.exit(2);
    }
    const providers = createProviders({
      ...DEFAULT_PROVIDER_SETTINGS,
      mode: 'anthropic-voyage',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      voyageApiKey: process.env.VOYAGE_API_KEY,
      extractionModel:
        process.env.ANTHROPIC_EXTRACTION_MODEL ?? DEFAULT_PROVIDER_SETTINGS.extractionModel,
      assessmentModel:
        process.env.ANTHROPIC_ASSESSMENT_MODEL ?? DEFAULT_PROVIDER_SETTINGS.assessmentModel,
    })!;
    report = await runPipelineEvaluation(
      { requests, labels, splits, manifest },
      { providers, kind: 'ai', retrievalParams, limitPerSplit: limit, onProgress: progress },
    );
    break;
  }
  default:
    console.error(`Unknown matcher "${values.matcher}". Use lexical, deterministic or ai.`);
    process.exit(2);
}

mkdirSync(RESULTS_DIR, { recursive: true });
const slug =
  report.matcher.kind === 'non-ai-baseline'
    ? 'lexical-baseline'
    : report.matcher.name.replace(/[^a-z0-9]+/gi, '-');
const file = resolve(RESULTS_DIR, `${slug}-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(RESULTS_DIR, `latest-${slug}.json`), JSON.stringify(report, null, 2) + '\n');

console.log(formatReport(report));
console.log(`\nFull report: ${file}`);
