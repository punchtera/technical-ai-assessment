# AI integration

Status: **implemented (step 2), live calls not yet verified.** The Anthropic and Voyage adapters are built and unit-tested against controlled doubles, and they are opt-in. No live provider call has been made from this project yet, because no API keys were available while building it. See "Verification status".

## Provider modes (`AI_PROVIDER`)

| Mode                 | What runs                                                                                                                                                                                                                                                                                                                                                                         | Keys                                  | Data leaving the machine                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default)     | No AI. Requests are `not_configured`; reviewers triage manually                                                                                                                                                                                                                                                                                                                   | none                                  | nothing                                                                                                                                                  |
| `deterministic-test` | **Labelled non-AI stand-in** (v2): "extraction" = title + first sentence; embeddings = feature hashing of stemmed words and character 4-grams; "assessment" = word-overlap rule with match / uncertain / no-match. No synonym lists or dataset knowledge. Every run is stored with `provider = "deterministic-test"` and `is_test_provider = true`, and the API exposes that flag | none                                  | nothing                                                                                                                                                  |
| `anthropic-voyage`   | Claude for need extraction and candidate assessment; Voyage for embeddings                                                                                                                                                                                                                                                                                                        | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | redacted title and description of the new request and of up to 3 members of each of up to 5 candidate groups; candidate group titles and need statements |

There is no implicit fallback between modes, and Sonnet is **not** configured as a fallback. A stronger assessment model would only be set explicitly (`ANTHROPIC_ASSESSMENT_MODEL=claude-sonnet-5-5`) if the dev-split evaluation shows Haiku falls short.

## Verified provider facts (checked 2026-10-25)

### Anthropic

