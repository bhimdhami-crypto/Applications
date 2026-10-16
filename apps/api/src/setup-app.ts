import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRAND } from '@gpp/shared';
import helmet from 'helmet';
import { PrismaErrorsFilter } from './prisma-errors.filter';

/** Shared by main.ts and the tests so both run the same pipeline. */
export function setupApp(app: INestApplication, webOrigin?: string) {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaErrorsFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableCors({ origin: webOrigin ?? 'http://localhost:3000', credentials: true });
  // Behind the web portal's proxy, the client address arrives in X-Forwarded-For
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 'loopback');

  const doc = new DocumentBuilder()
    .setTitle(`${BRAND.productName} API`)
    .setDescription(`${BRAND.developerCredit}. ${BRAND.copyright()}`)
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
