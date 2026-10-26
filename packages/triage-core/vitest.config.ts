import { defineConfig } from 'vitest/config';

// Unit tests only: no network, no API keys. Live tests use vitest.live.config.ts.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
