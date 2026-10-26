# AI integration

Status: **no AI provider is integrated yet (step 1).** This page records what has been verified so far and what step 2 still has to verify before any provider code is written. Nothing here sends data to an external service.

## Proposed providers (from product-design.md §6.2)

| Role                                                             | Proposed default                                                            | Status                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Need extraction + candidate assessment                           | Anthropic **Claude Haiku 5.5** (`claude-haiku-5-5`) with structured outputs | Partly verified (below). Pricing and rate limits **not yet verified from official docs**.       |
| Stronger assessment model (only if evaluation shows it's needed) | Anthropic **Claude Sonnet 5.5** (`claude-sonnet-5-5`)                       | Not a fallback. It will only be configured explicitly if the dev-split evaluation justifies it. |
| Embeddings                                                       | Voyage AI **`voyage-4-lite`**                                               | Verified (below)                                                                                |

## Verified so far (2026-10-25)

### Anthropic structured outputs

Source: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

- Generally available. JSON outputs go in `output_config.format` (`type: "json_schema"`). The older `output_format` parameter is deprecated and needs a beta header. Strict tool use (`strict: true`) is the alternative mechanism.
- The supported-model list includes Haiku 5.5 and Sonnet 5.5. The docs' own examples use ids in the `claude-<family>-5-5` form.
- Schema limits that affect our contracts:
  - objects need `additionalProperties: false`
  - no recursive schemas
  - no `minimum`/`maximum`
  - no `minLength`/`maxLength`
  - `minItems` only 0 or 1
  - at most 24 optional parameters and 16 union-typed parameters per request

  Our runtime Zod validation must therefore enforce the constraints the provider schema can't (lengths, counts, quote fidelity, id membership).

- Structured outputs can't be combined with citations or message prefilling.
- `stop_reason: "refusal"` or `"max_tokens"` can produce non-conforming output. Retry `max_tokens` once with a higher limit; never retry a refusal automatically.
- Enum casing isn't guaranteed, so compare case-insensitively.
- Compiled schemas are cached for 24 h. Changing the schema structure invalidates the cache, which adds first-call latency.

### Voyage AI embeddings

Sources: [Text embeddings](https://docs.voyageai.com/embeddings/), [Pricing](https://docs.voyageai.com/docs/pricing), [Rate limits](https://docs.voyageai.com/docs/rate-limits).

| Model           | Context    | Dimensions                     | Price / 1M tokens | Tier 1 limits      |
| --------------- | ---------- | ------------------------------ | ----------------- | ------------------ |
| `voyage-4-lite` | 32k tokens | 1024 (default), 256, 512, 2048 | $0.02             | 16M TPM / 2000 RPM |
| `voyage-4`      | 32k tokens | 1024 (default), 256, 512, 2048 | $0.06             | 8M TPM / 2000 RPM  |

- The first 200M tokens are free per account (doesn't apply to the Batch API).
- Tier 2 and Tier 3 limits are 2× and 3× Tier 1.
- 4-series embeddings are compatible with each other.
- `input_type: "document"` / `"query"` add a fixed retrieval prompt. Embeddings with and without `input_type` are compatible.
- Maximum texts and tokens per request: see the API reference. **Not yet checked.**

Implication for the schema: vector columns will be `vector(1024)`, and the model + dimension pair is recorded in `embedding_spaces` so embeddings from a different model or dimension can't be mixed silently.

### Database

- Verified locally: PostgreSQL 16.15 with pgvector 0.8.1, the cosine distance operator `<=>`, and Prisma 7.10.1 migrations creating the extension (integration tests).
- Docker Compose uses `pgvector/pgvector:pg16`. That image couldn't be pulled in the build sandbox (Docker Hub blocked), so the image itself is not verified here. Run `pnpm db:up && pnpm test:integration` locally to confirm.

## Still to verify in step 2 (before writing provider code)

1. Anthropic pricing and rate limits for Haiku 5.5 / Sonnet 5.5 from the official pricing and rate-limit pages. Third-party articles describe new Haiku 5.5 pricing that depends on prompt length; these are not used as a source.
2. The current official TypeScript SDK (`@anthropic-ai/sdk`, 1.3.0 on npm) and whether it types `output_config.format`.
3. Voyage per-request batch limits, and whether to call the REST endpoint directly or use an SDK.
4. Data-retention terms for both providers.

## Data handling (planned, step 2)

- Only request title and description text is sent to providers, after PII masking (emails, phone numbers). The original text stays in our database as the evidence source.
- No API keys in the browser. Keys are read server-side from `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`, and are optional: without them the app keeps working, AI processing shows as "not configured", and manual triage is available.
- Tests and the default evaluation use a **clearly labelled deterministic test provider**, kept separate from real adapters. Live-provider tests will be opt-in, with their cost noted.
- Model output is treated as data, never as instructions: it is schema-validated, quotes are checked against the source, and candidate ids are checked against the supplied set before anything is stored.
