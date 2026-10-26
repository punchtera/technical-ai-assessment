import { defineConfig } from 'vitest/config';

// OPT-IN live provider tests. They call paid APIs with synthetic text only.
// Run: RUN_LIVE_AI_TESTS=1 ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... pnpm --filter @fis/triage-core test:live
export default defineConfig({
  test: { include: ['test/live/**/*.live.test.ts'], testTimeout: 120_000 },
});
