import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN', 'http://localhost:3001'),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Marketing Content API')
    .setDescription(
      [
        'NestJS gateway for the AI-powered LinkedIn/TikTok content pipeline.',
        '',
        '**Authentication.** Most endpoints require a Bearer JWT obtained from',
        '`POST /auth/login` or `POST /auth/register`. Click **Authorize** and',
        'paste the `accessToken` from the response. Refresh tokens are rotated',
        'via `POST /auth/refresh`.',
        '',
        '**Architecture.** This gateway owns auth, user-scoped reads (Prisma),',
        'and thin proxies to the FastAPI `ai-service` for LangGraph pipelines',
        '(scans, post generation, publishing).',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the `accessToken` returned by `/auth/login`.',
      },
      'access-token',
    )
    .addTag('Auth', 'Registration, login, token refresh, and Google OAuth')
    .addTag('Posts', 'AI-generated content posts (list, detail, generate, status)')
    .addTag('Scans', 'HackerNews trend scan runs (trigger + poll)')
    .addTag('Trends', 'Global trend items discovered by scans')
    .addTag('Publish', 'Publish posts to TikTok (now, schedule, auto, history)')
    .addTag('Reports', 'Per-scan markdown reports and summaries')
    .addTag('TikTok Auth', 'TikTok OAuth handshake (proxied to ai-service)')
    .addTag('Publisher', 'Provider-agnostic TikTok publishing (Zernio): profile setup, TikTok linking, webhooks')
    .addTag('Health', 'Liveness probe')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`🚀 Backend API gateway listening on :${port}`, 'Bootstrap');
  Logger.log(`📖 Swagger UI available at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
