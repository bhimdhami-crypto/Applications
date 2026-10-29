import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app, process.env.WEB_ORIGIN);
  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port);
  new Logger('Bootstrap').log(`MFI ERP API listening on port ${port}`);
}
bootstrap();
