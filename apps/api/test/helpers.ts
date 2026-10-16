import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { setupApp } from '../src/setup-app';
import { seed } from '../prisma/seed';
import { StaffOptions } from '../prisma/staff-generator';

export const PASSWORD = 'Test#Password2026';

/** Empties every table (TRUNCATE skips the audit log's row trigger) and seeds the demo group, without staff unless asked */
export async function resetDatabase(staff: StaffOptions | false = false) {
  const prisma = new PrismaClient();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await seed(prisma, { password: PASSWORD, quiet: true, staff });
  return prisma;
}

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return { app, mail: app.get(MailService) };
}

export function lastCode(mail: MailService, to: string) {
  const m = [...mail.outbox].reverse().find((x) => x.to === to && x.subject.startsWith('Your sign-in code'));
  if (!m) throw new Error(`No sign-in code sent to ${to}`);
  return m.subject.match(/(\d{6})/)![1];
}

/** Full two-step sign-in; returns the bearer header and tokens */
export async function signIn(app: INestApplication, mail: MailService, email: string, client: 'web' | 'mobile' = 'mobile', password = PASSWORD) {
  const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  const verify = await request(app.getHttpServer()).post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: lastCode(mail, email), client }).expect(200);
  return { auth: { Authorization: `Bearer ${verify.body.accessToken}` }, body: verify.body, res: verify };
}
