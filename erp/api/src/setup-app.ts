import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

// Ledger and audit ids are BIGINT; send them to clients as strings
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
  return this.toString();
};

/** Shared by main.ts and the tests so both run the same pipeline. */
export function setupApp(app: INestApplication, webOrigin?: string) {
  app.setGlobalPrefix('api');
  // Security headers on every response (no sniffing, no framing, HSTS, strict referrer, same-origin resources)
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: webOrigin ?? 'http://localhost:3100' });
  app.enableShutdownHooks();
}
