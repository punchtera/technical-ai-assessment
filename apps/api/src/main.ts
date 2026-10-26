import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_ENV, type AppEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // bodyParser is registered in configureApp with an explicit size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT}/api/v1`, 'Bootstrap');
  Logger.log(`OpenAPI docs at http://localhost:${env.API_PORT}/api/docs`, 'Bootstrap');
}

void bootstrap();
