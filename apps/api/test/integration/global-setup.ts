import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveTestDatabaseUrl } from './test-env';

/** Applies every Prisma migration to the test database before the suite runs. */
export default function setup(): void {
  const databaseUrl = resolveTestDatabaseUrl();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
