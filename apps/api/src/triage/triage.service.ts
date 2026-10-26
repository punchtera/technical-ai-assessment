import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  errorCodeFor,
  PROMPT_VERSION,
  PIPELINE_VERSION,
  runTriage,
  TriageStageError,
  type CandidateGroupDetails,
  type RetrievalParams,
  type RetrievedCandidate,
  type TriageOutcome,
  type TriageProviders,
} from '@fis/triage-core';
import { embeddingSpaceId, RETRIEVAL_PARAMS, TRIAGE_PROVIDERS } from '../ai/ai.module';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { EmbeddingRepository } from './embedding.repository';

const ACTION_TO_DB = {
  link_existing: 'LINK_EXISTING',
  create_group: 'CREATE_GROUP',
  needs_review: 'NEEDS_REVIEW',
} as const;

/** Converts typed pipeline output to JSON columns. */
const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export type ProcessResult = 'succeeded' | 'failed' | 'skipped' | 'duplicate';

/**
 * Orchestrates one triage attempt for a claimed request: runs the shared
 * pipeline, persists the recommendation (never a membership), and records the
 * outcome. Failures are stored with an error code and stage; the request stays
 * reviewable manually.
 */
@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);
  private spaceReady: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly embeddings: EmbeddingRepository,
    @Inject(TRIAGE_PROVIDERS) private readonly providers: TriageProviders | null,
    @Inject(RETRIEVAL_PARAMS) private readonly retrievalParams: RetrievalParams,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  get enabled(): boolean {
    return this.providers !== null;
  }

  private async ensureSpace(providers: TriageProviders): Promise<string> {
    const id = embeddingSpaceId(providers);
    this.spaceReady ??= this.embeddings.ensureSpace(id, providers.embedder.space);
    await this.spaceReady;
    return id;
  }

  async process(requestId: string, attempt: number): Promise<ProcessResult> {
    const providers = this.providers;
    if (!providers) return 'skipped';

    const request = await this.prisma.featureRequest.findUnique({ where: { id: requestId } });
    if (!request) return 'skipped';

    if (request.reviewStatus === 'GROUPED') {
      // A reviewer decided before the AI ran: nothing to recommend.
      await this.prisma.$transaction(async (tx) => {
        await tx.featureRequest.updateMany({
          where: { id: requestId, processingAttempts: attempt, processingStatus: 'PROCESSING' },
          data: { processingStatus: 'COMPLETED', processingStartedAt: null },
        });
        await this.audit.record(tx, {
          type: 'TRIAGE_SKIPPED',
          actor: SYSTEM_ACTOR,
          requestId,
          details: { reason: 'already_grouped' },
        });
      });
      return 'skipped';
    }

    let runId: string;
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.triageRun.create({
          data: {
            requestId,
            attempt,
            provider: providers.label,
            isTestProvider: providers.isTestProvider,
            pipelineVersion: PIPELINE_VERSION,
            promptVersion: PROMPT_VERSION,
          },
        });
        await this.audit.record(tx, {
          type: 'TRIAGE_STARTED',
          actor: SYSTEM_ACTOR,
          requestId,
          details: { triageRunId: created.id, attempt, provider: providers.label },
        });
        return created;
      });
      runId = run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate'; // another worker already handles this attempt
      }
      throw error;
    }

    const started = Date.now();
    let spaceId: string;
    let outcome: TriageOutcome;
    try {
      spaceId = await this.ensureSpace(providers);
      outcome = await runTriage(
        {
          requestId,
          text: { title: request.redactedTitle, description: request.redactedDescription },
        },
        {
          providers,
          retrievalParams: this.retrievalParams,
          timeoutMs: this.env.PROVIDER_TIMEOUT_MS,
          findNearestMembers: (embedding, excludeId) =>
            this.embeddings.nearestApprovedMembers(
              spaceId,
              embedding,
              excludeId,
              this.env.RETRIEVAL_NEIGHBOURS,
            ),
          loadCandidateDetails: (candidates) => this.loadCandidateDetails(candidates),
        },
      );
    } catch (error) {
      await this.recordFailure(requestId, runId, attempt, error, Date.now() - started);
      return 'failed';
    }

    const { proposal } = outcome;
    const proposedGroupId =
      proposal.action === 'link_existing'
        ? proposal.groupId
        : proposal.action === 'needs_review'
          ? proposal.suggestedGroupId
          : null;

    await this.prisma.$transaction(async (tx) => {
      await this.embeddings.upsert(
        tx,
        requestId,
        spaceId,
        outcome.embedding,
        createHash('sha256').update(outcome.extraction.needStatement).digest('hex'),
      );
      await tx.triageRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCEEDED',
          extractionModel: outcome.models.extraction,
          assessmentModel: outcome.models.assessment,
          embeddingModel: outcome.models.embedding,
          extraction: asJson(outcome.extraction),
          extractionChecks: asJson(outcome.extractionQuoteChecks),
          retrieval: asJson(outcome.retrieval),
          candidateRefs: asJson(outcome.candidateRefs),
          memberRefs: asJson(outcome.memberRefs),
          assessment: outcome.assessment ? asJson(outcome.assessment) : Prisma.DbNull,
          assessmentChecks: asJson(outcome.assessmentQuoteChecks),
          proposedAction: ACTION_TO_DB[proposal.action],
          proposedGroupId,
          confidence: 'confidence' in proposal ? proposal.confidence : null,
          flags: proposal.flags,
          rationale: proposal.rationale,
          providerCalls: outcome.providerCalls,
          usage: asJson(outcome.usage),
          latencyMs: Date.now() - started,
          completedAt: new Date(),
        },
      });
      // Older open suggestions are replaced by this one.
      await tx.triageRun.updateMany({
        where: { requestId, id: { not: runId }, suggestionStatus: 'OPEN' },
        data: { suggestionStatus: 'SUPERSEDED' },
      });
      // Guard: only the current claim may complete the request.
      await tx.featureRequest.updateMany({
        where: { id: requestId, processingAttempts: attempt, processingStatus: 'PROCESSING' },
        data: { processingStatus: 'COMPLETED', processingError: null, processingStartedAt: null },
      });
      await this.audit.record(tx, {
        type: 'TRIAGE_COMPLETED',
        actor: SYSTEM_ACTOR,
        requestId,
        details: {
          triageRunId: runId,
          proposedAction: proposal.action,
          proposedGroupId,
          flags: proposal.flags,
          provider: providers.label,
        },
      });
    });
    return 'succeeded';
  }

  private async loadCandidateDetails(
    candidates: RetrievedCandidate[],
  ): Promise<CandidateGroupDetails[]> {
    const groups = await this.prisma.needGroup.findMany({
      where: { id: { in: candidates.map((c) => c.groupId) } },
    });
    const memberIds = candidates.flatMap((c) => c.memberHits.map((m) => m.requestId));
    const members = await this.prisma.featureRequest.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, redactedTitle: true, redactedDescription: true },
    });
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const memberById = new Map(members.map((m) => [m.id, m]));
    return candidates
      .filter((c) => groupById.has(c.groupId))
      .map((c) => {
        const group = groupById.get(c.groupId)!;
        return {
          groupId: group.id,
          title: group.title,
          needStatement: group.needStatement,
          members: c.memberHits
            .map((hit) => memberById.get(hit.requestId))
            .filter((m): m is NonNullable<typeof m> => m !== undefined)
            // Providers only ever receive redacted member text.
            .map((m) => ({
              requestId: m.id,
              title: m.redactedTitle,
              description: m.redactedDescription,
            })),
        };
      });
  }

  private async recordFailure(
    requestId: string,
    runId: string,
    attempt: number,
    error: unknown,
    latencyMs: number,
  ) {
    const stage = error instanceof TriageStageError ? error.stage : 'internal';
    const code = errorCodeFor(error instanceof TriageStageError ? error.cause : error);
    // Log codes only: provider messages could echo request text.
    this.logger.warn(`Triage run ${runId} failed at ${stage}: ${code}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.triageRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          errorCode: code,
          errorStage: stage,
          latencyMs,
          completedAt: new Date(),
          suggestionStatus: 'SUPERSEDED',
        },
      });
      await tx.featureRequest.updateMany({
        where: { id: requestId, processingAttempts: attempt, processingStatus: 'PROCESSING' },
        data: { processingStatus: 'FAILED', processingError: code, processingStartedAt: null },
      });
      await this.audit.record(tx, {
        type: 'TRIAGE_FAILED',
        actor: SYSTEM_ACTOR,
        requestId,
        details: { triageRunId: runId, errorCode: code, stage },
      });
    });
  }
}
