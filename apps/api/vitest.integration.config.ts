import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against a real PostgreSQL + pgvector database
// (TEST_DATABASE_URL). The global setup applies all migrations first.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/integration/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
