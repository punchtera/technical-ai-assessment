import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { TriageProviders } from '@fis/triage-core';
import request from 'supertest';
import { TRIAGE_PROVIDERS } from '../../src/ai/ai.module';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { TriageWorker } from '../../src/triage/triage.worker';

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  worker: TriageWorker;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule against the test database. The worker loop is
 * disabled so tests drive processing deterministically with `worker.drain()`.
 * `providers` overrides the configured AI providers with a controlled double.
 */
export async function createTestApp(
  options: {
    aiProvider?: 'none' | 'deterministic-test';
    providers?: TriageProviders;
  } = {},
): Promise<TestApp> {
  process.env.AI_PROVIDER = options.aiProvider ?? 'deterministic-test';
  process.env.TRIAGE_WORKER_ENABLED = 'false';

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.providers)
    builder = builder.overrideProvider(TRIAGE_PROVIDERS).useValue(options.providers);
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }),
  );
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    worker: app.get(TriageWorker),
    close: () => app.close(),
  };
}

/** Empties all domain tables (keeps migrations and embedding spaces). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_events, supports, request_embeddings, group_memberships, review_decisions, triage_runs, need_groups, feature_requests CASCADE',
  );
}
