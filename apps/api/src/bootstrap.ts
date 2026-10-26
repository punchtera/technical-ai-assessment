import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { API_VERSION } from '@fis/contracts';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { APP_ENV, type AppEnv } from './config/env';
import { buildOpenApiDocument } from './openapi/openapi';

/**
 * Applies cross-cutting HTTP configuration. Shared by `main.ts` and the
 * integration tests so both exercise the same routing, limits and errors.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const env = app.get<AppEnv>(APP_ENV);

  app.useBodyParser('json', { limit: env.API_BODY_LIMIT });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: env.WEB_ORIGIN });
  app.disable('x-powered-by');

  const document = buildOpenApiDocument() as unknown as OpenAPIObject;
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });

  return app;
}
