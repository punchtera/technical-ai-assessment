import { z } from 'zod';
import { ProviderError } from './errors.js';
import type { Embedder, EmbeddingSpaceConfig } from './types.js';

export interface VoyageConfig {
  apiKey: string;
  model: string;
  dimensions: number;
  baseUrl?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

const PROVIDER = 'voyage';
/** Documented maximum list length per request. */
export const VOYAGE_MAX_BATCH = 1000;

const ResponseSchema = z.object({
  data: z.array(
    z.object({ embedding: z.array(z.number()), index: z.number().int().nonnegative() }),
  ),
  model: z.string().optional(),
  usage: z.object({ total_tokens: z.number() }).optional(),
});

/** REST adapter for `POST /v1/embeddings` (fields verified in docs/ai-integration.md). */
export class VoyageEmbedder implements Embedder {
  readonly space: EmbeddingSpaceConfig;

  constructor(private readonly config: VoyageConfig) {
    this.space = { provider: PROVIDER, model: config.model, dimensions: config.dimensions };
  }

  async embed(
    texts: string[],
    inputType: 'query' | 'document',
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > VOYAGE_MAX_BATCH)
      throw new ProviderError('bad_request', PROVIDER, 'batch too large');

    const fetchImpl = this.config.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(
        `${this.config.baseUrl ?? 'https://api.voyageai.com'}/v1/embeddings`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            input: texts,
            model: this.config.model,
            input_type: inputType,
            output_dimension: this.config.dimensions,
            truncation: true,
          }),
          signal,
        },
      );
    } catch (error) {
      const name = (error as Error)?.name;
      throw new ProviderError(
        name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'unavailable',
        PROVIDER,
        'request failed',
      );
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const retryAfterMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      if (response.status === 429)
        throw new ProviderError('rate_limited', PROVIDER, 'rate limited', retryAfterMs);
      if (response.status === 401 || response.status === 403)
        throw new ProviderError('auth', PROVIDER, `HTTP ${response.status}`);
      if (response.status >= 500)
        throw new ProviderError('unavailable', PROVIDER, `HTTP ${response.status}`);
      throw new ProviderError('bad_request', PROVIDER, `HTTP ${response.status}`);
    }

    const parsed = ResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success || parsed.data.data.length !== texts.length) {
      throw new ProviderError('invalid_response', PROVIDER, 'unexpected embeddings response');
    }
    return [...parsed.data.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
