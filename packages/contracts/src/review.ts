import { z } from 'zod';
import { SourceChannelSchema } from './requests.js';

const NoteSchema = z.string().trim().max(1000).optional();
/** When supplied, the decision fails with 409 if the request changed since the reviewer loaded it. */
const ExpectedVersionSchema = z.number().int().nonnegative().optional();

/** Human review actions. The API enforces every rule regardless of the UI. */
export const ReviewDecisionInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('link'),
      groupId: z.uuid(),
      /** The run whose suggestion the reviewer looked at, if any. */
      triageRunId: z.uuid().optional(),
      expectedVersion: ExpectedVersionSchema,
      note: NoteSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('create_group'),
      title: z.string().trim().min(3).max(200),
      needStatement: z.string().trim().min(10).max(1000),
      triageRunId: z.uuid().optional(),
      expectedVersion: ExpectedVersionSchema,
      note: NoteSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('reject_suggestion'),
      triageRunId: z.uuid(),
      expectedVersion: ExpectedVersionSchema,
      note: NoteSchema,
    })
    .strict(),
]);
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInputSchema>;

export const ReverseMembershipInputSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export type ReverseMembershipInput = z.infer<typeof ReverseMembershipInputSchema>;

export const ReviewDecisionViewSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  action: z.enum(['link_to_group', 'create_group', 'reject_suggestion', 'reverse_membership']),
  groupId: z.uuid().nullable(),
  triageRunId: z.uuid().nullable(),
  matchedProposal: z.boolean().nullable(),
  actor: z.string(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewDecisionView = z.infer<typeof ReviewDecisionViewSchema>;

export const NeedGroupSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  needStatement: z.string(),
  memberCount: z.number().int().nonnegative(),
  /** Distinct supporters across all approved member requests. */
  supporterCount: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type NeedGroupSummary = z.infer<typeof NeedGroupSummarySchema>;

export const NeedGroupListSchema = z.object({
  items: z.array(NeedGroupSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type NeedGroupList = z.infer<typeof NeedGroupListSchema>;

export const ListGroupsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const NeedGroupDetailSchema = NeedGroupSummarySchema.extend({
  members: z.array(
    z.object({
      membershipId: z.uuid(),
      requestId: z.uuid(),
      title: z.string(),
      description: z.string(),
      sourceChannel: SourceChannelSchema,
      supportCount: z.number().int().nonnegative(),
      approvedBy: z.string(),
      approvedAt: z.iso.datetime(),
    }),
  ),
});
export type NeedGroupDetail = z.infer<typeof NeedGroupDetailSchema>;

export const ReviewResultSchema = z.object({
  decision: ReviewDecisionViewSchema,
  membership: z
    .object({ id: z.uuid(), groupId: z.uuid(), status: z.enum(['active', 'reversed']) })
    .nullable(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const AuditEventViewSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  actor: z.string(),
  requestId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditEventView = z.infer<typeof AuditEventViewSchema>;

export const RequestHistorySchema = z.object({
  events: z.array(AuditEventViewSchema),
  decisions: z.array(ReviewDecisionViewSchema),
});
export type RequestHistory = z.infer<typeof RequestHistorySchema>;
