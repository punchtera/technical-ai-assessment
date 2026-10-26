import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  AddSupportSchema,
  CreateFeatureRequestSchema,
  ListRequestsQuerySchema,
  ReviewDecisionInputSchema,
  type AddSupport,
  type FeatureRequestDetail,
  type FeatureRequestList,
  type RequestHistory,
  type RetryTriageResult,
  type ReviewDecisionInput,
  type ReviewResult,
  type SupportResult,
} from '@fis/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Actor, IdempotencyKey, UuidPipe } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewService } from '../review/review.service';
import { RequestsService } from './requests.service';

/** Thin HTTP layer: validation at the boundary, business rules in services. */
@Controller({ path: 'requests' })
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly review: ReviewService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateFeatureRequestSchema))
    body: z.output<typeof CreateFeatureRequestSchema>,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FeatureRequestDetail> {
    const { created, request } = await this.requests.create(body, idempotencyKey);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return request;
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(ListRequestsQuerySchema))
    query: z.output<typeof ListRequestsQuerySchema>,
  ): Promise<FeatureRequestList> {
    return this.requests.list(query);
  }

  @Get(':id')
  get(@Param('id', UuidPipe) id: string): Promise<FeatureRequestDetail> {
    return this.requests.get(id);
  }

  @Get(':id/history')
  history(@Param('id', UuidPipe) id: string): Promise<RequestHistory> {
    return this.requests.history(id);
  }

  @Post(':id/supports')
  async support(
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(AddSupportSchema)) body: AddSupport,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SupportResult> {
    const result = await this.requests.addSupport(id, body.supporterRef);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  /** Safe retry of AI processing (idempotent while a run is queued or in progress). */
  @Post(':id/triage')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('id', UuidPipe) id: string, @Actor() actor: string): Promise<RetryTriageResult> {
    return this.requests.retryTriage(id, actor);
  }

  /** Human review decision: link, create a group, or reject the suggestion. */
  @Post(':id/decisions')
  @HttpCode(HttpStatus.CREATED)
  decide(
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(ReviewDecisionInputSchema)) body: ReviewDecisionInput,
    @Actor() actor: string,
  ): Promise<ReviewResult> {
    return this.review.decide(id, body, actor);
  }
}
