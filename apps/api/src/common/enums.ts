import type { ProcessingStatus, ReviewStatus, SourceChannel } from '@fis/contracts';
import {
  ProcessingStatus as DbProcessingStatus,
  ReviewStatus as DbReviewStatus,
  SourceChannel as DbSourceChannel,
} from '../generated/prisma/enums';

/** Database enums are UPPER_CASE; API contracts use lower_case. */
export const toApi = <T extends string>(value: string): T => value.toLowerCase() as T;

export const toDbSourceChannel = (value: SourceChannel): DbSourceChannel =>
  value.toUpperCase() as DbSourceChannel;
export const toDbReviewStatus = (value: ReviewStatus): DbReviewStatus =>
  value.toUpperCase() as DbReviewStatus;
export const toDbProcessingStatus = (value: ProcessingStatus): DbProcessingStatus =>
  value.toUpperCase() as DbProcessingStatus;

export { DbProcessingStatus, DbReviewStatus, DbSourceChannel };
