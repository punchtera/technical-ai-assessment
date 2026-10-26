import { buildManifest, generateDataset, serializeDataset } from './generate.js';
import { parseJsonl } from './io.js';
import {
  GroupInfoSchema,
  LabelSchema,
  ManifestSchema,
  SplitsSchema,
  SyntheticRequestSchema,
  type Catalog,
  type RequestTag,
} from './schema.js';

/** Dataset-shape targets from the implementation brief (approximate, not real-world claims). */
export const DATASET_TARGETS = {
  requests: { min: 180, max: 220 },
  groups: { min: 35, max: 45 },
  minDistinctGroupSizes: 5,
  minSingletonGroups: 1,
  minFamiliesWithSiblings: 10,
  minTagCounts: {
    paraphrase: 30,
    solution_shaped: 30,
    near_duplicate: 8,
    terse: 15,
    ambiguous: 4,
    problem_framed: 20,
    contains_synthetic_pii: 2,
  } satisfies Partial<Record<RequestTag, number>>,
} as const;

/** Emails on reserved example domains and fictional 555-01xx phone numbers only. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;
const SAFE_EMAIL = /@example\.(com|org|net)$/i;
const SAFE_PHONE = /555[\s.-]?01\d\d/;

export interface DatasetFiles {
  catalogText: string;
  requestsText: string;
  labelsText: string;
  groupsText: string;
  splitsText: string;
  manifestText: string;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  stats: Record<string, unknown>;
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function validateDataset(catalog: Catalog, files: DatasetFiles): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (message: string) => errors.push(message);

  // --- Catalog integrity --------------------------------------------------
  const groupKeys = new Set<string>();
  for (const group of catalog.groups) {
    if (groupKeys.has(group.key)) fail(`duplicate group key: ${group.key}`);
    groupKeys.add(group.key);
  }

  const seenText = new Map<string, string>();
  const tagCounts = new Map<string, number>();
  for (const group of catalog.groups) {
    group.requests.forEach((request, index) => {
      const where = `${group.key}[${index}]`;
      const text = normalise(`${request.title} ${request.description}`);
      const previous = seenText.get(text);
      if (previous) fail(`exact duplicate text in ${where} and ${previous}`);
      seenText.set(text, where);

      for (const alt of request.alsoAcceptable ?? []) {
        if (!groupKeys.has(alt)) fail(`${where}: alsoAcceptable references unknown group ${alt}`);
        if (alt === group.key) fail(`${where}: alsoAcceptable repeats its own group`);
      }
      for (const tag of request.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

      // Trivial-pattern guard: the hidden label must never appear in the text.
      if (text.includes(group.key)) fail(`${where}: text contains its own group key`);

      const raw = `${request.title} ${request.description}`;
      const emails = raw.match(EMAIL_PATTERN) ?? [];
      const phones = raw.match(PHONE_PATTERN) ?? [];
      for (const email of emails) {
        if (!SAFE_EMAIL.test(email))
          fail(`${where}: email ${email} is not on a reserved example domain`);
      }
      for (const phone of phones) {
        if (!SAFE_PHONE.test(phone))
          fail(`${where}: phone-like number is not in the fictional 555-01xx range`);
      }
      const flagged = request.tags.includes('contains_synthetic_pii');
      const hasPii = emails.length + phones.length > 0;
      if (hasPii !== flagged) fail(`${where}: contains_synthetic_pii tag does not match the text`);
    });
  }

  // --- Shape targets -------------------------------------------------------
  const totalRequests = catalog.groups.reduce((sum, g) => sum + g.requests.length, 0);
  const sizes = catalog.groups.map((g) => g.requests.length);
  const families = new Map<string, number>();
  for (const group of catalog.groups)
    families.set(group.family, (families.get(group.family) ?? 0) + 1);
  const familiesWithSiblings = [...families.values()].filter((count) => count >= 2).length;

  const t = DATASET_TARGETS;
  if (totalRequests < t.requests.min || totalRequests > t.requests.max)
    fail(`request count ${totalRequests} outside ${t.requests.min}–${t.requests.max}`);
  if (catalog.groups.length < t.groups.min || catalog.groups.length > t.groups.max)
    fail(`group count ${catalog.groups.length} outside ${t.groups.min}–${t.groups.max}`);
  if (new Set(sizes).size < t.minDistinctGroupSizes)
    fail(`group sizes are not varied enough (${new Set(sizes).size} distinct sizes)`);
  if (sizes.filter((s) => s === 1).length < t.minSingletonGroups)
    fail('dataset needs at least one single-request group (a guaranteed create-new-group case)');
  if (familiesWithSiblings < t.minFamiliesWithSiblings)
    fail(`only ${familiesWithSiblings} families contain related groups (hard negatives)`);
  for (const [tag, min] of Object.entries(t.minTagCounts)) {
    if ((tagCounts.get(tag) ?? 0) < min) fail(`tag ${tag}: ${tagCounts.get(tag) ?? 0} < ${min}`);
  }

  // --- Generated files ------------------------------------------------------
  let manifestSeed: number | undefined;
  try {
    const manifest = ManifestSchema.parse(JSON.parse(files.manifestText));
    manifestSeed = manifest.seed;

    const regenerated = generateDataset(catalog, manifest.seed);
    const serialized = serializeDataset(regenerated);
    const expected = buildManifest(
      catalog,
      regenerated,
      serialized,
      files.catalogText,
      manifest.seed,
    );

    if (JSON.stringify(expected) !== JSON.stringify(manifest))
      fail('manifest is stale — run `pnpm dataset:generate`');
    if (serialized.requests !== files.requestsText)
      fail('requests.jsonl differs from a fresh generation');
    if (serialized.labels !== files.labelsText)
      fail('labels.jsonl differs from a fresh generation');
    if (serialized.groups !== files.groupsText) fail('groups.json differs from a fresh generation');
    if (serialized.splits !== files.splitsText) fail('splits.json differs from a fresh generation');
  } catch (error) {
    fail(`could not verify generated files: ${(error as Error).message}`);
  }

  try {
    // Strict schema: a runtime record with any extra (label) field fails here.
    const requests = parseJsonl(files.requestsText, SyntheticRequestSchema, 'requests.jsonl');
    const labels = parseJsonl(files.labelsText, LabelSchema, 'labels.jsonl');
    GroupInfoSchema.array().parse(JSON.parse(files.groupsText));
    const splits = SplitsSchema.parse(JSON.parse(files.splitsText));

    const ids = new Set(requests.map((r) => r.id));
    if (ids.size !== requests.length) fail('request ids are not unique');
    const labelled = new Set(labels.map((l) => l.requestId));
    for (const id of ids) if (!labelled.has(id)) fail(`request ${id} has no label`);
    for (const id of labelled) if (!ids.has(id)) fail(`label for unknown request ${id}`);
    for (const label of labels) {
      if (!groupKeys.has(label.groupKey)) fail(`label ${label.requestId} references unknown group`);
    }

    const dev = new Set(splits.dev.requestIds);
    const test = new Set(splits.test.requestIds);
    for (const id of dev) if (test.has(id)) fail(`request ${id} is in both splits`);
    if (dev.size + test.size !== ids.size) fail('splits do not cover every request exactly once');
    const devFamilies = new Set(splits.dev.families);
    for (const family of splits.test.families) {
      if (devFamilies.has(family)) fail(`family ${family} appears in both splits (leakage)`);
    }
    const ratio = dev.size / ids.size;
    if (ratio < 0.35 || ratio > 0.65)
      warnings.push(`dev split holds ${(ratio * 100).toFixed(0)}% of requests`);
  } catch (error) {
    fail(`generated files are malformed: ${(error as Error).message}`);
  }

  return {
    errors,
    warnings,
    stats: {
      requests: totalRequests,
      groups: catalog.groups.length,
      families: families.size,
      familiesWithRelatedGroups: familiesWithSiblings,
      singletonGroups: sizes.filter((s) => s === 1).length,
      groupSizeRange: [Math.min(...sizes), Math.max(...sizes)],
      tagCounts: Object.fromEntries([...tagCounts.entries()].sort()),
      seed: manifestSeed,
    },
  };
}
