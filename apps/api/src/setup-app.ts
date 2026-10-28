import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/** Shared by main.ts and the tests so both run the same pipeline. */
export function setupApp(app: INestApplication, webOrigin?: string) {
  app.setGlobalPrefix('api');
  // Security headers on every response (no sniffing, no framing, HSTS, strict referrer, same-origin resources)
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: webOrigin ?? 'http://localhost:3000' });
  app.enableShutdownHooks();
}
