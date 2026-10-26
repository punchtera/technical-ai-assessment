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
