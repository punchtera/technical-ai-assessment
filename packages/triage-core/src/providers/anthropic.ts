import Anthropic from '@anthropic-ai/sdk';
import {
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentUserMessage,
  buildExtractionUserMessage,
  EXTRACTION_SYSTEM_PROMPT,
} from '../prompts/prompts.js';
import {
  CANDIDATE_ASSESSMENT_JSON_SCHEMA,
  type CandidateAssessment,
} from '../schemas/assessment.js';
import { NEED_EXTRACTION_JSON_SCHEMA, type NeedExtraction } from '../schemas/need-extraction.js';
import { ProviderError } from './errors.js';
import type {
  CandidateAssessor,
  CandidateContext,
  NeedExtractor,
  ProviderCallResult,
  ProviderRequestText,
} from './types.js';

export type Effort = 'low' | 'medium' | 'high';

export interface AnthropicConfig {
  apiKey: string;
  /** Verified identifiers (docs/ai-integration.md). No silent substitution. */
  extractionModel: string;
  assessmentModel: string;
  extractionEffort: Effort;
  assessmentEffort: Effort;
  maxTokens: number;
  /** Test seam: inject a client double. */
  client?: Pick<Anthropic, 'messages'>;
}

const PROVIDER = 'anthropic';

/** Maps SDK and transport errors onto retry-relevant categories without leaking request text. */
export function classifyAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ProviderError('timeout', PROVIDER, 'request aborted by timeout');
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError('timeout', PROVIDER, 'timeout');
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderError('unavailable', PROVIDER, 'connection error');
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const retryAfter = Number(error.headers?.get?.('retry-after'));
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    const details = JSON.stringify(error.error ?? {});
    if (status === 429 && details.includes('enforced_spend_limit_reached')) {
      return new ProviderError('spend_limit', PROVIDER, 'monthly spend limit reached');
    }
    if (status === 429)
      return new ProviderError('rate_limited', PROVIDER, 'rate limited', retryAfterMs);
    if (status === 401 || status === 403)
      return new ProviderError('auth', PROVIDER, `HTTP ${status}`);
    if (status === 408) return new ProviderError('timeout', PROVIDER, 'HTTP 408');
    if (status >= 500)
      return new ProviderError('unavailable', PROVIDER, `HTTP ${status}`, retryAfterMs);
    return new ProviderError('bad_request', PROVIDER, `HTTP ${status}`);
  }
  return new ProviderError('unavailable', PROVIDER, 'unexpected client error');
}

async function structuredCall(
  config: AnthropicConfig,
  client: Pick<Anthropic, 'messages'>,
  model: string,
  effort: Effort,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ProviderCallResult<never>> {
  let response: Anthropic.Message;
  try {
    response = (await client.messages.create(
      {
        model,
        max_tokens: config.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        // Structured outputs + effort (verified against SDK 1.3.0 types and the docs).
        output_config: { format: { type: 'json_schema', schema }, effort },
      },
      { signal },
    )) as Anthropic.Message;
  } catch (error) {
    throw classifyAnthropicError(error);
  }

  if (response.stop_reason === 'refusal')
    throw new ProviderError('refusal', PROVIDER, 'model refused');
  if (response.stop_reason === 'max_tokens')
    throw new ProviderError('truncated', PROVIDER, 'output truncated');

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProviderError('invalid_response', PROVIDER, 'output is not JSON');
  }
  return {
    raw,
    model: response.model ?? model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

function clientFor(config: AnthropicConfig): Pick<Anthropic, 'messages'> {
  // Retries are handled by the pipeline's bounded policy, so SDK retries are off.
  return config.client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: 60_000 });
}

export class AnthropicNeedExtractor implements NeedExtractor {
  private readonly client: Pick<Anthropic, 'messages'>;
  readonly model: string;

  constructor(private readonly config: AnthropicConfig) {
    this.client = clientFor(config);
    this.model = config.extractionModel;
  }

  extract(
    request: ProviderRequestText,
    signal?: AbortSignal,
  ): Promise<ProviderCallResult<NeedExtraction>> {
    return structuredCall(
      this.config,
      this.client,
      this.config.extractionModel,
      this.config.extractionEffort,
      EXTRACTION_SYSTEM_PROMPT,
      buildExtractionUserMessage(request),
      NEED_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
      signal,
    );
  }
}

export class AnthropicCandidateAssessor implements CandidateAssessor {
  private readonly client: Pick<Anthropic, 'messages'>;
  readonly model: string;

  constructor(private readonly config: AnthropicConfig) {
    this.client = clientFor(config);
    this.model = config.assessmentModel;
  }

  assess(
    request: ProviderRequestText,
    need: NeedExtraction,
    candidates: CandidateContext[],
    signal?: AbortSignal,
  ): Promise<ProviderCallResult<CandidateAssessment>> {
    return structuredCall(
      this.config,
      this.client,
      this.config.assessmentModel,
      this.config.assessmentEffort,
      ASSESSMENT_SYSTEM_PROMPT,
      buildAssessmentUserMessage(request, need, candidates),
      CANDIDATE_ASSESSMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
      signal,
    );
  }
}
