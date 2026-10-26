import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ApiErrorSchema, HealthResponseSchema } from '@fis/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

describe('HTTP API (foundation)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports database and pgvector as available', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = HealthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ database: 'up', pgvector: 'enabled' });
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/api/v1/health']).toBeDefined();
  });

  it('returns the shared error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('rejects oversized JSON bodies with 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(64 * 1024) }))
      .expect(413);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });
});
