import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const webOrigins = config
    .get<string>('WEB_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(pinoHttp());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ credentials: true, origin: webOrigins });
  app.enableShutdownHooks();

  if (nodeEnv !== 'production') {
    const openApiConfig = new DocumentBuilder()
      .setTitle('Multi-tenant CRM API')
      .setDescription('多租户 CRM 平台 REST API')
      .setVersion('1.0')
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, openApiConfig),
    );
  }

  await app.listen(config.get<number>('PORT', 3001));
}
void bootstrap();
