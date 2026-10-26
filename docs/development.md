# Development

## First-time setup

```bash
npm install -g pnpm@10.28.0     # or `corepack enable` on Node <= 24
pnpm install                    # npm/yarn are rejected by scripts/ensure-pnpm.mjs
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:up                      # PostgreSQL 16 + pgvector, host port 5433
pnpm db:migrate:deploy
pnpm db:generate
```

pnpm 10 only runs dependency install scripts that are allowed in `pnpm-workspace.yaml` (`onlyBuiltDependencies`). Prisma, SWC, esbuild and `@nestjs/core` are allowed; `@scarf/scarf` (telemetry) is ignored on purpose.

## Database

### PostgreSQL and pgvector

`docker-compose.yml` runs the `pgvector/pgvector:pg16` image: PostgreSQL 16 with pgvector preinstalled.

- Host port **5433** (container 5432), so it doesn't collide with a local PostgreSQL.
- User `fis`, password `fis_local_dev`, database `fis`. These are local placeholders, not secrets.
- `infra/postgres/init/01-create-test-database.sql` creates `fis_test` **only when the volume is first created**. If you created the volume before this file existed, run `docker compose down -v` (this deletes local data) or `docker exec fis-postgres createdb -U fis fis_test`.

The extension is installed by the image and **enabled by the first Prisma migration** (`CREATE EXTENSION IF NOT EXISTS "vector"`). pgvector is not a trusted extension, so the migrating role needs superuser rights. The Docker `POSTGRES_USER` is a superuser; on a managed database, enable `vector` once as an admin before running migrations.

Check it:

```bash
docker exec -it fis-postgres psql -U fis -d fis -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
curl -s localhost:3000/api/v1/health    # "pgvector": "enabled"
```

### Prisma workflow

Prisma 7 reads its connection URL from `apps/api/prisma.config.ts`, which loads `apps/api/.env`.

| Task                                   | Command                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Change the schema → new migration      | edit `apps/api/prisma/schema.prisma`, then `pnpm db:migrate` (prompts for a name)                     |
| Apply migrations (CI, fresh DB, tests) | `pnpm db:migrate:deploy`                                                                              |
| Regenerate the client                  | `pnpm db:generate` (also runs automatically before `dev`, `build`, `typecheck` and integration tests) |

The generated client goes to `apps/api/src/generated/prisma` (git-ignored).

Hand-written SQL in migrations: `20…_domain_model` ends with a CHECK constraint that keeps `group_memberships.status` and `active_request_id` consistent. Prisma does not model CHECK constraints and leaves them alone in later diffs.

Vector columns: Prisma has no native vector type, so they're declared as `Unsupported("vector(<dims>)")`. Queries that read or write them go through parameterised `$queryRaw` tagged templates, never string concatenation. The integration test `database.int.test.ts` shows the pattern (`embedding <=> ${query}::vector`).

## Tests

| Suite               | Command                 | Needs                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------- |
| Unit (all packages) | `pnpm test`             | nothing (no DB, no network, no AI keys)                             |
| API integration     | `pnpm test:integration` | PostgreSQL running and `TEST_DATABASE_URL` set (in `apps/api/.env`) |

Integration tests:

1. apply all migrations to `TEST_DATABASE_URL` (global setup), and
2. override `DATABASE_URL` with the test database inside each worker, so development data is never touched.

They cover:

- migrations, pgvector, the UTC session time zone and parameterised vector queries
- the full workflow: submit → recommendation → approve / create group / reject / reverse, with audit history
- retrieval through Postgres: same-space, approved members only, self excluded
- concurrent approvals (exactly one succeeds), stale versions and invalid references
- idempotent submission and redaction (original stored, only redacted text reaches providers)
- duplicate-attempt prevention and lease recovery
- provider outages with bounded retries and manual retry, and malformed model output
- the manual-only workflow with `AI_PROVIDER=none`

## Synthetic data and evaluation

```bash
pnpm dataset:generate    # rewrite data/synthetic/* from ground-truth/catalog.json (seed 20261025)
pnpm dataset:validate    # fails on drift, label leakage, split leakage, unsafe PII, etc.
pnpm eval                          # non-AI lexical baseline
pnpm eval --matcher deterministic  # production pipeline + labelled test provider (no keys)
RUN_LIVE_AI_EVAL=1 pnpm eval --matcher ai [--limit 20]   # real providers (paid, opt-in)
# results go to data/evaluation/results/*.json (git-ignored)
```

`data/` is excluded from Prettier because the manifest stores SHA-256 hashes of the generated files. See [evaluation.md](evaluation.md).

## Environment variables

