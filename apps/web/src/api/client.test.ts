import { describe, expect, it } from 'vitest';
import { ApiClientError, createApiClient } from './client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const health = {
  status: 'ok',
  version: '0.1.0',
  checks: { database: 'up', pgvector: 'enabled' },
  time: '2026-10-25T00:00:00.000Z',
};

describe('api client', () => {
  it('calls the versioned route and validates the response', async () => {
    let calledUrl = '';
    const client = createApiClient({
      baseUrl: 'http://api.test/',
      fetchImpl: async (url) => {
        calledUrl = String(url);
        return jsonResponse(200, health);
      },
    });
    await expect(client.getHealth()).resolves.toEqual(health);
    expect(calledUrl).toBe('http://api.test/api/v1/health');
  });

  it('returns a degraded health payload instead of throwing on 503', async () => {
    const degraded = {
      ...health,
      status: 'degraded',
      checks: { database: 'down', pgvector: 'unknown' },
    };
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: async () => jsonResponse(503, degraded),
    });
    await expect(client.getHealth()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('rejects responses that violate the contract', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: async () => jsonResponse(200, { status: 'ok' }),
    });
    await expect(client.getHealth()).rejects.toBeInstanceOf(ApiClientError);
  });

  it('reports an unreachable API distinctly', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    await expect(client.getHealth()).rejects.toMatchObject({ status: 0 });
  });
});
