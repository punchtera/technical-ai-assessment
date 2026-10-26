import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  FeatureRequestDetailSchema,
  FeatureRequestListSchema,
  RequestHistorySchema,
  RetryTriageResultSchema,
  SupportResultSchema,
  type FeatureRequestDetail,
  type FeatureRequestList,
  type FeatureRequestSummary,
  type ListRequestsQuery,
  type RequestHistory,
  type RetryTriageResult,
  type SupportResult,
} from '@fis/contracts';
import { CreateFeatureRequestSchema, ListRequestsQuerySchema } from '@fis/contracts';
import { redactPersonalData, mergeSummaries, type TriageProviders } from '@fis/triage-core';
import type { z } from 'zod';
import { TRIAGE_PROVIDERS } from '../ai/ai.module';
import { AuditService } from '../audit/audit.service';
import { toApi, toDbProcessingStatus, toDbReviewStatus, toDbSourceChannel } from '../common/enums';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { TriageWorker } from '../triage/triage.worker';
import { buildTriageRunView, referencedIds } from './triage-view';

const SUMMARY_INCLUDE = {
  memberships: {
    where: { status: 'ACTIVE' },
    include: { group: { select: { id: true, title: true } } },
  },
  triageRuns: {
    orderBy: { attempt: 'desc' },
    take: 1,
    include: { proposedGroup: { select: { title: true } } },
  },
  _count: { select: { supports: true } },
} satisfies Prisma.FeatureRequestInclude;

