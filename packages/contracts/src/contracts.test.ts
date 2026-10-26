import { describe, expect, it } from 'vitest';
import { API_PREFIX, ApiErrorSchema, HealthResponseSchema } from './index.js';

describe('contracts', () => {
  it('uses a versioned API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });

  it('accepts a valid health payload and rejects an unknown status', () => {
    const valid = {
      status: 'ok',
      version: '0.1.0',
      checks: { database: 'up', pgvector: 'enabled' },
      time: new Date().toISOString(),
    };
    expect(HealthResponseSchema.parse(valid)).toEqual(valid);
    expect(HealthResponseSchema.safeParse({ ...valid, status: 'great' }).success).toBe(false);
  });

  it('describes errors with a stable code', () => {
    const parsed = ApiErrorSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid body',
        issues: [{ path: 'title', message: 'Required' }],
      },
    });
    expect(parsed.success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });
});
