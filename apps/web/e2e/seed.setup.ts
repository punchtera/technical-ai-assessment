import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { E2E_API_URL } from '../playwright.config';

/** Seeds the curated demo groups through the public API (same command as `pnpm demo:seed`). */
test('seed demo groups through the API', () => {
  execFileSync('node', [resolve(import.meta.dirname, '../../api/scripts/demo.mjs'), 'seed'], {
    env: { ...process.env, DEMO_API_URL: E2E_API_URL },
    stdio: 'inherit',
  });
});
