/** Failure categories that drive retry and processing-state decisions. */
export type ProviderErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'refusal'
  | 'truncated'
  | 'auth'
  | 'bad_request'
  | 'spend_limit';

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set([
  'timeout',
  'rate_limited',
  'unavailable',
]);

export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = RETRYABLE.has(kind);
  }
}

/** Error codes persisted on a failed triage run (no provider messages or request text). */
export type TriageErrorCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_SPEND_LIMIT'
  | 'MODEL_REFUSAL'
  | 'MALFORMED_OUTPUT'
  | 'OUTPUT_TRUNCATED'
  | 'EMBEDDING_INCOMPATIBLE'
  | 'INTERNAL_ERROR';

export function errorCodeFor(error: unknown): TriageErrorCode {
  if (error instanceof ProviderError) {
    switch (error.kind) {
      case 'timeout':
        return 'PROVIDER_TIMEOUT';
      case 'rate_limited':
        return 'PROVIDER_RATE_LIMITED';
      case 'unavailable':
        return 'PROVIDER_UNAVAILABLE';
      case 'auth':
        return 'PROVIDER_AUTH';
      case 'bad_request':
        return 'PROVIDER_BAD_REQUEST';
      case 'spend_limit':
        return 'PROVIDER_SPEND_LIMIT';
      case 'refusal':
        return 'MODEL_REFUSAL';
      case 'truncated':
        return 'OUTPUT_TRUNCATED';
      case 'invalid_response':
        return 'MALFORMED_OUTPUT';
    }
  }
  if (error instanceof EmbeddingCompatibilityError) return 'EMBEDDING_INCOMPATIBLE';
  return 'INTERNAL_ERROR';
}

export class EmbeddingCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingCompatibilityError';
  }
}
