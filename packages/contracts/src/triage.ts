import { z } from 'zod';
import {
  ActiveMembershipSchema,
  ConfidenceSchema,
  FeatureRequestSummarySchema,
  ProposalActionSchema,
} from './requests.js';

/** Where a quotation comes from — always traceable to a stored source record. */
export const EvidenceSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request'), field: z.enum(['title', 'description']) }),
  z.object({ kind: z.literal('group_need'), groupId: z.uuid() }),
  z.object({ kind: z.literal('member_request'), groupId: z.uuid(), requestId: z.uuid() }),
  z.object({ kind: z.literal('unknown') }),
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceQuoteViewSchema = z.object({
  ref: z.string(),
  quote: z.string(),
  /** Result of the deterministic exact-substring check. Invalid quotes are shown, flagged. */
  valid: z.boolean(),
  source: EvidenceSourceSchema,
});
export type EvidenceQuoteView = z.infer<typeof EvidenceQuoteViewSchema>;

export const ExtractedNeedViewSchema = z.object({
  needStatement: z.string(),
  proposedSolution: z.string().nullable(),
  affectedUsers: z.string().nullable(),
  clarity: z.enum(['clear', 'vague', 'multiple_needs']),
  ambiguityNote: z.string().nullable(),
  evidence: z.array(EvidenceQuoteViewSchema),
  contextDetails: z.array(z.object({ detail: z.string(), evidence: EvidenceQuoteViewSchema })),
});
export type ExtractedNeedView = z.infer<typeof ExtractedNeedViewSchema>;

export const CandidateViewSchema = z.object({
  groupId: z.uuid(),
  title: z.string(),
  needStatement: z.string(),
  /** Retrieval score (cosine similarity of need embeddings) — not a match probability. */
  similarity: z.number(),
  relation: z.enum(['same_need', 'related_different_need', 'unrelated']).nullable(),
  similarities: z.string().nullable(),
  differences: z.string().nullable(),
  members: z.array(z.object({ requestId: z.uuid(), title: z.string(), similarity: z.number() })),
});
export type CandidateView = z.infer<typeof CandidateViewSchema>;

export const ProposalViewSchema = z.object({
  action: ProposalActionSchema,
  groupId: z.uuid().nullable(),
  confidence: ConfidenceSchema.nullable(),
  flags: z.array(z.string()),
  rationale: z.string(),
  evidence: z.array(EvidenceQuoteViewSchema),
});
export type ProposalView = z.infer<typeof ProposalViewSchema>;

export const TriageRunViewSchema = z.object({
  id: z.uuid(),
  attempt: z.number().int(),
  status: z.enum(['running', 'succeeded', 'failed']),
  provider: z.string(),
  /** True when produced by the deterministic test provider (NOT AI). */
  isTestProvider: z.boolean(),
  models: z.object({
    extraction: z.string().nullable(),
    assessment: z.string().nullable(),
    embedding: z.string().nullable(),
  }),
  pipelineVersion: z.string(),
  promptVersion: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  errorCode: z.string().nullable(),
  errorStage: z.string().nullable(),
  suggestionStatus: z.enum(['open', 'accepted', 'rejected', 'superseded']),
  extraction: ExtractedNeedViewSchema.nullable(),
  candidates: z.array(CandidateViewSchema),
  proposal: ProposalViewSchema.nullable(),
});
export type TriageRunView = z.infer<typeof TriageRunViewSchema>;

export const FeatureRequestDetailSchema = FeatureRequestSummarySchema.extend({
  description: z.string(),
  redactionSummary: z.object({ email: z.number().int(), phone: z.number().int() }),
  version: z.number().int(),
  activeMembership: ActiveMembershipSchema.nullable(),
  latestTriage: TriageRunViewSchema.nullable(),
});
export type FeatureRequestDetail = z.infer<typeof FeatureRequestDetailSchema>;

export const RetryTriageResultSchema = z.object({
  requestId: z.uuid(),
  processingStatus: z.enum(['queued', 'processing']),
});
export type RetryTriageResult = z.infer<typeof RetryTriageResultSchema>;

export const AiStatusSchema = z.object({
  mode: z.enum(['none', 'anthropic-voyage', 'deterministic-test']),
  providerLabel: z.string().nullable(),
  isTestProvider: z.boolean(),
  workerEnabled: z.boolean(),
  /** True when the API runs against the dedicated demo database (synthetic data). */
  demoMode: z.boolean(),
  models: z.object({
    extraction: z.string().nullable(),
    assessment: z.string().nullable(),
    embedding: z.string().nullable(),
  }),
  embeddingDimensions: z.number().int().nullable(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;
