# Architecture

Status: step 1 (foundation). Sections marked _(step 2)_ or _(step 3)_ describe planned work, not code that exists yet.

## Application boundaries

```
             ┌────────────────────┐      HTTP /api/v1 (JSON)     ┌──────────────────────────┐
             │  apps/web          │ ───────────────────────────▶ │  apps/api (NestJS)        │
             │  React + Vite      │                              │  controllers → services   │
             │  typed API client  │ ◀─────────────────────────── │  Prisma (pg adapter)      │
             └─────────┬──────────┘   validated by contracts     └────────────┬─────────────┘
                       │                                                       │
                       ▼                                                       ▼
             ┌────────────────────┐                              ┌──────────────────────────┐
             │ packages/contracts │ ◀──── shared Zod schemas ──── │ PostgreSQL 16 + pgvector │
             └────────────────────┘                              └──────────────────────────┘

 packages/evaluation (dev only) ── reads data/synthetic/** ── never imported by apps
```

Dependencies only point one way:

- `apps/web` → `@fis/contracts`. The web app never imports API code, Prisma types or the database.
- `apps/api` → `@fis/contracts`, Prisma client (generated into `apps/api/src/generated`, git-ignored).
- `@fis/evaluation` depends on nothing in `apps/`. ESLint (`no-restricted-imports`) and a unit test stop application code from importing ground-truth files or the evaluation package.

## Major decisions

| Decision                | Choice                                                                                                             | Why                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo                | pnpm workspaces + Turborepo                                                                                        | Required stack. Turbo orders builds (`contracts` before the apps) and caches tasks.                                                                                                 |
| Contracts               | Zod 4 schemas in `@fis/contracts`, built as both ESM (Vite) and CJS (NestJS)                                       | One definition drives request validation, response validation in the web client and the OpenAPI document.                                                                           |
| OpenAPI                 | Built from the Zod contracts (`z.toJSONSchema`, OpenAPI 3.1) and served with `@nestjs/swagger`'s UI at `/api/docs` | Avoids keeping duplicate DTO classes in sync with the contracts. A unit test checks that every registered route is documented.                                                      |
| API validation          | `ZodValidationPipe` + global `ApiExceptionFilter` → uniform `{ error: { code, message, issues? } }`                | Consistent errors; unknown errors are logged by class name only (no bodies, SQL or connection strings).                                                                             |
| Versioning              | URI versioning, `/api/v1/...`                                                                                      | Required; the version constant lives in contracts so both sides agree.                                                                                                              |
| Body limits             | JSON bodies capped at `API_BODY_LIMIT` (default 32 kB) → 413                                                       | Requests are short text; caps protect the API.                                                                                                                                      |
| ORM                     | Prisma 7.10 with `@prisma/adapter-pg` and the `prisma-client` generator (`moduleFormat = "cjs"`)                   | Latest stable Prisma. Prisma 7 needs no native query engine; CJS output matches NestJS.                                                                                             |
| Vector search           | pgvector, enabled through Prisma's `postgresqlExtensions` preview feature in the first migration                   | Keeps vectors in the main relational store (design §6.2). Vector columns use `Unsupported("vector(N)")` and are queried with narrowly scoped, parameterised `$queryRaw` _(step 2)_. |
| Embedding configuration | `embedding_spaces` table: provider, model and dimension, unique together                                           | Vector dimensions are fixed per column. Recording the model + dimension explicitly lets step 2 refuse to mix incompatible embeddings.                                               |
| Config                  | Zod-validated environment at startup (`apps/api/src/config/env.ts`)                                                | Fails fast with field names, never echoes secret values.                                                                                                                            |
| Health                  | `GET /api/v1/health` reports database + pgvector; 503 when degraded                                                | Lets the web app show a real "degraded" state instead of hiding failures.                                                                                                           |
| Tests                   | Vitest everywhere; SWC plugin for NestJS decorator metadata; integration tests on a separate `fis_test` database   | Fast unit tests with no DB; integration tests apply real migrations first.                                                                                                          |

### Version choices

Latest _stable_ majors were checked on npm on 2026-10-25. A few packages are deliberately one major behind the newest release:

| Package       | Used          | Newest                     | Reason                                                                                                                                    |
| ------------- | ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript    | 5.9.3         | 7.0.2                      | `typescript-eslint` 8.72 supports `<6.1`; NestJS decorator metadata depends on the JS compiler (`emitDecoratorMetadata`).                 |
| NestJS        | 11.2.8        | 12.2.0                     | Nest 12 is a new major; 11.x is still published and is compatible with the other pinned packages. Upgrade is a separate, reversible task. |
| Prisma        | 7.10.1        | 8.0.0-rc.27 (`latest` tag) | The `latest` tag points to a release candidate; 7.10.1 is the newest stable release.                                                      |
| Vite / Vitest | 7.3.7 / 3.2.7 | 8.3.5 / 5.0.5              | Known-compatible pair for this toolchain; no feature in this project needs the newer majors.                                              |
| ESLint        | 9.39.5        | 10.13.0                    | Matches `@eslint/js` 9 and the plugins used.                                                                                              |

All versions are pinned exactly, and `pnpm-lock.yaml` is committed.

## Planned domain and pipeline _(step 2)_

The pipeline in [product-design.md §5.2](product-design.md) becomes explicit, typed stages: input handling → need extraction (LLM, structured output, exact-quote validation) → candidate retrieval (embeddings + pgvector) → candidate assessment (LLM, discriminated-union result limited to the supplied candidate ids) → human review (approve, reject, new group, reversal) → failure handling (bounded retries, visible processing state). Proposals and approved memberships live in separate tables, so no AI output can become an approved assignment without a recorded human decision.
