import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { DATASET_PATHS } from '../paths.js';
import {
  CatalogSchema,
  GroupInfoSchema,
  LabelSchema,
  ManifestSchema,
  SplitsSchema,
  SyntheticRequestSchema,
} from './schema.js';

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function parseJsonl<T extends z.ZodType>(
  text: string,
  schema: T,
  file: string,
): z.output<T>[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const parsed = schema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(
          `${file}:${index + 1}: ${parsed.error.issues[0]?.message ?? 'invalid record'}`,
        );
      }
      return parsed.data;
    });
}

export function loadCatalog() {
  const text = readText(DATASET_PATHS.catalog);
  return { text, catalog: CatalogSchema.parse(JSON.parse(text)) };
}

/** Runtime inputs only. This is the only dataset file a matcher may read. */
export function loadRequests() {
  return parseJsonl(readText(DATASET_PATHS.requests), SyntheticRequestSchema, 'requests.jsonl');
}

/** Ground truth — for the evaluation harness only, never passed to a matcher. */
export function loadGroundTruth() {
  return {
    labels: parseJsonl(readText(DATASET_PATHS.labels), LabelSchema, 'labels.jsonl'),
    groups: GroupInfoSchema.array().parse(JSON.parse(readText(DATASET_PATHS.groups))),
    splits: SplitsSchema.parse(JSON.parse(readText(DATASET_PATHS.splits))),
  };
}

export function loadManifest() {
  return ManifestSchema.parse(JSON.parse(readText(DATASET_PATHS.manifest)));
}
