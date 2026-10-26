import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma's pg adapter sends timestamps without an offset and assumes the
 * session runs in UTC. Pinning the session time zone makes stored instants
 * correct regardless of the server's default TimeZone setting.
 */
export function createPgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
}

/**
 * Prisma 7 client using the `pg` driver adapter (no native query engine).
 * The connection is opened lazily, so the API can start — and report a
 * degraded health status — even when the database is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: AppEnv) {
    super({ adapter: createPgAdapter(env.DATABASE_URL) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
