import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5433/db' });
    expect(env.API_PORT).toBe(3000);
    expect(env.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(env.API_BODY_LIMIT).toBe('32kb');
  });

  it('rejects a missing or non-PostgreSQL database URL without echoing its value', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://secret@host/db' })).toThrow(
      /must be a PostgreSQL URL/,
    );
    try {
      parseEnv({ DATABASE_URL: 'mysql://secret@host/db' });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });

  it('rejects an invalid port', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: 'postgresql://localhost/db', API_PORT: '70000' }),
    ).toThrow(/API_PORT/);
  });
});

describe('AI configuration', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5433/db' };

  it('defaults to no AI provider and verified model identifiers', () => {
    const env = parseEnv(base);
    expect(env.AI_PROVIDER).toBe('none');
    expect(env.ANTHROPIC_EXTRACTION_MODEL).toBe('claude-haiku-5-5');
    expect(env.VOYAGE_EMBEDDING_MODEL).toBe('voyage-4-lite');
    expect(env.TRIAGE_WORKER_ENABLED).toBe(true);
  });

  it('requires both keys for real providers, treating empty values as unset', () => {
    expect(() =>
      parseEnv({
        ...base,
        AI_PROVIDER: 'anthropic-voyage',
        ANTHROPIC_API_KEY: 'a',
        VOYAGE_API_KEY: '',
      }),
    ).toThrow(/VOYAGE_API_KEY is required/);
    expect(
      parseEnv({
        ...base,
        AI_PROVIDER: 'anthropic-voyage',
        ANTHROPIC_API_KEY: 'a',
        VOYAGE_API_KEY: 'v',
      }).AI_PROVIDER,
    ).toBe('anthropic-voyage');
  });

  it('never echoes key values in configuration errors', () => {
    try {
      parseEnv({ ...base, AI_PROVIDER: 'anthropic-voyage', ANTHROPIC_API_KEY: 'sk-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret-value');
    }
  });
});
