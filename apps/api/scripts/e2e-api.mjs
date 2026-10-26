#!/usr/bin/env node
/**
 * Starts the BUILT API for the Playwright end-to-end suite.
 *
 * Uses TEST_DATABASE_URL only (database name must end in "_test"), applies
 * migrations, empties the domain tables, then runs `dist/main.js` with the
 * labelled deterministic test provider. It never touches DATABASE_URL.
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(API_DIR, '.env'));
} catch {
  // rely on the environment
}

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL is required for end-to-end tests (see apps/api/.env.example).',
  );
const name = decodeURIComponent(new URL(url).pathname.slice(1));
if (!name.endsWith('_test'))
  throw new Error(`Refusing to reset "${name}": the e2e database name must end with "_test".`);

const migrate = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  cwd: API_DIR,
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'inherit',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  'TRUNCATE audit_events, supports, request_embeddings, group_memberships, review_decisions, triage_runs, need_groups, feature_requests CASCADE',
);
await client.end();

const port = process.env.E2E_API_PORT ?? '3101';
const child = spawn('node', ['dist/main.js'], {
  cwd: API_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: url,
    API_PORT: port,
    WEB_ORIGIN: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5174',
    AI_PROVIDER: 'deterministic-test',
    DEMO_MODE: 'true',
    TRIAGE_POLL_INTERVAL_MS: '300',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
