import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app, process.env.WEB_ORIGIN);
  await app.listen(Number(process.env.PORT ?? 4000));
}
bootstrap();
