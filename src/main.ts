import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('Bootstrap');

  const configService = app.get(ConfigService<AppConfig, true>);
  const { port, nodeEnv, frontendUrl } = configService.get('app', { infer: true });

  // Security headers.
  app.use(helmet());

  // CORS — allow the SPA frontend to call the API with credentials.
  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global request validation/transformation.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // OpenAPI / Swagger docs — disabled in production.
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('hektor.ai API')
      .setDescription('AI coworker platform backend API')
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Apply the bearer-auth requirement to every operation so the single
    // "Authorize" button works across the whole API.
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path)) {
        if (operation && typeof operation === 'object' && 'responses' in operation) {
          operation.security = [{ 'access-token': [] }];
        }
      }
    }

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  }

  // Graceful shutdown hooks (closes DB / Redis connections).
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`hektor.ai backend running on http://localhost:${port} [${nodeEnv}]`);
}

void bootstrap();
