import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite: real web app + real API + real PostgreSQL/pgvector.
 * Only AI inference is replaced, by the labelled deterministic test provider.
 * Requires the test database (TEST_DATABASE_URL, name ending in "_test") and a
 * built API (`pnpm build`). No API keys are needed.
 */
const API_PORT = 3101;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'seed', testMatch: /seed\.setup\.ts/ },
    { name: 'workflow', testMatch: /.*\.spec\.ts/, dependencies: ['seed'] },
  ],
  webServer: [
    {
      command: 'node ../api/scripts/e2e-api.mjs',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});

export const E2E_API_URL = `http://localhost:${API_PORT}`;
