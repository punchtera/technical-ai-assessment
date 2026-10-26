import type { CandidateAssessment } from '../schemas/assessment.js';
import type { NeedExtraction } from '../schemas/need-extraction.js';

/** Text exactly as sent to providers (already redacted). */
export interface ProviderRequestText {
  title: string;
  description: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderCallResult<T> {
  /** Raw provider output parsed as JSON but NOT yet validated by the pipeline. */
  raw: unknown;
  model: string;
  usage?: ModelUsage;
  /** Filled in by the pipeline after validation. */
  parsed?: T;
}

/** Stage B. */
export interface NeedExtractor {
  readonly model: string;
  extract(
    request: ProviderRequestText,
    signal?: AbortSignal,
  ): Promise<ProviderCallResult<NeedExtraction>>;
}

export interface EmbeddingSpaceConfig {
  provider: string;
  model: string;
  dimensions: number;
}

/** Stage C (embedding half). Retrieval itself is done by the caller (pgvector or in-memory). */
export interface Embedder {
  readonly space: EmbeddingSpaceConfig;
  embed(
    texts: string[],
    inputType: 'query' | 'document',
    signal?: AbortSignal,
  ): Promise<number[][]>;
}

/** What the assessor is shown about one retrieved candidate group. */
export interface CandidateContext {
  ref: string; // C1, C2, …
  title: string;
  needStatement: string;
  members: { ref: string; title: string; description: string }[]; // C1.M1, …
}

/** Stage D. */
export interface CandidateAssessor {
  readonly model: string;
  assess(
    request: ProviderRequestText,
    need: NeedExtraction,
    candidates: CandidateContext[],
    signal?: AbortSignal,
  ): Promise<ProviderCallResult<CandidateAssessment>>;
}

export interface TriageProviders {
  /** Stable label persisted on every run, e.g. "anthropic+voyage" or "deterministic-test". */
  readonly label: string;
  /** True only for the deterministic test provider; surfaced in the API and UI. */
  readonly isTestProvider: boolean;
  readonly extractor: NeedExtractor;
  readonly embedder: Embedder;
  readonly assessor: CandidateAssessor;
}
