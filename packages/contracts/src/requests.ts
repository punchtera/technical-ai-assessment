import { z } from 'zod';

export const SourceChannelSchema = z.enum([
  'portal',
  'email',
  'customer_success',
  'sales',
  'support',
]);
export type SourceChannel = z.infer<typeof SourceChannelSchema>;

export const ReviewStatusSchema = z.enum(['pending_review', 'grouped']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ProcessingStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'not_configured',
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const REQUEST_LIMITS = {
  titleMin: 3,
  titleMax: 200,
  descriptionMin: 10,
  descriptionMax: 5000,
} as const;

export const CreateFeatureRequestSchema = z
  .object({
    title: z.string().trim().min(REQUEST_LIMITS.titleMin).max(REQUEST_LIMITS.titleMax),
    description: z
      .string()
      .trim()
      .min(REQUEST_LIMITS.descriptionMin)
      .max(REQUEST_LIMITS.descriptionMax),
    sourceChannel: SourceChannelSchema.default('portal'),
  })
  .strict();
export type CreateFeatureRequest = z.input<typeof CreateFeatureRequestSchema>;

/** Pseudonymous handle used for supports and as the reviewer identity. No personal data. */
export const ActorRefSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'use letters, digits, ".", "_" or "-" (max 100)');

export const AddSupportSchema = z.object({ supporterRef: ActorRefSchema }).strict();
export type AddSupport = z.infer<typeof AddSupportSchema>;

export const SupportResultSchema = z.object({
  requestId: z.uuid(),
  supportCount: z.number().int().nonnegative(),
  created: z.boolean(),
});
export type SupportResult = z.infer<typeof SupportResultSchema>;

export const ProposalActionSchema = z.enum(['link_existing', 'create_group', 'needs_review']);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const ProposalSummarySchema = z.object({
  action: ProposalActionSchema,
  groupId: z.uuid().nullable(),
  groupTitle: z.string().nullable(),
  confidence: ConfidenceSchema.nullable(),
  isTestProvider: z.boolean(),
  suggestionStatus: z.enum(['open', 'accepted', 'rejected', 'superseded']),
});
export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;

export const GroupRefSchema = z.object({ id: z.uuid(), title: z.string() });

export const FeatureRequestSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  descriptionPreview: z.string(),
  sourceChannel: SourceChannelSchema,
  reviewStatus: ReviewStatusSchema,
  processingStatus: ProcessingStatusSchema,
  processingError: z.string().nullable(),
  supportCount: z.number().int().nonnegative(),
  group: GroupRefSchema.nullable(),
  /** Need statement from the latest successful triage run (AI or test provider), if any. */
  extractedNeed: z.string().nullable(),
  latestProposal: ProposalSummarySchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type FeatureRequestSummary = z.infer<typeof FeatureRequestSummarySchema>;

export const ListRequestsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    reviewStatus: ReviewStatusSchema.optional(),
    processingStatus: ProcessingStatusSchema.optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListRequestsQuery = z.input<typeof ListRequestsQuerySchema>;

export const PaginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int(),
  });

export const FeatureRequestListSchema = PaginatedSchema(FeatureRequestSummarySchema);
export type FeatureRequestList = z.infer<typeof FeatureRequestListSchema>;

export const ActiveMembershipSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  groupTitle: z.string(),
  approvedBy: z.string(),
  approvedAt: z.iso.datetime(),
});
