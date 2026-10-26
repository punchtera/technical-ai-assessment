import { resolve } from 'node:path';

/** Repository root, resolved from this file (packages/evaluation/src). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export const DATASET_DIR = resolve(REPO_ROOT, 'data/synthetic');
export const GROUND_TRUTH_DIR = resolve(DATASET_DIR, 'ground-truth');

export const DATASET_PATHS = {
  /** Hand-authored source. Contains labels, so it lives under ground-truth/. */
  catalog: resolve(GROUND_TRUTH_DIR, 'catalog.json'),
  /** Runtime inputs only — what an application would receive. No labels. */
  requests: resolve(DATASET_DIR, 'requests.jsonl'),
  manifest: resolve(DATASET_DIR, 'manifest.json'),
  labels: resolve(GROUND_TRUTH_DIR, 'labels.jsonl'),
  groups: resolve(GROUND_TRUTH_DIR, 'groups.json'),
  splits: resolve(GROUND_TRUTH_DIR, 'splits.json'),
} as const;

export const RESULTS_DIR = resolve(REPO_ROOT, 'data/evaluation/results');
