import { AnthropicCandidateAssessor, AnthropicNeedExtractor, type Effort } from './anthropic.js';
import { createDeterministicTestProviders } from './deterministic.js';
import type { TriageProviders } from './types.js';
import { VoyageEmbedder } from './voyage.js';

/**
 * Explicit provider selection. There is no implicit fallback: with
 * `none` (the default) no AI processing happens and requests go to manual
 * triage; `deterministic-test` must be chosen on purpose and is labelled.
 */
export type ProviderMode = 'none' | 'anthropic-voyage' | 'deterministic-test';

/** Verified model identifiers (see docs/ai-integration.md, checked 2026-10-25). */
export const VERIFIED_MODELS = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  voyage: ['voyage-4-lite', 'voyage-4'],
} as const;

export interface ProviderSettings {
  mode: ProviderMode;
  anthropicApiKey?: string;
  voyageApiKey?: string;
  extractionModel: string;
  assessmentModel: string;
  extractionEffort: Effort;
  assessmentEffort: Effort;
  maxTokens: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

export const DEFAULT_PROVIDER_SETTINGS: Omit<ProviderSettings, 'mode'> = {
  extractionModel: 'claude-haiku-5-5',
  assessmentModel: 'claude-haiku-5-5',
  extractionEffort: 'low',
  assessmentEffort: 'medium',
  maxTokens: 4096,
  embeddingModel: 'voyage-4-lite',
  embeddingDimensions: 1024,
};

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

export function createProviders(settings: ProviderSettings): TriageProviders | null {
  if (settings.mode === 'none') return null;
  if (settings.mode === 'deterministic-test') return createDeterministicTestProviders();

  if (!settings.anthropicApiKey || !settings.voyageApiKey) {
    throw new ProviderConfigurationError(
      'AI_PROVIDER=anthropic-voyage requires ANTHROPIC_API_KEY and VOYAGE_API_KEY',
    );
  }
  for (const model of [settings.extractionModel, settings.assessmentModel]) {
    if (!(VERIFIED_MODELS.anthropic as readonly string[]).includes(model)) {
      throw new ProviderConfigurationError(`Unverified Anthropic model identifier: ${model}`);
    }
  }
  if (!(VERIFIED_MODELS.voyage as readonly string[]).includes(settings.embeddingModel)) {
    throw new ProviderConfigurationError(
      `Unverified Voyage model identifier: ${settings.embeddingModel}`,
    );
  }

  const anthropic = {
    apiKey: settings.anthropicApiKey,
    extractionModel: settings.extractionModel,
    assessmentModel: settings.assessmentModel,
    extractionEffort: settings.extractionEffort,
    assessmentEffort: settings.assessmentEffort,
    maxTokens: settings.maxTokens,
  };
  return {
    label: 'anthropic+voyage',
    isTestProvider: false,
    extractor: new AnthropicNeedExtractor(anthropic),
    assessor: new AnthropicCandidateAssessor(anthropic),
    embedder: new VoyageEmbedder({
      apiKey: settings.voyageApiKey,
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions,
    }),
  };
}
