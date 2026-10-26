import { API_PREFIX, ApiErrorSchema, HealthResponseSchema } from '@fis/contracts';
import { z } from 'zod';
import { APP_VERSION } from '../version';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** One documented operation. Request/response bodies reuse the shared contract schemas. */
export interface RouteSpec {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  requestBody?: z.ZodType;
  responses: Record<number, { description: string; schema?: z.ZodType }>;
}

/** Registry of documented routes. Every controller route must appear here (checked by tests). */
export const ROUTES: RouteSpec[] = [
  {
    method: 'get',
    path: `${API_PREFIX}/health`,
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
];

const toJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' });

/** Builds an OpenAPI 3.1 document (JSON Schema 2020-12) from the route registry. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ROUTES) {
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(route.responses)) {
      responses[status] = {
        description: response.description,
        ...(response.schema
          ? { content: { 'application/json': { schema: toJsonSchema(response.schema) } } }
          : {}),
      };
    }
    responses.default = {
      description: 'Error envelope',
      content: { 'application/json': { schema: toJsonSchema(ApiErrorSchema) } },
    };

    paths[route.path] ??= {};
    paths[route.path]![route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      ...(route.requestBody
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(route.requestBody) } },
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
        'Local-development API. There is no authentication yet: do not expose it publicly without an access-control layer.',
    },
    paths,
  };
}
