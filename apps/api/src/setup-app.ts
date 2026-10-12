import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and the tests so both run the same pipeline. */
export function setupApp(app: INestApplication, webOrigin?: string) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: webOrigin ?? 'http://localhost:3000' });
}
