import {
  API_PREFIX,
  ApiErrorSchema,
  HealthResponseSchema,
  type HealthResponse,
} from '@fis/contracts';
import type { z } from 'zod';

/** Error raised for any non-2xx or contract-violating API response. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Typed API boundary. Every response is validated against the shared contract
 * schema, so the UI never renders data the API did not promise.
 */
export function createApiClient({ baseUrl, fetchImpl = fetch }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/$/, '')}${API_PREFIX}`;

  async function request<T extends z.ZodType>(
    path: string,
    schema: T,
    init?: RequestInit,
    acceptStatuses: number[] = [],
  ): Promise<z.output<T>> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: { accept: 'application/json', ...init?.headers },
      });
    } catch {
      throw new ApiClientError('The API is unreachable', 0);
    }

    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok && !acceptStatuses.includes(response.status)) {
      const parsedError = ApiErrorSchema.safeParse(body);
      throw new ApiClientError(
        parsedError.success
          ? parsedError.data.error.message
          : `Request failed (${response.status})`,
        response.status,
        parsedError.success ? parsedError.data.error.code : undefined,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiClientError('The API returned an unexpected response', response.status);
    }
    return parsed.data;
  }

  return {
    /** 503 is an expected answer (degraded) and is returned rather than thrown. */
    getHealth: (): Promise<HealthResponse> =>
      request('/health', HealthResponseSchema, undefined, [503]),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