| Variable            | Where                 | Default                        | Purpose                                                                   |
| ------------------- | --------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`      | `apps/api/.env`       | required                       | Development database                                                      |
| `TEST_DATABASE_URL` | `apps/api/.env`       | required for integration tests | Disposable test database                                                  |
| `API_PORT`          | `apps/api/.env`       | `3000`                         | API port                                                                  |
| `WEB_ORIGIN`        | `apps/api/.env`       | `http://localhost:5173`        | Allowed CORS origin                                                       |
| `API_BODY_LIMIT`    | `apps/api/.env`       | `32kb`                         | Max JSON body                                                             |
| `VITE_API_BASE_URL` | `apps/web/.env.local` | `http://localhost:3000`        | API base URL. **Public:** every `VITE_*` value is shipped to the browser. |

### AI and triage variables (`apps/api/.env`)

| Variable                                                                          | Default                 | Purpose                                                                                       |
| --------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                                                                     | `none`                  | `none` (manual triage), `deterministic-test` (labelled non-AI stand-in) or `anthropic-voyage` |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`                                             | unset                   | Required only for `anthropic-voyage`. Server-side only; empty values count as unset           |
| `ANTHROPIC_EXTRACTION_MODEL` / `ANTHROPIC_ASSESSMENT_MODEL`                       | `claude-haiku-5-5`      | Must be a verified id (`claude-haiku-5-5`, `claude-sonnet-5-5`), otherwise startup fails      |
| `ANTHROPIC_EXTRACTION_EFFORT` / `ANTHROPIC_ASSESSMENT_EFFORT`                     | `low` / `medium`        | `output_config.effort`                                                                        |
| `ANTHROPIC_MAX_TOKENS`                                                            | `4096`                  | Includes Haiku 5.5's adaptive thinking                                                        |
| `VOYAGE_EMBEDDING_MODEL`                                                          | `voyage-4-lite`         | `voyage-4-lite` or `voyage-4`, always 1024 dimensions                                         |
| `PROVIDER_TIMEOUT_MS`                                                             | `30000`                 | Per provider call                                                                             |
| `TRIAGE_WORKER_ENABLED`                                                           | `true`                  | Background worker; tests disable it and call `drain()`                                        |
| `TRIAGE_POLL_INTERVAL_MS` / `TRIAGE_LEASE_MS` / `TRIAGE_MAX_ATTEMPTS`             | `2000` / `120000` / `5` | Polling, abandoned-claim lease, automatic attempts                                            |
| `RETRIEVAL_CANDIDATE_LIMIT` / `RETRIEVAL_MIN_SIMILARITY` / `RETRIEVAL_NEIGHBOURS` | `5` / `0.25` / `30`     | Groups shown to the assessor, cosine floor, member neighbours scanned                         |

### Trying the workflow from the command line

```bash
# apps/api/.env: AI_PROVIDER=deterministic-test
pnpm --filter @fis/api dev
curl -s -XPOST localhost:3000/api/v1/requests -H 'content-type: application/json' \
  -d '{"title":"Dark mode","description":"I work late at night and the bright UI gives me headaches."}'
curl -s localhost:3000/api/v1/requests/<id>                     # recommendation + evidence
curl -s -XPOST localhost:3000/api/v1/requests/<id>/decisions -H 'X-Actor: pm.ana' \
  -H 'content-type: application/json' \
  -d '{"action":"create_group","title":"Dark mode","needStatement":"A comfortable dark appearance for night work."}'
```

Swagger UI at http://localhost:3000/api/docs lists every route and schema.

## Demo

See [demo.md](demo.md): `pnpm demo:setup`, `pnpm demo:api`, `pnpm demo:seed`, `pnpm demo:reset`. These use a separate `fis_demo` database and never touch `DATABASE_URL`.

## Troubleshooting

- **`vitest: command not found` / "Local package.json exists, but node_modules missing".** Dependencies were installed with npm, or not at all. Delete `node_modules/` and `package-lock.json`, then run `pnpm install`.
- **`corepack: command not found`.** Node 25+ no longer bundles Corepack. Install pnpm directly: `npm install -g pnpm@10.28.0`.
- **`Cannot connect to the Docker daemon`.** Start Docker Desktop and wait until `docker info` succeeds, then run `pnpm db:up`.

- **`Failed to fetch sha256 checksum at https://binaries.prisma.sh/...`.** The Prisma CLI downloads its schema engine on first use. On a network that blocks `binaries.prisma.sh`, build `schema-engine` from `prisma/prisma-engines` at the commit in `node_modules/@prisma/engines-version` and point `PRISMA_SCHEMA_ENGINE_BINARY` at it. This is how the project was verified in a sandbox that blocked that host.
- **Port 5433 or 3000 in use.** Change the host port in `docker-compose.yml` (and the URLs in `.env`) or `API_PORT`.
