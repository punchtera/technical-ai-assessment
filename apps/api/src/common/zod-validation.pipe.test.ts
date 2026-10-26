import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiValidationException } from './api-exception.filter';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ title: z.string().min(3) }).strict());

  it('returns parsed data for valid input', () => {
    expect(pipe.transform({ title: 'Dark mode' })).toEqual({ title: 'Dark mode' });
  });

  it('throws field-level issues for invalid input', () => {
    try {
      pipe.transform({ title: 'x', extra: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiValidationException);
      const paths = (error as ApiValidationException).issues.map((issue) => issue.path);
      expect(paths).toContain('title');
    }
  });
});