Sources: [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [rate limits](https://platform.claude.com/docs/en/api/rate-limits), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [effort](https://platform.claude.com/docs/en/build-with-claude/effort).

**Models.** `claude-haiku-5-5` (default for both LLM stages) and `claude-sonnet-5-5` (allowed, not used by default). The factory refuses any other id.

**Haiku 5.5 specifics:**

- Released 2026-10-07, active. 1M-token context, 128K max output.
- Adaptive thinking is on by default and counts toward `max_tokens`, so `ANTHROPIC_MAX_TOKENS` defaults to 4096.
- `temperature`, `top_p` and `top_k` must be omitted (the adapter never sends them).
- The new tokenizer counts about 30% more tokens than Haiku 4.5 for the same text.

**Structured outputs.** GA, using `output_config.format = { type: "json_schema", schema }`.

- Schemas need `additionalProperties: false`, no length or numeric constraints, and `minItems` of only 0 or 1. The app enforces the rest with Zod.
- Not compatible with citations or prefill.
- Refusal and `max_tokens` stops can break the schema, so the adapter treats them as errors.

**Effort.** `output_config.effort`. Defaults here: `low` for extraction, `medium` for assessment.

**SDK.** `@anthropic-ai/sdk` 1.3.0 (CommonJS + ESM). It types `output_config.format` and `effort`. SDK retries are disabled (`maxRetries: 0`) so the pipeline's bounded policy is the only one.

**Pricing per MTok** (prompts ≤ 100K tokens):

| Model      | Input | Output |
| ---------- | ----- | ------ |
| Haiku 5.5  | $0.10 | $0.50  |
| Sonnet 5.5 | $2    | $10    |

- Haiku prompts over 100K tokens cost $0.50 / $2.50. This pipeline's prompts are a few thousand tokens.
- The Batch API halves these prices.

**Rate limits** (Haiku 5.5):

- Start tier: 1,000 RPM, 2M ITPM, 400K OTPM.
- Build tier: 5,000 RPM, 5M ITPM, 1M OTPM.
- A 429 may carry `retry-after`. The spend-cap 429 (`error_code: enforced_spend_limit_reached`) has none and is not retried.

### Voyage AI

Sources: [embeddings](https://docs.voyageai.com/embeddings/), [API reference](https://docs.voyageai.com/reference-link/embeddings-api), [pricing](https://docs.voyageai.com/docs/pricing), [rate limits](https://docs.voyageai.com/docs/rate-limits).

- **Model:** `voyage-4-lite` (default) or `voyage-4`. 32K-token context. Dimensions 256, 512, 1024 (default) or 2048. The app uses **1024**, matching the `vector(1024)` column.
- **Endpoint:** `POST https://api.voyageai.com/v1/embeddings` with `input`, `model`, `input_type`, `output_dimension` and `truncation`. Up to 1,000 inputs and 1M tokens per request.
- **Response:** the response schema isn't spelled out in the reference page. The adapter validates `{ data: [{ embedding, index }] }` at runtime and fails closed.
- **Input type:** the need statement is embedded with `input_type: "document"` both when it is stored and when it is used as a query. This is a symmetric need-vs-need comparison, and one call per request.
- **Price:** voyage-4-lite costs $0.02 per 1M tokens, with the first 200M tokens free.
- **Rate limits:** Tier 1 is 16M TPM / 2,000 RPM.

### Database

PostgreSQL 16 with pgvector 0.8.1 (cosine `<=>`) and Prisma 7.10.1 migrations, verified by integration tests. Docker Compose uses `pgvector/pgvector:pg16`, which your machine ran successfully with step 1.

## Cost and latency (estimates, not measured)

Per request:

- One extraction call: about 0.5K input and up to about 1K output tokens, including thinking.
- One embedding call.
- One assessment call, unless there are no candidates: about 1.5–2.5K input and up to about 1.5K output.

At Haiku 5.5 prices that is roughly $0.001 per request. A full 201-request evaluation run is likely well under $1. These are estimates from prompt sizes. The real numbers will come from `usage` recorded on each run and in the evaluation report.

Triage is asynchronous, so submission never waits on AI. End-to-end latency per request hasn't been measured yet.

## Data handling

1. **Original text is stored verbatim.** It is the evidence a reviewer inspects (`feature_requests.title` / `description`).
2. **A redacted copy is the only text sent to providers.** Emails and phone-like numbers become `[email]` / `[phone]`, and ISO dates are left alone. Masked values are never stored separately; only counts are (`redaction_summary`).
3. **Quotes are checked against the redacted copy the provider saw.** Placeholders never reveal the masked value.
4. **Regex masking is a baseline, not a guarantee.** Names, addresses, account numbers and free-form identifiers are not detected. Before using real customer data:
   - review this policy,
   - check both providers' data-retention terms (not yet reviewed), and
   - decide whether submitter names should be collected at all. Today none are: `supporterRef` and `X-Actor` are pseudonymous handles.
5. **Nothing is retained beyond what the workflow needs.** Run records keep the validated structured outputs (need statements and quotes from the redacted text) for traceability and evaluation. Raw provider responses and messages are not stored. Logs contain run ids and error codes only.
6. **Prompt-injection posture.**
   - Request text is framed as untrusted data inside tags, and frame-breaking closing tags are neutralised.
   - The system prompts say to ignore instructions in the data.
   - Output is used only after schema validation, id checks and exact-quote checks.
   - Model text is never executed, and the UI renders it as plain text.
7. **Secrets** are read server-side only and are never returned, logged or sent to the browser. `GET /api/v1/system/ai` exposes the mode and model ids, not keys.

## Verification status

| Item                                                                        | Status                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Model ids, pricing, limits, structured-output and effort parameters         | Verified from official docs (links above)                                                       |
| SDK request shape                                                           | Verified against `@anthropic-ai/sdk` 1.3.0 type definitions; unit tests assert the request body |
| Adapter error mapping (429 / retry-after / spend cap / 529 / 401 / timeout) | Unit-tested with SDK error classes and fake fetch                                               |
| Live Anthropic + Voyage calls                                               | **Not run**: no credentials in the build environment                                            |
| Prompt quality, model accuracy, cost and latency                            | **Unknown** until `pnpm eval --matcher ai` runs                                                 |

### Running the live checks (opt-in, paid, synthetic data only)

```bash
# two-request smoke test of both adapters and the full pipeline
RUN_LIVE_AI_TESTS=1 ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... pnpm test:live

# full offline evaluation with real models (≈ 400 LLM calls + 200 embedding calls)
RUN_LIVE_AI_EVAL=1 ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... pnpm eval --matcher ai
# cheaper first pass:   ... pnpm eval --matcher ai --limit 20
```
