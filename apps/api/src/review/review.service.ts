import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReviewResultSchema, type ReviewDecisionInput, type ReviewResult } from '@fis/contracts';
import { AuditService } from '../audit/audit.service';
import { toApi } from '../common/enums';
import { PrismaService } from '../database/prisma.service';
import { Prisma, type ReviewDecision } from '../generated/prisma/client';
import {
  canAssign,
  canRejectSuggestion,
  canReverse,
  checkExpectedVersion,
  checkRunBelongs,
  decisionMatchesProposal,
  suggestionOutcome,
  type RuleResult,
  type RunState,
} from './review-rules';

function enforce(result: RuleResult): void {
  if (result.ok) return;
  if (result.status === 404) throw new NotFoundException(result.message);
  if (result.status === 400) throw new BadRequestException(result.message);
  throw new ConflictException(result.message);
}

function decisionView(decision: ReviewDecision) {
  return {
    id: decision.id,
    requestId: decision.requestId,
    action: toApi<'link_to_group' | 'create_group' | 'reject_suggestion' | 'reverse_membership'>(
      decision.action,
    ),
    groupId: decision.groupId,
    triageRunId: decision.triageRunId,
    matchedProposal: decision.matchedProposal,
    actor: decision.actor,
    note: decision.note,
    createdAt: decision.createdAt.toISOString(),
  };
}

/**
 * Human review. Every state change runs in one transaction that first locks
 * the request row (SELECT … FOR UPDATE), so concurrent reviewers are
 * serialised; the UNIQUE active_request_id column is the final backstop
 * against duplicate active memberships.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async decide(
    requestId: string,
    input: ReviewDecisionInput,
    actor: string,
  ): Promise<ReviewResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string; review_status: 'PENDING_REVIEW' | 'GROUPED'; version: number }[]
        >`
          SELECT id, review_status, version FROM feature_requests WHERE id = ${requestId}::uuid FOR UPDATE
        `;
        const row = locked[0];
        if (!row) throw new NotFoundException('Feature request not found');
        const request = { reviewStatus: row.review_status, version: row.version };
        enforce(checkExpectedVersion(request, input.expectedVersion));

        let run: RunState | null = null;
        if (input.triageRunId) {
          run = await tx.triageRun.findUnique({ where: { id: input.triageRunId } });
          enforce(checkRunBelongs(run, requestId));
        }

        if (input.action === 'reject_suggestion') {
          enforce(canRejectSuggestion(request, run!));
          const decision = await tx.reviewDecision.create({
            data: {
              requestId,
              triageRunId: input.triageRunId,
              action: 'REJECT_SUGGESTION',
              actor,
              note: input.note ?? null,
              matchedProposal: false,
            },
          });
          await tx.triageRun.update({
            where: { id: input.triageRunId },
            data: { suggestionStatus: 'REJECTED' },
          });
          await tx.featureRequest.update({
            where: { id: requestId },
            data: { version: { increment: 1 } },
          });
          await this.audit.record(tx, {
            type: 'SUGGESTION_REJECTED',
            actor,
            requestId,
            details: { decisionId: decision.id, triageRunId: input.triageRunId },
          });
          return ReviewResultSchema.parse({ decision: decisionView(decision), membership: null });
        }

        enforce(canAssign(request));

        let groupId: string;
        let matched: boolean | null;
        if (input.action === 'link') {
          const group = await tx.needGroup.findUnique({
            where: { id: input.groupId },
            select: { id: true },
          });
          if (!group) throw new NotFoundException('Need group not found');
          groupId = group.id;
          matched = decisionMatchesProposal(run, { kind: 'link', groupId });
        } else {
          const group = await tx.needGroup.create({
            data: { title: input.title, needStatement: input.needStatement, createdBy: actor },
          });
          groupId = group.id;
          matched = decisionMatchesProposal(run, { kind: 'create_group' });
          await this.audit.record(tx, {
            type: 'GROUP_CREATED',
            actor,
            requestId,
            groupId,
            details: { fromRequestId: requestId },
          });
        }

        const decision = await tx.reviewDecision.create({
          data: {
            requestId,
            triageRunId: input.triageRunId ?? null,
            action: input.action === 'link' ? 'LINK_TO_GROUP' : 'CREATE_GROUP',
            groupId,
            matchedProposal: matched,
            actor,
            note: input.note ?? null,
          },
        });
        const membership = await tx.groupMembership.create({
          data: {
            requestId,
            groupId,
            activeRequestId: requestId,
            approvedBy: actor,
            decisionId: decision.id,
          },
        });
        await tx.featureRequest.update({
          where: { id: requestId },
          data: { reviewStatus: 'GROUPED', version: { increment: 1 } },
        });
        // Close open suggestions: accepted / rejected by this decision, or superseded.
        if (input.triageRunId) {
          await tx.triageRun.updateMany({
            where: { id: input.triageRunId, suggestionStatus: 'OPEN' },
            data: { suggestionStatus: suggestionOutcome(matched) },
          });
        }
        await tx.triageRun.updateMany({
          where: { requestId, suggestionStatus: 'OPEN' },
          data: { suggestionStatus: 'SUPERSEDED' },
        });

        await this.audit.record(tx, {
          type: 'MEMBERSHIP_APPROVED',
          actor,
          requestId,
          groupId,
          details: {
            decisionId: decision.id,
            membershipId: membership.id,
            triageRunId: input.triageRunId ?? null,
            matchedProposal: matched,
            via: input.action,
          },
        });
        return ReviewResultSchema.parse({
          decision: decisionView(decision),
          membership: { id: membership.id, groupId, status: 'active' },
        });
      });
    } catch (error) {
      // Backstop: a concurrent transaction created the active membership first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('The request was assigned concurrently by another reviewer.');
      }
      throw error;
    }
  }

  /** Documented recovery path for an accidental assignment. */
  async reverse(membershipId: string, reason: string, actor: string): Promise<ReviewResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; status: 'ACTIVE' | 'REVERSED'; request_id: string; group_id: string }[]
      >`
        SELECT id, status, request_id, group_id FROM group_memberships WHERE id = ${membershipId}::uuid FOR UPDATE
      `;
      const membership = locked[0] ?? null;
      enforce(canReverse(membership));
      const { request_id: requestId, group_id: groupId } = membership!;
      await tx.$queryRaw`SELECT id FROM feature_requests WHERE id = ${requestId}::uuid FOR UPDATE`;

      const decision = await tx.reviewDecision.create({
        data: { requestId, action: 'REVERSE_MEMBERSHIP', groupId, actor, note: reason },
      });
      await tx.groupMembership.update({
        where: { id: membershipId },
        data: {
          status: 'REVERSED',
          activeRequestId: null,
          reversedBy: actor,
          reversedAt: new Date(),
          reversalReason: reason,
          reversalDecisionId: decision.id,
        },
      });
      await tx.featureRequest.update({
        where: { id: requestId },
        data: { reviewStatus: 'PENDING_REVIEW', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        type: 'MEMBERSHIP_REVERSED',
        actor,
        requestId,
        groupId,
        details: { decisionId: decision.id, membershipId },
      });
      return ReviewResultSchema.parse({
        decision: decisionView(decision),
        membership: { id: membershipId, groupId, status: 'reversed' },
      });
    });
  }
}
