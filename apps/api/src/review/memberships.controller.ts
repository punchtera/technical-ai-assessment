import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ReverseMembershipInputSchema,
  type ReverseMembershipInput,
  type ReviewResult,
} from '@fis/contracts';
import { Actor, UuidPipe } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewService } from './review.service';

@Controller({ path: 'memberships' })
export class MembershipsController {
  constructor(private readonly review: ReviewService) {}

  /** Reverses an approved assignment; the request returns to the review queue. */
  @Post(':id/reversal')
  @HttpCode(HttpStatus.OK)
  reverse(
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(ReverseMembershipInputSchema)) body: ReverseMembershipInput,
    @Actor() actor: string,
  ): Promise<ReviewResult> {
    return this.review.reverse(id, body.reason, actor);
  }
}
