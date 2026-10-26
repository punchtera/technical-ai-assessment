import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { HealthResponseSchema, type HealthResponse } from '@fis/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller({ path: 'health' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness + dependency status. Returns 503 when the database or pgvector is unavailable. */
  @Get()
  @HttpCode(HttpStatus.OK)
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = HealthResponseSchema.parse(await this.health.check());
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
