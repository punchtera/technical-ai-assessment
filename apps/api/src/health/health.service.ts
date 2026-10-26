import { Injectable, Logger } from '@nestjs/common';
import type { HealthResponse } from '@fis/contracts';
import { PrismaService } from '../database/prisma.service';
import { APP_VERSION } from '../version';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    let database: HealthResponse['checks']['database'] = 'down';
    let pgvector: HealthResponse['checks']['pgvector'] = 'unknown';

    try {
      const rows = await this.prisma.$queryRaw<{ extversion: string }[]>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      database = 'up';
      pgvector = rows.length > 0 ? 'enabled' : 'missing';
    } catch (error) {
      // Log the error class only; connection strings must not reach logs.
      this.logger.warn(`Database health check failed: ${(error as Error).name}`);
    }

    return {
      status: database === 'up' && pgvector === 'enabled' ? 'ok' : 'degraded',
      version: APP_VERSION,
      checks: { database, pgvector },
      time: new Date().toISOString(),
    };
  }
}
