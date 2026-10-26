import {
  AiStatusSchema,
  API_PREFIX,
  ApiErrorSchema,
  FeatureRequestDetailSchema,
  FeatureRequestListSchema,
  HealthResponseSchema,
  NeedGroupDetailSchema,
  NeedGroupListSchema,
  RequestHistorySchema,
  RetryTriageResultSchema,
  ReviewResultSchema,
  SupportResultSchema,
  type AiStatus,
  type ApiIssue,
  type CreateFeatureRequest,
  type FeatureRequestDetail,
  type FeatureRequestList,
  type HealthResponse,
  type ListRequestsQuery,
  type NeedGroupDetail,
  type NeedGroupList,
  type RequestHistory,
  type RetryTriageResult,
  type ReviewDecisionInput,
  type ReviewResult,
  type SupportResult,
} from '@fis/contracts';
import type { z } from 'zod';

/** Error raised for any non-2xx or contract-violating API response. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

const toQueryString = (query: Query = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

/**
 * Typed API boundary. Every response is validated against the shared contract
 * schema, so the UI never renders data the API did not promise. Business rules
 * stay on the server; this client only transports and validates.
 */
export function createApiClient({ baseUrl, fetchImpl = fetch }: ApiClientOptions) {
  const root = `${baseUrl.replace(/\/$/, '')}${API_PREFIX}`;

  async function request<T extends z.ZodType>(
    path: string,
    schema: T,
    init: RequestInit & { actor?: string; idempotencyKey?: string; json?: unknown } = {},
    acceptStatuses: number[] = [],
  ): Promise<z.output<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.json !== undefined) headers['content-type'] = 'application/json';
    if (init.actor) headers['x-actor'] = init.actor;
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;

    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: init.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new ApiClientError('The API is unreachable. Is it running?', 0);
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
        parsedError.success ? (parsedError.data.error.issues ?? []) : [],
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
    getHealth: (): Promise<HealthResponse> => request('/health', HealthResponseSchema, {}, [503]),
    getAiStatus: (): Promise<AiStatus> => request('/system/ai', AiStatusSchema),

    createRequest: (
      input: CreateFeatureRequest,
      idempotencyKey: string,
    ): Promise<FeatureRequestDetail> =>
      request('/requests', FeatureRequestDetailSchema, { json: input, idempotencyKey }),
    listRequests: (
      query: ListRequestsQuery = {},
      signal?: AbortSignal,
    ): Promise<FeatureRequestList> =>
      request(`/requests${toQueryString(query as Query)}`, FeatureRequestListSchema, { signal }),
    getRequest: (id: string, signal?: AbortSignal): Promise<FeatureRequestDetail> =>
      request(`/requests/${encodeURIComponent(id)}`, FeatureRequestDetailSchema, { signal }),
    getHistory: (id: string, signal?: AbortSignal): Promise<RequestHistory> =>
      request(`/requests/${encodeURIComponent(id)}/history`, RequestHistorySchema, { signal }),
    addSupport: (id: string, supporterRef: string): Promise<SupportResult> =>
      request(`/requests/${encodeURIComponent(id)}/supports`, SupportResultSchema, {
        json: { supporterRef },
      }),
    retryTriage: (id: string, actor: string): Promise<RetryTriageResult> =>
      request(`/requests/${encodeURIComponent(id)}/triage`, RetryTriageResultSchema, {
        method: 'POST',
        actor,
      }),
    decide: (id: string, decision: ReviewDecisionInput, actor: string): Promise<ReviewResult> =>
      request(`/requests/${encodeURIComponent(id)}/decisions`, ReviewResultSchema, {
        json: decision,
        actor,
      }),
    reverseMembership: (
      membershipId: string,
      reason: string,
      actor: string,
    ): Promise<ReviewResult> =>
      request(`/memberships/${encodeURIComponent(membershipId)}/reversal`, ReviewResultSchema, {
        json: { reason },
        actor,
      }),

    listGroups: (
      query: { q?: string; limit?: number; offset?: number } = {},
      signal?: AbortSignal,
    ): Promise<NeedGroupList> =>
      request(`/groups${toQueryString(query)}`, NeedGroupListSchema, { signal }),
    getGroup: (id: string, signal?: AbortSignal): Promise<NeedGroupDetail> =>
      request(`/groups/${encodeURIComponent(id)}`, NeedGroupDetailSchema, { signal }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
