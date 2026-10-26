import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { TriageService } from './triage.service';

/**
 * Database-backed job loop (no extra infrastructure).
 *
 * Claims use `FOR UPDATE SKIP LOCKED`, so several API instances never process
 * the same request at once. A claim increments `processing_attempts`, and the
 * run row is unique per (request, attempt), so a duplicate attempt cannot
 * produce a second recommendation. Abandoned claims (crash mid-run) are
 * reclaimed after TRIAGE_LEASE_MS, up to TRIAGE_MAX_ATTEMPTS, then FAILED.
 */
@Injectable()
export class TriageWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TriageWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly triage: TriageService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  get active(): boolean {
    return this.env.TRIAGE_WORKER_ENABLED && this.triage.enabled;
  }

  onApplicationBootstrap(): void {
    if (!this.active) {
      this.logger.log(
        this.triage.enabled
          ? 'Triage worker disabled by configuration'
          : 'AI_PROVIDER=none: triage worker idle',
      );
      return;
    }
    this.timer = setInterval(() => this.kick(), this.env.TRIAGE_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Starts a drain cycle unless one is already in progress. */
  kick(): void {
    if (!this.active || this.stopped || this.running) return;
    this.running = this.drain()
      .then(() => undefined)
      .catch((error: unknown) => this.logger.error(`Triage cycle failed: ${(error as Error).name}`))
      .finally(() => {
        this.running = null;
      });
  }

  /** Processes queued requests until none are left (used by tests and the loop). */
  async drain(maxJobs = 50): Promise<number> {
    await this.failExhausted();
    let processed = 0;
    while (processed < maxJobs && !this.stopped) {
      const claim = await this.claimNext();
      if (!claim) break;
      await this.triage.process(claim.id, claim.attempt);
      processed += 1;
    }
    return processed;
  }

  async claimNext(): Promise<{ id: string; attempt: number } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; processing_attempts: number }[]>`
      UPDATE feature_requests
      SET processing_status = 'PROCESSING',
          processing_started_at = now(),
          processing_attempts = processing_attempts + 1,
          updated_at = now()
      WHERE id = (
        SELECT id FROM feature_requests
        WHERE review_status = 'PENDING_REVIEW'
          AND (
            processing_status = 'QUEUED'
            OR (
              processing_status = 'PROCESSING'
              AND processing_started_at < now() - (${this.env.TRIAGE_LEASE_MS} * interval '1 millisecond')
              AND processing_attempts < ${this.env.TRIAGE_MAX_ATTEMPTS}
            )
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, processing_attempts
    `;
    const row = rows[0];
    return row ? { id: row.id, attempt: row.processing_attempts } : null;
  }

  /** Abandoned claims that used up their attempts become visible failures. */
  private async failExhausted(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE feature_requests
      SET processing_status = 'FAILED', processing_error = 'MAX_ATTEMPTS_EXCEEDED', processing_started_at = NULL, updated_at = now()
      WHERE processing_status = 'PROCESSING'
        AND processing_started_at < now() - (${this.env.TRIAGE_LEASE_MS} * interval '1 millisecond')
        AND processing_attempts >= ${this.env.TRIAGE_MAX_ATTEMPTS}
    `;
  }
}
