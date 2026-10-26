import { loadDotEnv } from '../../src/config/env';

/**
 * Integration tests always target TEST_DATABASE_URL, never the development
 * database, so they can freely reset tables.
 */
export function resolveTestDatabaseUrl(): string {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start PostgreSQL with `pnpm db:up` and copy .env.example to apps/api/.env.',
    );
  }
  return url;
}
