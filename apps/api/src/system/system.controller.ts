import { Controller, Get, Inject } from '@nestjs/common';
import { AiStatusSchema, type AiStatus } from '@fis/contracts';
import type { TriageProviders } from '@fis/triage-core';
import { TRIAGE_PROVIDERS } from '../ai/ai.module';
import { APP_ENV, type AppEnv } from '../config/env';
import { TriageWorker } from '../triage/triage.worker';

/** Which AI configuration is active. Never returns keys or other secrets. */
@Controller({ path: 'system' })
export class SystemController {
  constructor(
    @Inject(TRIAGE_PROVIDERS) private readonly providers: TriageProviders | null,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly worker: TriageWorker,
  ) {}

  @Get('ai')
  ai(): AiStatus {
    const p = this.providers;
    return AiStatusSchema.parse({
      mode: this.env.AI_PROVIDER,
      providerLabel: p?.label ?? null,
      isTestProvider: p?.isTestProvider ?? false,
      workerEnabled: this.worker.active,
      demoMode: this.env.DEMO_MODE,
      models: {
        extraction: p?.extractor.model ?? null,
        assessment: p?.assessor.model ?? null,
        embedding: p?.embedder.space.model ?? null,
      },
      embeddingDimensions: p?.embedder.space.dimensions ?? null,
    });
  }
}
