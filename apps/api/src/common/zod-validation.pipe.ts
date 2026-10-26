import { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiValidationException } from './api-exception.filter';

/**
 * Validates a request part (body, query or params) against a shared contract
 * schema. The same Zod schemas generate the OpenAPI document, so runtime
 * validation and documentation cannot drift apart.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiValidationException(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.') || '(root)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
