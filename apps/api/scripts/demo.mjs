#!/usr/bin/env node
/**
 * Demo tooling. Everything here targets a DEDICATED demo database
 * (default: same server as DATABASE_URL, database "fis_demo") and never the
 * development database.
 *
 *   node scripts/demo.mjs setup          create the demo database if missing + apply migrations
 *   node scripts/demo.mjs reset --yes    drop and recreate ONLY the demo database (refuses other names)
 *   node scripts/demo.mjs api            run the API against the demo DB with the labelled
 *                                        deterministic test provider and DEMO_MODE=true
 *   node scripts/demo.mjs seed           create the curated demo groups through the public API
 *                                        (idempotent; refuses unless the API reports demo mode)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(API_DIR, '../..');

try {
  process.loadEnvFile(resolve(API_DIR, '.env'));
} catch {
  // no .env: rely on the environment
}

function demoDatabaseUrl() {
  if (process.env.DEMO_DATABASE_URL) return process.env.DEMO_DATABASE_URL;
  if (!process.env.DATABASE_URL)
    throw new Error('Set DATABASE_URL or DEMO_DATABASE_URL in apps/api/.env');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/fis_demo';
  return url.toString();
}

/** Guard: only databases whose name ends in `_demo` and differ from DATABASE_URL may be touched. */
function assertDemoDatabase(urlString) {
  const url = new URL(urlString);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+_demo$/.test(name)) {
    throw new Error(`Refusing to use "${name}": the demo database name must end with "_demo".`);
  }
  if (process.env.DATABASE_URL) {
    const dev = new URL(process.env.DATABASE_URL);
    if (dev.host === url.host && dev.pathname === url.pathname) {
      throw new Error('Refusing: the demo database must differ from DATABASE_URL.');
    }
  }
  const admin = new URL(urlString);
  admin.pathname = '/postgres';
  return { name, adminUrl: admin.toString() };
}

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: API_DIR,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
    );
  });
}

async function withAdmin(adminUrl, fn) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setup() {
  const url = demoDatabaseUrl();
  const { name, adminUrl } = assertDemoDatabase(url);
  await withAdmin(adminUrl, async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`); // name validated by assertDemoDatabase
      console.log(`Created database ${name}.`);
    } else {
      console.log(`Database ${name} already exists.`);
    }
  });
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: url });
  console.log(`Demo database ready: ${name}`);
}

async function reset() {
  if (!process.argv.includes('--yes')) {
    console.error('This drops and recreates the demo database. Re-run with --yes to confirm.');
    process.exit(2);
  }
  const url = demoDatabaseUrl();
  const { name, adminUrl } = assertDemoDatabase(url);
  await withAdmin(adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
  console.log(`Recreated ${name}.`);
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: url });
}

async function api() {
  const url = demoDatabaseUrl();
  assertDemoDatabase(url);
  console.log(
    'Starting the API in DEMO MODE: demo database + deterministic test provider (not AI).',
  );
  await run('pnpm', ['exec', 'prisma', 'generate'], {});
  await run('pnpm', ['exec', 'nest', 'start', '--watch'], {
    DATABASE_URL: url,
    AI_PROVIDER: 'deterministic-test',
    DEMO_MODE: 'true',
    TRIAGE_POLL_INTERVAL_MS: process.env.TRIAGE_POLL_INTERVAL_MS ?? '1000',
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const base = (process.env.DEMO_API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
  const call = async (path, init = {}) => {
    const response = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${path} → ${response.status}: ${body?.error?.message ?? 'error'}`,
      );
    return body;
  };

  const status = await call('/system/ai');
  if (!status.demoMode || status.mode !== 'deterministic-test') {
    throw new Error(
      'Refusing to seed: the API at ' +
        base +
        ' is not running in demo mode. Start it with `pnpm demo:api`.',
    );
  }

  const fixture = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/demo/fixture.json'), 'utf8'));
  const inputs = new Map(
    readFileSync(resolve(REPO_ROOT, 'data/synthetic/requests.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((r) => [r.id, r]),
  );
  const actor = { 'x-actor': fixture.seedActor };

  async function submitAndWait(syntheticId) {
    const source = inputs.get(syntheticId);
    if (!source) throw new Error(`Unknown synthetic request ${syntheticId}`);
    let request = await call('/requests', {
      method: 'POST',
      headers: { 'idempotency-key': fixture.idempotencyPrefix + syntheticId },
      body: JSON.stringify({
        title: source.title,
        description: source.description,
        sourceChannel: source.sourceChannel,
      }),
    });
    for (let i = 0; i < 60 && ['queued', 'processing'].includes(request.processingStatus); i++) {
      await sleep(500);
      request = await call(`/requests/${request.id}`);
    }
    return request;
  }

  let created = 0;
  for (const group of fixture.groups) {
    let groupId = null;
    for (const [index, syntheticId] of group.members.entries()) {
      const request = await submitAndWait(syntheticId);
      if (request.activeMembership) {
        groupId ??= request.activeMembership.groupId; // already seeded earlier: idempotent re-run
        continue;
      }
      const triageRunId =
        request.latestTriage?.status === 'succeeded' ? request.latestTriage.id : undefined;
      if (index === 0 || !groupId) {
        const result = await call(`/requests/${request.id}/decisions`, {
          method: 'POST',
          headers: actor,
          body: JSON.stringify({
            action: 'create_group',
            title: group.title,
            needStatement: group.needStatement,
            triageRunId,
          }),
        });
        groupId = result.membership.groupId;
      } else {
        await call(`/requests/${request.id}/decisions`, {
          method: 'POST',
          headers: actor,
          body: JSON.stringify({ action: 'link', groupId, triageRunId }),
        });
      }
      created += 1;
    }
    console.log(`✓ ${group.title} (${group.members.length} members)`);
  }
  console.log(
    `Demo seed complete: ${created} new assignment(s) recorded by "${fixture.seedActor}". Re-running is safe.`,
  );
}

const commands = { setup, reset, api, seed };
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage: node scripts/demo.mjs <setup|reset --yes|api|seed>');
  process.exit(2);
}
command().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
