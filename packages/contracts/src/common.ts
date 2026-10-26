import { z } from 'zod';

/** Every public route lives under `/api/v{API_VERSION}`. */
export const API_VERSION = '1';
export const API_PREFIX = `/api/v${API_VERSION}`;

/** Stable, machine-readable error codes returned by the API. */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof ApiIssueSchema>;

/** Consistent error envelope for every non-2xx response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    issues: z.array(ApiIssueSchema).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
