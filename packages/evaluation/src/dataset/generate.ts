import {
  SOURCE_CHANNELS,
  type Catalog,
  type GroupInfo,
  type Label,
  type Manifest,
  type Splits,
  type SyntheticRequest,
} from './schema.js';
import { createRng, sha256, shuffle } from './random.js';

export const GENERATOR_VERSION = '1.0.0';
export const DATASET_VERSION = '1.0.0';
export const DEFAULT_SEED = 20261025;

/** Synthetic submissions start here and arrive in seeded order over the following weeks. */
const BASE_TIME = Date.UTC(2026, 0, 5, 9, 0, 0);

export interface GeneratedDataset {
  requests: SyntheticRequest[];
  labels: Label[];
  groups: GroupInfo[];
  splits: Splits;
}

/**
 * Stable identifier for an authored request. It depends only on the catalog
 * position, not on the seed, so changing the seed reorders arrivals without
 * renaming requests. The hash is one-way: the label cannot be read from the id.
 */
export function syntheticRequestId(groupKey: string, variantIndex: number): string {
  return `syn-${sha256(`tasklane:v1:${groupKey}:${variantIndex}`).slice(0, 12)}`;
}

/** Pure, deterministic generation: same catalog + seed → identical output. */
export function generateDataset(catalog: Catalog, seed: number = DEFAULT_SEED): GeneratedDataset {
  const rng = createRng(seed);

  const authored = catalog.groups.flatMap((group) =>
    group.requests.map((request, variantIndex) => ({
      id: syntheticRequestId(group.key, variantIndex),
      group,
      request,
    })),
  );

  // 1. Arrival order: a seeded shuffle across all groups, so the "first" request
  //    of a group is not necessarily its canonical wording.
  const ordered = shuffle(authored, rng);

  let clock = BASE_TIME;
  const requests: SyntheticRequest[] = ordered.map((item, arrivalIndex) => {
    clock += Math.floor(20 + rng() * 220) * 60_000; // 20–240 minutes between arrivals
    return {
      id: item.id,
      arrivalIndex,
      submittedAt: new Date(clock).toISOString(),
      sourceChannel: SOURCE_CHANNELS[Math.floor(rng() * SOURCE_CHANNELS.length)]!,
      title: item.request.title,
      description: item.request.description,
      synthetic: true,
    };
  });

  const labels: Label[] = ordered.map((item) => ({
    requestId: item.id,
    groupKey: item.group.key,
    family: item.group.family,
    acceptableGroupKeys: [...(item.request.alsoAcceptable ?? [])].sort(),
    tags: [...item.request.tags].sort(),
  }));

  const groups: GroupInfo[] = catalog.groups
    .map((group) => ({
      key: group.key,
      family: group.family,
      need: group.need,
      size: group.requests.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // 2. Family-level split. Related groups (hard negatives for each other) stay
  //    in the same split, so tuning on `dev` never sees paraphrases or
  //    near-misses of `test` groups.
  const familySizes = new Map<string, number>();
  for (const group of catalog.groups) {
    familySizes.set(group.family, (familySizes.get(group.family) ?? 0) + group.requests.length);
  }
  const families = shuffle([...familySizes.keys()].sort(), rng);
  const total = authored.length;
  const devFamilies: string[] = [];
  let devSize = 0;
  for (const family of families) {
    if (devSize < total / 2) {
      devFamilies.push(family);
      devSize += familySizes.get(family)!;
    }
  }
  const devFamilySet = new Set(devFamilies);
  const testFamilies = families.filter((family) => !devFamilySet.has(family));

  // `labels` is already in arrival order, so request ids keep that order.
  const splits: Splits = {
    strategy: 'family-level',
    seed,
    dev: {
      families: [...devFamilies].sort(),
      requestIds: labels.filter((l) => devFamilySet.has(l.family)).map((l) => l.requestId),
    },
    test: {
      families: [...testFamilies].sort(),
      requestIds: labels.filter((l) => !devFamilySet.has(l.family)).map((l) => l.requestId),
    },
  };

  return { requests, labels, groups, splits };
}

/** Canonical serialisations — the manifest hashes exactly these bytes. */
export function serializeDataset(dataset: GeneratedDataset) {
  return {
    requests: dataset.requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
    labels: dataset.labels.map((l) => JSON.stringify(l)).join('\n') + '\n',
    groups: JSON.stringify(dataset.groups, null, 2) + '\n',
    splits: JSON.stringify(dataset.splits, null, 2) + '\n',
  };
}

export function buildManifest(
  catalog: Catalog,
  dataset: GeneratedDataset,
  serialized: ReturnType<typeof serializeDataset>,
  catalogText: string,
  seed: number,
): Manifest {
  return {
    name: 'tasklane-synthetic-feature-requests',
    datasetVersion: DATASET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    seed,
    synthetic: true,
    notice: catalog.notice,
    counts: {
      requests: dataset.requests.length,
      groups: dataset.groups.length,
      families: new Set(dataset.groups.map((g) => g.family)).size,
      dev: dataset.splits.dev.requestIds.length,
      test: dataset.splits.test.requestIds.length,
    },
    sha256: {
      'ground-truth/catalog.json': sha256(catalogText),
      'requests.jsonl': sha256(serialized.requests),
      'ground-truth/labels.jsonl': sha256(serialized.labels),
      'ground-truth/groups.json': sha256(serialized.groups),
      'ground-truth/splits.json': sha256(serialized.splits),
    },
  };
}
