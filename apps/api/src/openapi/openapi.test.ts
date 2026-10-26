import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, ROUTES } from './openapi';

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument();

  it('is OpenAPI 3.1 and documents every registered route under a versioned prefix', () => {
    expect(doc.openapi).toBe('3.1.0');
    for (const route of ROUTES) {
      expect(route.path.startsWith('/api/v1/')).toBe(true);
      expect(doc.paths[route.path]?.[route.method]).toBeDefined();
    }
  });

  it('includes the shared error envelope as the default response', () => {
    const op = doc.paths['/api/v1/health']?.get as { responses: Record<string, unknown> };
    expect(op.responses.default).toBeDefined();
    expect(JSON.stringify(op.responses.default)).toContain('VALIDATION_FAILED');
  });
});
