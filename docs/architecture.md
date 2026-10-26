# Architecture

Status: **step 3 of 3**: complete initial product. Web UI, REST API, AI pipeline, audit history, demo tooling and end-to-end tests are in place.

## Application boundaries

```
 apps/web (React + Vite) ──HTTP /api/v1──▶ apps/api (NestJS)
        │                                    │ controllers → services → Prisma / pgvector repo
        ▼                                    │ TriageWorker → TriageService → runTriage()
 packages/contracts ◀──── shared Zod ────────┤
                                             ▼
                               packages/triage-core (framework-free pipeline)
                                 redaction · need extraction · retrieval aggregation
                                 candidate assessment · proposal rules · retries
                                 Anthropic / Voyage adapters · deterministic test provider
                                             ▲
 packages/evaluation (dev only) ─────────────┘  runs the SAME pipeline offline on data/synthetic
```

Dependencies point one way only:

- `apps/web` → `@fis/contracts`. It never imports API code, Prisma types or `triage-core`.
- `apps/api` → `@fis/contracts`, `@fis/triage-core`, and the Prisma client (generated into `apps/api/src/generated`, git-ignored).
- `@fis/evaluation` → `@fis/triage-core`. Nothing in `apps/` or `triage-core` may import the evaluation package or `data/synthetic/**`. ESLint `no-restricted-imports` and `isolation.test.ts` enforce this.

Why `triage-core` is a separate package: the offline evaluation has to measure the code that actually runs in production. Keeping the pipeline free of Nest and Prisma lets both the API (with pgvector) and the evaluation harness (with in-memory cosine) call the same `runTriage()`.

## Frontend (`apps/web`)

React 19 + Vite 7 + `react-router` 7, the only UI dependency added. There's no state library: each page loads what it needs through `useResource` (explicit loading / error / ready states, polling while processing) and refetches from the API after every mutation.

| Route                    | Page         | Purpose                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                      | Triage queue | Filters (awaiting decision / grouped / all) and search. Each row shows processing and review state, extracted need, and the recommendation **marked "not approved"** or the approved group                                                                                                                                        |
| `/submit`                | Submission   | Client-side validation with the shared contract and character counters. One `Idempotency-Key` per draft prevents duplicates. Live processing status after submission                                                                                                                                                              |
| `/requests/:id`          | Review       | Original text with verified quotes highlighted; extracted need and quotes with their verification result and source; recommendation with confidence, flags and rationale; candidate groups; actions (approve, reject, link to another candidate or any group, create group, retry, reverse); support; run details; audit timeline |
| `/groups`, `/groups/:id` | Groups       | Need statement, approved members (original text) with links to each request and its history, distinct supporter counts                                                                                                                                                                                                            |

Design rules enforced in the UI:

- **Proposed vs approved.** A recommendation is always labelled "Proposed (not approved)". Only an active membership is shown as "Approved".
- **Explicit actions.** Every membership change needs a confirmation step. Buttons disable while a request is in flight.
- **Server as the authority.** The UI never applies rules itself. Every decision sends `expectedVersion`, so stale screens get a 409 instead of a silent overwrite. The UI always refetches after an attempt.
- **Evidence is shown exactly as returned.** Quotes and their `valid` flags come from the API, and invalid quotes are shown as "not trusted". Highlighting marks only exact occurrences.
- **Recommendations are never presented as AI by accident.** A global banner (`/system/ai`) and per-run tags mark the deterministic provider as "Demo provider · not AI".
- **Reviewer identity.** The reviewer types a handle, which is sent as `X-Actor` and kept in `localStorage`. The UI never invents an actor.

## Demo and end-to-end tooling

- `apps/api/scripts/demo.mjs` provides `setup`, `reset --yes`, `api` and `seed` against a dedicated `*_demo` database. Seeding goes through the public API and refuses unless the API reports `demoMode`. See [demo.md](demo.md).
- `apps/api/scripts/e2e-api.mjs` migrates and empties the `*_test` database, then starts the built API with the deterministic provider for Playwright (`apps/web/e2e`).
- `DEMO_MODE` only labels the server (the `demoMode` flag in `/system/ai`). It never changes business rules.

## Domain model

