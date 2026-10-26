import {
  AddSupportSchema,
  AiStatusSchema,
  API_PREFIX,
  ApiErrorSchema,
  CreateFeatureRequestSchema,
  FeatureRequestDetailSchema,
  FeatureRequestListSchema,
  HealthResponseSchema,
  ListGroupsQuerySchema,
  ListRequestsQuerySchema,
  NeedGroupDetailSchema,
  NeedGroupListSchema,
  RequestHistorySchema,
  RetryTriageResultSchema,
  ReverseMembershipInputSchema,
  ReviewDecisionInputSchema,
  ReviewResultSchema,
  SupportResultSchema,
} from '@fis/contracts';
import { z } from 'zod';
import { APP_VERSION } from '../version';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** One documented operation. Bodies, queries and responses reuse the shared contract schemas. */
export interface RouteSpec {
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/v1/requests/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  query?: z.ZodObject;
  headers?: { name: string; required: boolean; description: string }[];
  requestBody?: z.ZodType;
  responses: Record<number, { description: string; schema?: z.ZodType }>;
}

const actorHeader = {
  name: 'X-Actor',
  required: true,
  description:
    'Reviewer handle (e.g. "pm.ana"). Trusted as-is: there is no authentication in this version.',
};
const R = (path: string) => `${API_PREFIX}${path}`;

/** Registry of documented routes. A unit test checks it matches the controllers exactly. */
export const ROUTES: RouteSpec[] = [
  {
    method: 'get',
    path: R('/health'),
    operationId: 'getHealth',
    summary: 'Service and dependency health',
    tags: ['system'],
    responses: {
      200: {
        description: 'API, database and pgvector are available',
        schema: HealthResponseSchema,
      },
      503: { description: 'A dependency is unavailable', schema: HealthResponseSchema },
    },
  },
  {
    method: 'get',
    path: R('/system/ai'),
    operationId: 'getAiStatus',
    summary: 'Active AI provider configuration (no secrets)',
    tags: ['system'],
    responses: { 200: { description: 'Configuration', schema: AiStatusSchema } },
  },
  {
    method: 'post',
    path: R('/requests'),
    operationId: 'createRequest',
    summary: 'Submit a feature request (queued for AI triage when configured)',
    tags: ['requests'],
    headers: [
      { name: 'Idempotency-Key', required: false, description: 'Repeat-safe submission key' },
    ],
    requestBody: CreateFeatureRequestSchema,
    responses: {
      201: { description: 'Created', schema: FeatureRequestDetailSchema },
      200: {
        description: 'Already submitted with this Idempotency-Key',
        schema: FeatureRequestDetailSchema,
      },
    },
  },
  {
    method: 'get',
    path: R('/requests'),
    operationId: 'listRequests',
    summary:
      'List and search requests (use reviewStatus=pending_review&sort=oldest for the triage queue)',
    tags: ['requests'],
    query: ListRequestsQuerySchema,
    responses: { 200: { description: 'Page of requests', schema: FeatureRequestListSchema } },
  },
  {
    method: 'get',
    path: R('/requests/{id}'),
    operationId: 'getRequest',
    summary: 'Request with its latest AI recommendation, evidence and approved group',
    tags: ['requests'],
    responses: { 200: { description: 'Request detail', schema: FeatureRequestDetailSchema } },
  },
  {
    method: 'get',
    path: R('/requests/{id}/history'),
    operationId: 'getRequestHistory',
    summary: 'Audit events and human decisions for a request',
    tags: ['requests'],
    responses: { 200: { description: 'History', schema: RequestHistorySchema } },
  },
  {
    method: 'post',
    path: R('/requests/{id}/supports'),
    operationId: 'supportRequest',
    summary: 'Express interest in a request (idempotent per supporter)',
    tags: ['requests'],
    requestBody: AddSupportSchema,
    responses: {
      201: { description: 'Support recorded', schema: SupportResultSchema },
      200: { description: 'Already supported', schema: SupportResultSchema },
    },
  },
  {
    method: 'post',
    path: R('/requests/{id}/triage'),
    operationId: 'retryTriage',
    summary: 'Re-queue AI processing (safe to repeat)',
    tags: ['triage'],
    headers: [actorHeader],
    responses: {
      202: { description: 'Queued (or already in progress)', schema: RetryTriageResultSchema },
      409: { description: 'AI not configured or request already grouped', schema: ApiErrorSchema },
    },
  },
  {
    method: 'post',
    path: R('/requests/{id}/decisions'),
    operationId: 'decideRequest',
    summary: 'Human review decision: link to a group, create a group, or reject the AI suggestion',
    tags: ['review'],
    headers: [actorHeader],
    requestBody: ReviewDecisionInputSchema,
    responses: {
      201: { description: 'Decision recorded', schema: ReviewResultSchema },
      409: {
        description: 'State conflict (already grouped, stale version, concurrent decision)',
        schema: ApiErrorSchema,
      },
    },
  },
  {
    method: 'post',
    path: R('/memberships/{id}/reversal'),
    operationId: 'reverseMembership',
    summary: 'Reverse an approved assignment (request returns to the queue)',
    tags: ['review'],
    headers: [actorHeader],
    requestBody: ReverseMembershipInputSchema,
    responses: {
      200: { description: 'Reversed', schema: ReviewResultSchema },
      409: { description: 'Already reversed', schema: ApiErrorSchema },
    },
  },
  {
    method: 'get',
    path: R('/groups'),
    operationId: 'listGroups',
    summary: 'Need groups with approved member and distinct supporter counts',
    tags: ['groups'],
    query: ListGroupsQuerySchema,
    responses: { 200: { description: 'Page of groups', schema: NeedGroupListSchema } },
  },
  {
    method: 'get',
    path: R('/groups/{id}'),
    operationId: 'getGroup',
    summary: 'Need group with its approved member requests (original text)',
    tags: ['groups'],
    responses: { 200: { description: 'Group detail', schema: NeedGroupDetailSchema } },
  },
];

const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' });

/** Builds an OpenAPI 3.1 document (JSON Schema 2020-12) from the route registry. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ROUTES) {
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(route.responses)) {
      responses[status] = {
        description: response.description,
        ...(response.schema
          ? { content: { 'application/json': { schema: toJsonSchema(response.schema, 'output') } } }
          : {}),
      };
    }
    responses.default = {
      description: 'Error envelope',
      content: { 'application/json': { schema: toJsonSchema(ApiErrorSchema, 'output') } },
    };

    const parameters: unknown[] = [];
    for (const match of route.path.matchAll(/\{(\w+)\}/g)) {
      parameters.push({
        name: match[1],
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    }
    if (route.query) {
      const json = toJsonSchema(route.query, 'input') as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(json.properties ?? {})) {
        parameters.push({
          name,
          in: 'query',
          required: json.required?.includes(name) ?? false,
          schema,
        });
      }
    }
    for (const header of route.headers ?? []) {
      parameters.push({
        name: header.name,
        in: 'header',
        required: header.required,
        description: header.description,
        schema: { type: 'string' },
      });
    }

    paths[route.path] ??= {};
    paths[route.path]![route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      ...(parameters.length ? { parameters } : {}),
      ...(route.requestBody
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(route.requestBody, 'input') } },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Feature Intelligence System API',
      version: APP_VERSION,
      description:
        'AI-assisted feature-request triage. AI output is advisory: only human decisions create group memberships. ' +
        'Local-development API with no authentication — do not expose it publicly without an access-control layer.',
    },
    paths,
  };
}
