import { resolveTestDatabaseUrl } from './test-env';

// Runs inside each test worker before any test file is imported.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