| Table                | Role                                                                                                  | Key rules                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature_requests`   | **Source record.** Original title and description stored verbatim, plus a redacted copy for providers | `review_status` (pending_review / grouped) and `processing_status` (queued / processing / completed / failed / not_configured) are independent, so an AI failure never blocks review. `version` gives optimistic concurrency. `idempotency_key` is unique                          |
| `triage_runs`        | **AI recommendation**, one per processing attempt                                                     | Unique `(request_id, attempt)`, so a duplicate attempt cannot create a second run. Stores validated stage outputs, quote-check results, candidate aliases, models, prompt and pipeline versions, usage and latency. `suggestion_status` is open / accepted / rejected / superseded |
| `review_decisions`   | **Human decision** (link, create group, reject suggestion, reverse)                                   | Immutable. Records the actor and whether the decision matched the AI proposal                                                                                                                                                                                                      |
| `group_memberships`  | **Approved relationship**, created only by a decision                                                 | `active_request_id` is UNIQUE: it equals the request id while active and is NULL once reversed, so a request has at most one active group. A CHECK constraint keeps status and key consistent. Reversal is a new decision, never a delete                                          |
| `need_groups`        | Human-approved need (title + need statement)                                                          | Created only by a `create_group` decision                                                                                                                                                                                                                                          |
| `supports`           | "Express interest"                                                                                    | Unique `(request_id, supporter_ref)`. Group support = distinct supporters across active members                                                                                                                                                                                    |
| `audit_events`       | Append-only history                                                                                   | Written in the **same transaction** as each state change. Holds ids, codes and actions, never request text                                                                                                                                                                         |
| `request_embeddings` | `vector(1024)` of the extracted need statement                                                        | Keyed by request and embedding space. Retrieval is filtered by space, so vectors from different models never mix                                                                                                                                                                   |
| `embedding_spaces`   | Provider + model + dimension                                                                          | Registering an existing id with a different configuration is refused                                                                                                                                                                                                               |

All timestamps are `timestamptz`. Prisma's `pg` adapter sends timestamps without an offset, so every connection pins `TimeZone=UTC` (`createPgAdapter`). The integration tests caught this: on a server whose session time zone was not UTC, lease expiry was computed hours wrong.

## Pipeline (one triage attempt)

| Stage         | Where                                            | AI?            | What happens                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Input      | `RequestsService.create`                         | no             | Zod validation (title 3–200, description 10–5000, strict body, 32 kB cap). Emails and phone numbers are masked into a redacted copy. Request + audit row are written in one transaction, status `queued` (or `not_configured`) |
| Claim         | `TriageWorker.claimNext`                         | no             | `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` sets `processing` and increments attempts. Abandoned claims are reclaimed after `TRIAGE_LEASE_MS`, then `FAILED / MAX_ATTEMPTS_EXCEEDED`                               |
| B. Need       | `runTriage` → `NeedExtractor`                    | **LLM**        | Structured output → `NeedExtractionSchema` (strict). Every quote is checked deterministically as an exact substring                                                                                                            |
| C. Retrieval  | `runTriage` → `Embedder` + `EmbeddingRepository` | **embeddings** | Embeds the need statement. Exact cosine kNN over approved members in the same space, excluding self. Aggregated to groups (max member similarity), floor `RETRIEVAL_MIN_SIMILARITY`, top `RETRIEVAL_CANDIDATE_LIMIT`           |
| D. Assessment | `runTriage` → `CandidateAssessor`                | **LLM**        | Skipped when there are no candidates. The model sees aliases (`C1`, `C1.M1`), never database ids. Output is a discriminated union (`match` / `no_match` / `uncertain`). Unknown aliases and non-verbatim quotes are flagged    |
| Proposal      | `buildProposal`                                  | no             | Deterministic rules. `link_existing` only for a high or medium confidence match with valid two-sided evidence and no flags. Otherwise `needs_review` (with any suggested group) or `create_group`                              |
| Persist       | `TriageService.process`                          | no             | Embedding, run and audit in one transaction. The request only completes if the claim is still current                                                                                                                          |
| E. Review     | `ReviewService`                                  | **human**      | Locks the request row (`FOR UPDATE`). Rules in `review-rules.ts`. Creates the decision → membership → audit event. The unique key is the final backstop against concurrent approvals                                           |
| F. Failure    | everywhere                                       | no             | See "Failure handling" below                                                                                                                                                                                                   |

**Deterministic vs AI.** Only stages B, C (the embedding call) and D use models. Validation, redaction, retrieval filtering and ranking, quote checks, id checks, proposal rules, state transitions, retries and audit are ordinary code.

### Failure handling

| Failure                                                   | Behaviour                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout, 429, 5xx/529, connection error                   | Bounded retry: 2 retries, exponential backoff with full jitter, honouring `retry-after`, capped at 8 s. SDK retries are off so there is one policy |
| Spend cap (429 `enforced_spend_limit_reached`), auth, 400 | No retry. Run `FAILED` with a code                                                                                                                 |
| Refusal / `max_tokens`                                    | `MODEL_REFUSAL` / `OUTPUT_TRUNCATED`, no automatic retry                                                                                           |
| Non-JSON or schema-invalid output                         | One re-ask, then `MALFORMED_OUTPUT`                                                                                                                |
| Fabricated quote, unknown candidate alias                 | Not a failure: the proposal is downgraded to `needs_review` with a flag                                                                            |
| Wrong embedding dimension or non-finite values            | `EMBEDDING_INCOMPATIBLE`                                                                                                                           |
| Crash mid-run                                             | Lease expiry → reclaim (new attempt number), up to `TRIAGE_MAX_ATTEMPTS`                                                                           |
| Duplicate processing                                      | Unique `(request_id, attempt)` → second processor exits as `duplicate`                                                                             |
| AI not configured / outage                                | Requests, groups, history and manual review keep working. `POST /requests/:id/triage` re-queues safely (a no-op while queued or processing)        |

Error codes and stages are stored and logged. Provider messages and request text are not.

## API (v1)

`/api/docs` (Swagger UI) and `/api/docs/openapi.json` (OpenAPI 3.1) are generated from the shared Zod contracts. A unit test asserts the registry matches the controllers' routes exactly.

| Method | Path                                   | Purpose                                                                                    |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/health`                       | DB + pgvector status (503 when degraded)                                                   |
| GET    | `/api/v1/system/ai`                    | Active AI mode, models, test-provider flag (no secrets)                                    |
| POST   | `/api/v1/requests`                     | Submit (optional `Idempotency-Key`)                                                        |
| GET    | `/api/v1/requests`                     | List and search. The triage queue is `?reviewStatus=pending_review&sort=oldest`            |
| GET    | `/api/v1/requests/:id`                 | Detail with latest recommendation, extracted need, candidates and traced evidence          |
| GET    | `/api/v1/requests/:id/history`         | Audit events + decisions                                                                   |
| POST   | `/api/v1/requests/:id/supports`        | Express interest (idempotent per supporter)                                                |
| POST   | `/api/v1/requests/:id/triage`          | Safe retry of AI processing (`X-Actor`)                                                    |
| POST   | `/api/v1/requests/:id/decisions`       | `link` / `create_group` / `reject_suggestion`, with optional `expectedVersion` (`X-Actor`) |
| POST   | `/api/v1/memberships/:id/reversal`     | Reverse an approved assignment (`X-Actor`)                                                 |
| GET    | `/api/v1/groups`, `/api/v1/groups/:id` | Groups with member and distinct supporter counts, and approved members' original text      |

