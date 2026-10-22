import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV_CONFIG } from './config/config.module.js';
import type { EnvConfig } from './config/env.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get<EnvConfig>(ENV_CONFIG);

  // Structured Logging via Pino
  app.useLogger(app.get(Logger));

  // Initialize Sentry if DSN is configured
  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      beforeSend(event) {
        // Scrub PII: remove sensitive headers, cookies, tokens
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });
  }

  // Request ID middleware (attaches to req and sets response header)
  app.use((req: any, res: any, next: () => void) => {
    const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    next();
  });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'res.cloudinary.com'],
          connectSrc: ["'self'", '*.supabase.co'],
        },
      },
    }),
  );

  // Cookie Parser
  app.use(cookieParser());

  // Response Compression
  app.use(compression());

  // CORS configuration
  app.enableCors({
    origin: [config.FRONTEND_URL, 'http://localhost:3000'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI (Swagger) Documentation at /docs and /docs-json
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Store Keeper API')
    .setDescription('Multi-tenant, branch-scoped store management API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your Supabase JWT',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-CSRF-Token',
        in: 'header',
        description: 'CSRF token from csrf_token cookie',
      },
      'X-CSRF-Token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  const port = config.PORT ?? 4000;
  await app.listen(port);
}

await bootstrap();