type RequestWithSummary = Prisma.FeatureRequestGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly worker: TriageWorker,
    @Inject(TRIAGE_PROVIDERS) private readonly providers: TriageProviders | null,
  ) {}

  /** Stage A: validated input is stored verbatim plus a redacted copy for providers. */
  async create(
    input: z.output<typeof CreateFeatureRequestSchema>,
    idempotencyKey?: string,
  ): Promise<{ created: boolean; request: FeatureRequestDetail }> {
    if (idempotencyKey) {
      const existing = await this.prisma.featureRequest.findUnique({ where: { idempotencyKey } });
      if (existing) return { created: false, request: await this.get(existing.id) };
    }

    const title = redactPersonalData(input.title);
    const description = redactPersonalData(input.description);
    const redactionSummary = mergeSummaries(title.summary, description.summary);

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const created = await tx.featureRequest.create({
          data: {
            title: input.title,
            description: input.description,
            redactedTitle: title.text,
            redactedDescription: description.text,
            redactionSummary: { ...redactionSummary },
            sourceChannel: toDbSourceChannel(input.sourceChannel),
            idempotencyKey: idempotencyKey ?? null,
            processingStatus: this.providers ? 'QUEUED' : 'NOT_CONFIGURED',
          },
        });
        await this.audit.record(tx, {
          type: 'REQUEST_SUBMITTED',
          actor: 'requester',
          requestId: created.id,
          details: {
            sourceChannel: input.sourceChannel,
            redactedEmails: redactionSummary.email,
            redactedPhones: redactionSummary.phone,
          },
        });
        return created.id;
      });
    } catch (error) {
      // Concurrent retry with the same idempotency key: return the winner.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.featureRequest.findUniqueOrThrow({
          where: { idempotencyKey },
        });
        return { created: false, request: await this.get(existing.id) };
      }
      throw error;
    }

    this.worker.kick();
    return { created: true, request: await this.get(id) };
  }

  async list(rawQuery: ListRequestsQuery): Promise<FeatureRequestList> {
    const query = ListRequestsQuerySchema.parse(rawQuery);
    const where: Prisma.FeatureRequestWhereInput = {
      ...(query.reviewStatus ? { reviewStatus: toDbReviewStatus(query.reviewStatus) } : {}),
      ...(query.processingStatus
        ? { processingStatus: toDbProcessingStatus(query.processingStatus) }
        : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.featureRequest.count({ where }),
      this.prisma.featureRequest.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return FeatureRequestListSchema.parse({
      items: rows.map((row) => this.toSummary(row)),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(id: string): Promise<FeatureRequestDetail> {
    const row = await this.prisma.featureRequest.findUnique({
      where: { id },
      include: SUMMARY_INCLUDE,
    });
    if (!row) throw new NotFoundException('Feature request not found');

    const run = row.triageRuns[0] ?? null;
    let latestTriage = null;
    if (run) {
      const ids = referencedIds(run);
      const [groups, requests] = await Promise.all([
        this.prisma.needGroup.findMany({
          where: { id: { in: ids.groupIds } },
          select: { id: true, title: true, needStatement: true },
        }),
        this.prisma.featureRequest.findMany({
          where: { id: { in: ids.requestIds } },
          select: { id: true, title: true },
        }),
      ]);
      latestTriage = buildTriageRunView(run, {
        groups: new Map(groups.map((g) => [g.id, g])),
        requestTitles: new Map(requests.map((r) => [r.id, r.title])),
      });
    }

    const membership = row.memberships[0];
    return FeatureRequestDetailSchema.parse({
      ...this.toSummary(row),
      description: row.description,
      redactionSummary: row.redactionSummary,
      version: row.version,
      activeMembership: membership
        ? {
            id: membership.id,
            groupId: membership.groupId,
            groupTitle: membership.group.title,
            approvedBy: membership.approvedBy,
            approvedAt: membership.approvedAt.toISOString(),
          }
        : null,
      latestTriage,
    });
  }

  async history(id: string): Promise<RequestHistory> {
    await this.ensureExists(id);
    const [events, decisions] = await Promise.all([
      this.prisma.auditEvent.findMany({ where: { requestId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.reviewDecision.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return RequestHistorySchema.parse({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        requestId: e.requestId,
        groupId: e.groupId,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
      })),
      decisions: decisions.map((d) => ({
        id: d.id,
        requestId: d.requestId,
        action: toApi(d.action),
        groupId: d.groupId,
        triageRunId: d.triageRunId,
        matchedProposal: d.matchedProposal,
        actor: d.actor,
        note: d.note,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  }

  /** "Express interest". Idempotent per supporter. */
  async addSupport(id: string, supporterRef: string): Promise<SupportResult> {
    await this.ensureExists(id);
    let created = true;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.support.create({ data: { requestId: id, supporterRef } });
        await this.audit.record(tx, { type: 'SUPPORT_ADDED', actor: supporterRef, requestId: id });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
        throw error;
      created = false;
    }
    const supportCount = await this.prisma.support.count({ where: { requestId: id } });
    return SupportResultSchema.parse({ requestId: id, supportCount, created });
  }

  /** Safe, idempotent re-queue of AI processing. */
  async retryTriage(id: string, actor: string): Promise<RetryTriageResult> {
    if (!this.providers)
      throw new ConflictException('AI processing is not configured (AI_PROVIDER=none).');
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.featureRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Feature request not found');
      if (request.reviewStatus === 'GROUPED')
        throw new ConflictException('The request is already grouped.');
      if (request.processingStatus === 'QUEUED' || request.processingStatus === 'PROCESSING') {
        return toApi<'queued' | 'processing'>(request.processingStatus); // already in flight: no-op
      }
      const updated = await tx.featureRequest.updateMany({
        where: { id, processingStatus: request.processingStatus },
        data: { processingStatus: 'QUEUED', processingError: null },
      });
      if (updated.count === 0)
        throw new ConflictException('The request changed concurrently; try again.');
      await this.audit.record(tx, {
        type: 'TRIAGE_RETRY_REQUESTED',
        actor,
        requestId: id,
        details: { previousStatus: toApi(request.processingStatus) },
      });
      return 'queued' as const;
    });
    this.worker.kick();
    return RetryTriageResultSchema.parse({ requestId: id, processingStatus: result });
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.featureRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Feature request not found');
  }

  private toSummary(row: RequestWithSummary): FeatureRequestSummary {
    const membership = row.memberships[0];
    const run = row.triageRuns[0];
    return {
      id: row.id,
      title: row.title,
      descriptionPreview:
        row.description.length > 180 ? `${row.description.slice(0, 177)}…` : row.description,
      sourceChannel: toApi(row.sourceChannel),
      reviewStatus: toApi(row.reviewStatus),
      processingStatus: toApi(row.processingStatus),
      processingError: row.processingError,
      supportCount: row._count.supports,
      group: membership ? { id: membership.group.id, title: membership.group.title } : null,
      extractedNeed: (run?.extraction as { needStatement?: string } | null)?.needStatement ?? null,
      latestProposal:
        run && run.proposedAction
          ? {
              action: toApi(run.proposedAction),
              groupId: run.proposedGroupId,
              groupTitle: run.proposedGroup?.title ?? null,
              confidence: (run.confidence as 'high' | 'medium' | 'low' | null) ?? null,
              isTestProvider: run.isTestProvider,
              suggestionStatus: toApi(run.suggestionStatus),
            }
          : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
