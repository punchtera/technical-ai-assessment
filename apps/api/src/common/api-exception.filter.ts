import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode, ApiIssue } from '@fis/contracts';
import type { Response } from 'express';

/** Thrown by validation pipes; carries field-level issues for the error envelope. */
export class ApiValidationException extends HttpException {
  constructor(readonly issues: ApiIssue[]) {
    super('Request validation failed', HttpStatus.BAD_REQUEST);
  }
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * Converts every error into the shared `ApiError` envelope. Unknown errors are
 * logged by class name only and returned as a generic 500, so stack traces,
 * SQL and request bodies never leak to clients or logs.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof ApiValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: exception.message,
            issues: exception.issues,
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          error: {
            code:
              CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
            message: exception.message,
          },
        },
      };
    }

    // body-parser errors (oversized or malformed JSON) arrive as plain errors with a status.
    const raw = exception as { status?: number; type?: string; name?: string };
    if (raw?.type === 'entity.too.large' || raw?.status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } },
      };
    }
    if (raw?.type === 'entity.parse.failed') {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { error: { code: 'VALIDATION_FAILED', message: 'Request body is not valid JSON' } },
      };
    }

    this.logger.error(`Unhandled ${raw?.name ?? 'error'}`);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } },
    };
  }
}
