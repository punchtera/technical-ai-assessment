# Feature Intelligence System

AI-first feature-request triage. When a request arrives, the system works out the underlying need, finds existing requests that express the same need, and proposes linking the request to an existing need group or creating a new one. **A product manager approves every assignment.** The AI never assigns a request to a group by itself.

Product rationale and scope are in [docs/product-design.md](docs/product-design.md).

> **Status: step 1 of 3 (foundation + evaluation data).** The monorepo, database, API and web shells, the synthetic dataset and the offline evaluation are in place. The domain model, the AI pipeline and the review endpoints come in step 2; the triage UI comes in step 3. See [Roadmap](#roadmap).

## Prerequisites

| Tool                                      | Version                      | Notes                                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                                   | ≥ 22.12 (22 LTS recommended) | `.nvmrc` pins 22. Check with `node -v`.                                                                                                                                                   |
| pnpm                                      | 10.28.0                      | **Use pnpm, not npm**: `npm install` is blocked by a preinstall check. Install with `npm install -g pnpm@10.28.0`, or `corepack enable` on Node ≤ 24 (Node 25+ no longer ships Corepack). |
| Docker Desktop (or another Docker engine) | any recent                   | Must be **running** before `pnpm db:up`. Provides PostgreSQL 16 with pgvector.                                                                                                            |

No AI provider credentials are needed for anything in step 1.

## Getting started

```bash
pnpm install                # not `npm install`

# environment files (local placeholders only)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# database: PostgreSQL 16 + pgvector on host port 5433 (plus a fis_test database)
# start Docker Desktop first; `docker info` should succeed
pnpm db:up
pnpm db:migrate:deploy      # apply migrations (enables the vector extension)
pnpm db:generate            # generate the Prisma client

# run both apps (API :3000, web :5173)
pnpm dev
```

Open http://localhost:5173 to see the web app's health panel and http://localhost:3000/api/docs for the OpenAPI docs.

Each app also runs on its own:

```bash
pnpm --filter @fis/api dev     # API only
pnpm --filter @fis/web dev     # web only (shows "API unavailable" if the API is down)
```

## Commands

| Command                             | What it does                                                  | Needs DB | Needs AI keys |
| ----------------------------------- | ------------------------------------------------------------- | -------- | ------------- |
| `pnpm dev`                          | Runs the API and web app in watch mode                        | API: yes | no            |
| `pnpm build`                        | Production builds of all packages                             | no       | no            |
| `pnpm test`                         | Unit tests (all packages)                                     | no       | no            |
| `pnpm test:integration`             | API integration tests against `TEST_DATABASE_URL`             | yes      | no            |
| `pnpm lint`                         | ESLint (flat config)                                          | no       | no            |
| `pnpm typecheck`                    | TypeScript `--noEmit` (strict)                                | no       | no            |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                        | no       | no            |
| `pnpm db:up` / `pnpm db:down`       | Start / stop PostgreSQL + pgvector (Docker)                   | —        | no            |
| `pnpm db:migrate`                   | Create and apply a new migration (development)                | yes      | no            |
| `pnpm db:migrate:deploy`            | Apply existing migrations                                     | yes      | no            |
| `pnpm db:generate`                  | Generate the Prisma client                                    | no       | no            |
| `pnpm dataset:generate`             | Regenerate the synthetic dataset from its catalog             | no       | no            |
| `pnpm dataset:validate`             | Check dataset integrity, label isolation and split leakage    | no       | no            |
| `pnpm eval`                         | Offline matching evaluation (step 1: non-AI lexical baseline) | no       | no            |

## Repository layout

```
apps/
  api/                NestJS REST API (versioned /api/v1, OpenAPI at /api/docs)
    prisma/           Prisma schema + SQL migrations (pgvector enabled here)
  web/                React + Vite app (typed API client, no DB access)
packages/
  contracts/          Shared Zod schemas + types (API ↔ web), ESM + CJS builds
  evaluation/         Dev-only dataset tooling and offline evaluation (never imported by apps)
data/
  synthetic/          Synthetic dataset: requests.jsonl (runtime inputs)
    ground-truth/     Labels, groups, splits and the authored catalog (evaluation only)
infra/postgres/init/  One-time database init (creates fis_test)
docs/                 Product design, architecture, development, AI integration, evaluation
```

## Security note

There is **no authentication** yet (deferred by the product design). Run the API only on your own machine or in a trusted environment, and never expose it publicly without an access-control layer. Never commit `.env` files; only the `*.env.example` placeholders are tracked.

## Roadmap

1. **Step 1 (done): foundation and evaluation data.** Monorepo, tooling, Postgres + pgvector, API/web shells, synthetic dataset, metrics, non-AI baseline.
2. **Step 2: domain, API and AI pipeline.** Data model, review/approve/reject/new-group/reversal rules with audit history, Voyage + Claude adapters (after verification), evidence validation, pgvector retrieval, failure handling, AI evaluation.
3. **Step 3: interface and verification.** Submission, triage queue, review screen, group pages, end-to-end tests, full verification run.

## Documentation

- [docs/product-design.md](docs/product-design.md): problem, use-case selection, workflow, metrics
- [docs/architecture.md](docs/architecture.md): boundaries and major decisions
- [docs/development.md](docs/development.md): local setup, database and test workflows
- [docs/ai-integration.md](docs/ai-integration.md): provider verification status, data handling, failure behaviour
- [docs/evaluation.md](docs/evaluation.md): dataset, ground truth, metrics, current results and limitations
