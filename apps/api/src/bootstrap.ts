import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { createHttpLogger } from './common/security/http-logger';
import { OriginGuard } from './common/security/origin.guard';
import { RequestIdMiddleware } from './common/security/request-id.middleware';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const requestId = app.get(RequestIdMiddleware);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const webOrigins = config
    .get<string>('WEB_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.setGlobalPrefix('api/v1');
  app.use((request: Request, response: Response, next: NextFunction) =>
    requestId.use(request, response, next),
  );
  app.use(helmet());
  app.use(createHttpLogger());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalGuards(app.get(OriginGuard));
  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.enableCors({ credentials: true, origin: webOrigins });
  app.enableShutdownHooks();

  if (nodeEnv !== 'production') {
    SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));
  }

  await app.init();
  return app;
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Multi-tenant CRM API')
    .setDescription('多租户 CRM 平台 REST API')
    .setVersion('1.0')
    .addCookieAuth('crm_session', { type: 'apiKey' }, 'crm_session')
    .build();
  return SwaggerModule.createDocument(app, config);
}