**Authentication is out of scope** (deferred by the design). `X-Actor` is a validated, trusted handle. Run the API locally or on a trusted network only.

## Major decisions

| Decision          | Choice                                                                  | Why                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces + Turborepo                                             | Required stack. Turbo orders package builds before apps                                                                 |
| Contracts         | Zod 4 in `@fis/contracts`, ESM + CJS builds                             | One definition for request validation, response validation (API and web) and OpenAPI                                    |
| Pipeline package  | `@fis/triage-core`, ESM + CJS                                           | Evaluation runs the production code path                                                                                |
| Orchestration     | Plain TypeScript stages + DB-backed worker                              | Fixed, linear workflow. No agent framework, queue server or multi-agent system is justified (design §6.1)               |
| Structured output | Anthropic `output_config.format` (JSON Schema) + strict Zod validation  | Provider schemas can't express lengths or counts, so the app enforces them                                              |
| IDs in prompts    | Aliases only (`C1`, `C1.M1`), mapped server-side                        | The model cannot reference a database id that would be accepted                                                         |
| Vector search     | pgvector exact scan (no ANN index)                                      | Perfect recall and fast at hundreds to low thousands of rows. An HNSW index can be added later without changing callers |
| Consistency       | Row lock + unique active key + CHECK constraint                         | Correct under concurrent reviewers, enforced by the database                                                            |
| Validation        | `ZodValidationPipe`, `UuidPipe`, header decorators, global error filter | Uniform `{ error: { code, message, issues? } }`                                                                         |
| Config            | Zod-validated env; unverified model ids refused at startup              | No silent model substitution                                                                                            |
| ORM               | Prisma 7.10 + `@prisma/adapter-pg` (`prisma-client` generator, CJS)     | Latest stable Prisma, no native query engine at runtime                                                                 |

### Version choices

Latest stable majors were checked on npm on 2026-10-25. Some packages are deliberately one major behind the newest:

| Package             | Used          | Newest        | Reason                                                                                                 |
| ------------------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| TypeScript          | 5.9.3         | 7.0.2         | `typescript-eslint` 8.72 supports `<6.1`; NestJS decorator metadata depends on `emitDecoratorMetadata` |
| NestJS              | 11.2.8        | 12.2.0        | 11.x is compatible with the other pinned packages. Upgrading is a separate task                        |
| Prisma              | 7.10.1        | 8.0.0-rc.27   | `latest` is a release candidate                                                                        |
| Vite / Vitest       | 7.3.7 / 3.2.7 | 8.3.5 / 5.0.5 | Known-compatible pair; no feature needs the newer majors                                               |
| ESLint              | 9.39.5        | 10.13.0       | Matches `@eslint/js` 9 and the plugins used                                                            |
| `@anthropic-ai/sdk` | 1.3.0         | 1.3.0         | Types `output_config.format` and `effort`                                                              |

All versions are pinned exactly; `pnpm-lock.yaml` is committed.
