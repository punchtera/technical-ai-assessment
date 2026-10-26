import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { GroupsController } from '../groups/groups.controller';
import { HealthController } from '../health/health.controller';
import { RequestsController } from '../requests/requests.controller';
import { MembershipsController } from '../review/memberships.controller';
import { SystemController } from '../system/system.controller';
import { buildOpenApiDocument, ROUTES } from './openapi';

/** Reads the routes Nest will register, straight from controller metadata. */
function controllerRoutes(): string[] {
  const routes: string[] = [];
  for (const controller of [
    HealthController,
    SystemController,
    RequestsController,
    MembershipsController,
    GroupsController,
  ]) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      const handler = proto[key];
      if (key === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const path = `/api/v1/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(
        /:(\w+)/g,
        '{$1}',
      );
      routes.push(`${RequestMethod[method].toLowerCase()} ${path}`);
    }
  }
  return routes.sort();
}

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument();

  it('documents exactly the routes the controllers register', () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual(controllerRoutes());
  });

  it('is OpenAPI 3.1 with versioned paths and the error envelope on every operation', () => {
    expect(doc.openapi).toBe('3.1.0');
    for (const route of ROUTES) {
      expect(route.path.startsWith('/api/v1/')).toBe(true);
      const op = doc.paths[route.path]?.[route.method] as { responses: Record<string, unknown> };
      expect(JSON.stringify(op.responses.default)).toContain('VALIDATION_FAILED');
    }
  });

  it('documents path, query and header parameters', () => {
    const decide = doc.paths['/api/v1/requests/{id}/decisions']?.post as {
      parameters: { name: string; in: string }[];
    };
    expect(decide.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path' }),
        expect.objectContaining({ name: 'X-Actor', in: 'header' }),
      ]),
    );
    const list = doc.paths['/api/v1/requests']?.get as { parameters: { name: string }[] };
    expect(list.parameters.map((p) => p.name)).toEqual(
      expect.arrayContaining(['q', 'reviewStatus', 'limit']),
    );
  });
});
