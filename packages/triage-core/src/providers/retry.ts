import { ProviderError } from './errors.js';

export interface RetryPolicy {
  /** Retries after the first attempt (so total attempts = retries + 1). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry with exponential backoff + full jitter, honouring a provider
 * `retry-after` hint. Only `ProviderError`s marked retryable are retried;
 * everything else (malformed output, refusals, auth) fails immediately.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  sleep: Sleep = realSleep,
  random: () => number = Math.random,
): Promise<{ value: T; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await operation(attempt), attempts: attempt };
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt > policy.retries) throw error;
      const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      const hinted = error.retryAfterMs ?? 0;
      await sleep(Math.min(policy.maxDelayMs, Math.max(hinted, Math.floor(random() * backoff))));
    }
  }
}
