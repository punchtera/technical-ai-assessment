import { z } from 'zod';

/** Descriptive tags attached to each authored request (ground truth only). */
export const REQUEST_TAGS = [
  'canonical',
  'paraphrase',
  'near_duplicate',
  'solution_shaped',
  'problem_framed',
  'terse',
  'ambiguous',
  'multi_need',
  'hard_wording',
  'non_english',
  'contains_synthetic_pii',
] as const;
export const RequestTagSchema = z.enum(REQUEST_TAGS);
export type RequestTag = z.infer<typeof RequestTagSchema>;

const GroupKeySchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'group keys are kebab-case');

// ---------------------------------------------------------------------------
// Authored catalog (source of truth, contains labels)
// ---------------------------------------------------------------------------

export const CatalogRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    tags: z.array(RequestTagSchema).min(1),
    /** Other groups a reviewer could defensibly link this request to. */
    alsoAcceptable: z.array(GroupKeySchema).optional(),
  })
  .strict();

export const CatalogGroupSchema = z
  .object({
    key: GroupKeySchema,
    family: GroupKeySchema,
    need: z.string().min(10),
    requests: z.array(CatalogRequestSchema).min(1),
  })
  .strict();

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    notice: z.string().min(1),
    product: z.object({ name: z.string(), description: z.string() }).strict(),
    groups: z.array(CatalogGroupSchema).min(1),
  })
  .strict();
export type Catalog = z.infer<typeof CatalogSchema>;

// ---------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------

export const SOURCE_CHANNELS = ['portal', 'email', 'customer_success', 'sales', 'support'] as const;

/**
 * A runtime input record: exactly what an application would receive.
 * `.strict()` guarantees that no label field can be smuggled in.
 */
export const SyntheticRequestSchema = z
  .object({
    id: z.string().regex(/^syn-[0-9a-f]{12}$/),
    arrivalIndex: z.number().int().nonnegative(),
    submittedAt: z.iso.datetime(),
    sourceChannel: z.enum(SOURCE_CHANNELS),
    title: z.string().min(1),
    description: z.string().min(1),
    synthetic: z.literal(true),
  })
  .strict();
export type SyntheticRequest = z.infer<typeof SyntheticRequestSchema>;

export const LabelSchema = z
  .object({
    requestId: z.string(),
    groupKey: GroupKeySchema,
    family: GroupKeySchema,
    acceptableGroupKeys: z.array(GroupKeySchema),
    tags: z.array(RequestTagSchema),
  })
  .strict();
export type Label = z.infer<typeof LabelSchema>;

export const GroupInfoSchema = z
  .object({ key: GroupKeySchema, family: GroupKeySchema, need: z.string(), size: z.number().int() })
  .strict();
export type GroupInfo = z.infer<typeof GroupInfoSchema>;

export const SPLIT_NAMES = ['dev', 'test'] as const;
export type SplitName = (typeof SPLIT_NAMES)[number];

const SplitPartSchema = z
  .object({ families: z.array(z.string()), requestIds: z.array(z.string()) })
  .strict();
export const SplitsSchema = z
  .object({
    strategy: z.literal('family-level'),
    seed: z.number().int(),
    dev: SplitPartSchema,
    test: SplitPartSchema,
  })
  .strict();
export type Splits = z.infer<typeof SplitsSchema>;

export const ManifestSchema = z
  .object({
    name: z.literal('tasklane-synthetic-feature-requests'),
    datasetVersion: z.string(),
    generatorVersion: z.string(),
    seed: z.number().int(),
    synthetic: z.literal(true),
    notice: z.string(),
    counts: z
      .object({
        requests: z.number().int(),
        groups: z.number().int(),
        families: z.number().int(),
        dev: z.number().int(),
        test: z.number().int(),
      })
      .strict(),
    sha256: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;
