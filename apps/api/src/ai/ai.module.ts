import { Global, Module } from '@nestjs/common';
import {
  createProviders,
  DEFAULT_RETRIEVAL_PARAMS,
  type RetrievalParams,
  type TriageProviders,
} from '@fis/triage-core';
import { APP_ENV, type AppEnv } from '../config/env';

/** Injection tokens. `TRIAGE_PROVIDERS` is null when AI_PROVIDER=none. */
export const TRIAGE_PROVIDERS = Symbol('TRIAGE_PROVIDERS');
export const RETRIEVAL_PARAMS = Symbol('RETRIEVAL_PARAMS');

/** The vector column is vector(1024); every configured embedding space must match it. */
export const EMBEDDING_COLUMN_DIMENSIONS = 1024;

export function embeddingSpaceId(providers: TriageProviders): string {
  const { provider, model, dimensions } = providers.embedder.space;
  return `${provider}:${model}:${dimensions}`;
}

@Global()
@Module({
  providers: [
    {
      provide: TRIAGE_PROVIDERS,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): TriageProviders | null => {
        const providers = createProviders({
          mode: env.AI_PROVIDER,
          anthropicApiKey: env.ANTHROPIC_API_KEY,
          voyageApiKey: env.VOYAGE_API_KEY,
          extractionModel: env.ANTHROPIC_EXTRACTION_MODEL,
          assessmentModel: env.ANTHROPIC_ASSESSMENT_MODEL,
          extractionEffort: env.ANTHROPIC_EXTRACTION_EFFORT,
          assessmentEffort: env.ANTHROPIC_ASSESSMENT_EFFORT,
          maxTokens: env.ANTHROPIC_MAX_TOKENS,
          embeddingModel: env.VOYAGE_EMBEDDING_MODEL,
          embeddingDimensions: EMBEDDING_COLUMN_DIMENSIONS,
        });
        if (providers && providers.embedder.space.dimensions !== EMBEDDING_COLUMN_DIMENSIONS) {
          throw new Error(
            `Embedding dimension ${providers.embedder.space.dimensions} does not match the vector(${EMBEDDING_COLUMN_DIMENSIONS}) column`,
          );
        }
        return providers;
      },
    },
    {
      provide: RETRIEVAL_PARAMS,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): RetrievalParams => ({
        ...DEFAULT_RETRIEVAL_PARAMS,
        candidateLimit: env.RETRIEVAL_CANDIDATE_LIMIT,
        minSimilarity: env.RETRIEVAL_MIN_SIMILARITY,
      }),
    },
  ],
  exports: [TRIAGE_PROVIDERS, RETRIEVAL_PARAMS],
})
export class AiModule {}
