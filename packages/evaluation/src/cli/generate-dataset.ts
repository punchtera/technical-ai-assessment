/**
 * pnpm dataset:generate [--seed <int>]
 * Regenerates the synthetic dataset files from the authored catalog.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  buildManifest,
  DEFAULT_SEED,
  generateDataset,
  serializeDataset,
} from '../dataset/generate.js';
import { loadCatalog } from '../dataset/io.js';
import { DATASET_PATHS } from '../paths.js';

const { values } = parseArgs({ options: { seed: { type: 'string' } } });
const seed = values.seed === undefined ? DEFAULT_SEED : Number.parseInt(values.seed, 10);
if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');

const { catalog, text } = loadCatalog();
const dataset = generateDataset(catalog, seed);
const serialized = serializeDataset(dataset);
const manifest = buildManifest(catalog, dataset, serialized, text, seed);

writeFileSync(DATASET_PATHS.requests, serialized.requests);
writeFileSync(DATASET_PATHS.labels, serialized.labels);
writeFileSync(DATASET_PATHS.groups, serialized.groups);
writeFileSync(DATASET_PATHS.splits, serialized.splits);
writeFileSync(DATASET_PATHS.manifest, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `Generated ${manifest.counts.requests} synthetic requests in ${manifest.counts.groups} groups ` +
    `(${manifest.counts.families} families; dev ${manifest.counts.dev} / test ${manifest.counts.test}) with seed ${seed}.`,
);
