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

Vector columns: Prisma has no native vector type, so they're declared as `Unsupported("vector(<dims>)")`. Queries that read or write them go through parameterised `$queryRaw` tagged templates, never string concatenation. The integration test `database.int.test.ts` shows the pattern (`embedding <=> ${query}::vector`).

## Tests

| Suite               | Command                 | Needs                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------- |
| Unit (all packages) | `pnpm test`             | nothing (no DB, no network, no AI keys)                             |
| API integration     | `pnpm test:integration` | PostgreSQL running and `TEST_DATABASE_URL` set (in `apps/api/.env`) |

Integration tests:

1. apply all migrations to `TEST_DATABASE_URL` (global setup), and
2. override `DATABASE_URL` with the test database inside each worker, so development data is never touched.

They cover migrations, pgvector and cosine distance with bound parameters, the embedding-space uniqueness constraint, the health endpoint, OpenAPI serving, 404/413/400 error envelopes and malformed JSON.

## Synthetic data and evaluation

```bash
pnpm dataset:generate    # rewrite data/synthetic/* from ground-truth/catalog.json (seed 20261025)
pnpm dataset:validate    # fails on drift, label leakage, split leakage, unsafe PII, etc.
pnpm eval                # writes data/evaluation/results/*.json (git-ignored) and prints a summary
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

AI provider keys (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`) arrive in step 2. They will be server-only and optional, and the app will run without them.

## Troubleshooting

- **`vitest: command not found` / "Local package.json exists, but node_modules missing".** Dependencies were installed with npm, or not at all. Delete `node_modules/` and `package-lock.json`, then run `pnpm install`.
- **`corepack: command not found`.** Node 25+ no longer bundles Corepack. Install pnpm directly: `npm install -g pnpm@10.28.0`.
- **`Cannot connect to the Docker daemon`.** Start Docker Desktop and wait until `docker info` succeeds, then run `pnpm db:up`.

- **`Failed to fetch sha256 checksum at https://binaries.prisma.sh/...`.** The Prisma CLI downloads its schema engine on first use. On a network that blocks `binaries.prisma.sh`, build `schema-engine` from `prisma/prisma-engines` at the commit in `node_modules/@prisma/engines-version` and point `PRISMA_SCHEMA_ENGINE_BINARY` at it. This is how the project was verified in a sandbox that blocked that host.
- **Port 5433 or 3000 in use.** Change the host port in `docker-compose.yml` (and the URLs in `.env`) or `API_PORT`.
