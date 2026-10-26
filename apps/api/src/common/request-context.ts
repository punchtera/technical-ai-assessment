import { createParamDecorator, ExecutionContext, PipeTransform } from '@nestjs/common';
import { ActorRefSchema } from '@fis/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiValidationException } from './api-exception.filter';

/**
 * Reviewer identity from the `X-Actor` header.
 *
 * There is no authentication in this version (deferred by the product design):
 * the header is trusted as-is, which is acceptable only for local development
 * or a trusted network. It is validated to a safe pseudonymous handle format.
 */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const raw = ctx.switchToHttp().getRequest<Request>().header('x-actor');
  const parsed = ActorRefSchema.safeParse(raw ?? '');
  if (!parsed.success) {
    throw new ApiValidationException([
      {
        path: 'header.x-actor',
        message: 'X-Actor header is required (a reviewer handle such as "pm.ana")',
      },
    ]);
  }
  return parsed.data;
});

/** Optional `Idempotency-Key` header for safe submission retries. */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const raw = ctx.switchToHttp().getRequest<Request>().header('idempotency-key');
    if (raw === undefined) return undefined;
    const parsed = z
      .string()
      .trim()
      .min(8)
      .max(100)
      .regex(/^[\w.:-]+$/)
      .safeParse(raw);
    if (!parsed.success) {
      throw new ApiValidationException([
        { path: 'header.idempotency-key', message: '8–100 characters: letters, digits, . _ : -' },
      ]);
    }
    return parsed.data;
  },
);

/** Validates `:id` route params as UUIDs so malformed ids return 400, not 500. */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!z.uuid().safeParse(value).success) {
      throw new ApiValidationException([{ path: 'params.id', message: 'must be a UUID' }]);
    }
    return value;
  }
}
