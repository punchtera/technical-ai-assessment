import { defineConfig } from 'prisma/config';

// Prisma 7 reads connection settings from this file instead of schema.prisma.
// Load apps/api/.env when present so CLI commands work without exporting variables.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on variables already set in the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // A placeholder keeps `prisma generate` working without a database;
    // commands that need a database fail with a clear connection error instead.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5433/unset',
  },
});
