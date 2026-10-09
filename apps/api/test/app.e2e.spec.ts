// End-to-end checks against a real Postgres test database (TEST_DATABASE_URL, default hrportal_test).
// Mail is kept in memory and the CAPTCHA is switched off so the flow can run unattended.
process.env.MAIL_TRANSPORT = 'memory';
process.env.CAPTCHA_PROVIDER = 'disabled';
process.env.JWT_SECRET ??= 'e2e-secret';
process.env.PAYROLL_AUTODRAFT = 'false';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://hr:hr@localhost:5432/hrportal_test';
// The suite wipes every table, so refuse anything that is not clearly a test database.
if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { PayrollService } from '../src/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

const ADMIN_PASSWORD = 'Admin#Mindspace2026';
const USER_PASSWORD = 'Test#Mindspace2026';

describe('Mindspace HR API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  const tokens: Record<string, string> = {};

  async function signIn(email: string, password = USER_PASSWORD) {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
    const sent = mail.outbox.filter((m) => m.to === email && m.subject.includes('sign-in code')).pop()!;
    const code = /(\d{6})/.exec(sent.text)![1];
    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ challengeId: login.body.challengeId, code })
      .expect(200);
    return verify.body.accessToken as string;
  }

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: string) =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);

    await prisma.$executeRawUnsafe(
      'TRUNCATE "Payslip", "PayrollRun", "Employee", "LoginChallenge", "User", "Company", "AuditLog" CASCADE',
    );
    process.env.SEED_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.SEED_USER_PASSWORD = USER_PASSWORD;
    await seed(prisma);

    tokens.admin = await signIn('admin@mindspace-ai.test', ADMIN_PASSWORD);
    for (const who of ['hr', 'payroll', 'manager', 'developer']) tokens[who] = await signIn(`${who}@mindspace-ai.test`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sign-in', () => {
    it('rejects a wrong password without sending a code', async () => {
      const before = mail.outbox.length;
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'tester@mindspace-ai.test', password: 'wrong-password' })
        .expect(401);
      expect(mail.outbox.length).toBe(before);
    });

    it('rejects a wrong email code', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'tester@mindspace-ai.test', password: USER_PASSWORD })
        .expect(200);
      await request(app.getHttpServer()).post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: '000000' }).expect(401);
    });

    it('refuses requests without a token', async () => {
      await request(app.getHttpServer()).get('/api/employees').expect(401);
    });

    it('returns the signed-in profile', async () => {
      const res = await api('get', '/auth/me', 'developer').expect(200);
      expect(res.body.email).toBe('developer@mindspace-ai.test');
      expect(res.body.employee.workLocation).toBe('FULLY_REMOTE');
    });
  });

  describe('employees', () => {
    let newId: string;

    it('lets the admin add an employee and emails a welcome', async () => {
      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      const res = await api('post', '/employees', 'admin')
        .send({
          firstName: 'Grace',
          lastName: 'Achieng',
          email: 'grace.achieng@mindspace-ai.test',
          jobTitle: 'Data Analyst',
          department: 'Data',
          hireDate: '2026-10-01',
          monthlyBasic: 95000,
          companyId: kenya.id,
        })
        .expect(201);
      newId = res.body.id;
      expect(res.body.employeeNo).toBe('MSA-KE-000006');
      expect(mail.outbox.some((m) => m.to === 'grace.achieng@mindspace-ai.test' && m.subject.includes('Welcome'))).toBe(true);
    });

    it('does not let HR delete an employee', async () => {
      await api('delete', `/employees/${newId}`, 'hr').expect(403);
    });

    it('does not let an employee list staff', async () => {
      await api('get', '/employees', 'developer').expect(403);
    });

    it('shows a manager only their own reports, without pay', async () => {
      const res = await api('get', '/employees', 'manager').expect(200);
      expect(res.body.map((e: { user: { email: string } }) => e.user.email).sort()).toEqual([
        'developer@mindspace-ai.test',
        'tester@mindspace-ai.test',
      ]);
      expect(res.body[0].monthlyBasic).toBeUndefined();
    });

    it('lets the admin delete an employee, keeping the record and blocking sign-in', async () => {
      await api('delete', `/employees/${newId}`, 'admin').send({ reason: 'Test clean-up' }).expect(200);
      const list = await api('get', '/employees', 'admin').expect(200);
      expect(list.body.find((e: { id: string }) => e.id === newId)).toBeUndefined();
      const kept = await prisma.employee.findUniqueOrThrow({ where: { id: newId }, include: { user: true } });
      expect(kept.status).toBe('TERMINATED');
      expect(kept.user!.isActive).toBe(false);
    });
  });

  describe('month-end payroll', () => {
    let runId: string;

    it('creates a draft run for Kenya with a payslip per employee', async () => {
      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      const res = await api('post', '/payroll/runs', 'payroll').send({ companyId: kenya.id, year: 2026, month: 9 }).expect(201);
      runId = res.body.id;
      const run = await api('get', `/payroll/runs/${runId}`, 'payroll').expect(200);
      expect(run.body.status).toBe('DRAFT');
      expect(run.body.payslips).toHaveLength(5);
      expect(run.body.rulesVerified).toBe(false);
      await api('post', '/payroll/runs', 'payroll').send({ companyId: kenya.id, year: 2026, month: 9 }).expect(409);
    });

    it('calculates the tester payslip from the Kenya rules', async () => {
      const run = await api('get', `/payroll/runs/${runId}`, 'payroll').expect(200);
      const slip = run.body.payslips.find((p: { employee: { employeeNo: string } }) => p.employee.employeeNo === 'MSA-KE-000005');
      // 128,000 gross: NSSF 4,320, SHIF 3,520, AHL 1,920, PAYE on 118,240
      expect(Number(slip.gross)).toBe(128000);
      const line = (code: string) => Number(slip.lines.find((l: { code: string }) => l.code === code).amount);
      expect(line('NSSF')).toBe(4320);
      expect(line('SHIF')).toBe(3520);
      expect(line('AHL')).toBe(1920);
    });

    it('refuses payroll for a country whose rules are not built yet', async () => {
      const uganda = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-UG' } });
      await api('post', '/payroll/runs', 'payroll').send({ companyId: uganda.id, year: 2026, month: 9 }).expect(422);
    });

    it('keeps payslips hidden from employees until the run is finalized', async () => {
      const res = await api('get', '/payslips/me', 'developer').expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('lets only the admin approve and finalize', async () => {
      await api('post', `/payroll/runs/${runId}/approve`, 'payroll').expect(403);
      await api('post', `/payroll/runs/${runId}/finalize`, 'admin').expect(409);
      await api('post', `/payroll/runs/${runId}/approve`, 'admin').expect(201);
      await api('post', `/payroll/runs/${runId}/recalculate`, 'payroll').expect(409);
      await api('post', `/payroll/runs/${runId}/finalize`, 'admin').expect(201);
      expect(mail.outbox.some((m) => m.to === 'developer@mindspace-ai.test' && m.subject.includes('September 2026'))).toBe(true);
    });

    it('shows the employee their own payslip and nobody else\'s', async () => {
      const mine = await api('get', '/payslips/me', 'developer').expect(200);
      expect(mine.body).toHaveLength(1);
      await api('get', `/payslips/${mine.body[0].id}`, 'developer').expect(200);
      await api('get', `/payslips/${mine.body[0].id}`, 'manager').expect(403);
    });

    it('creates month-end drafts for every country with rules', async () => {
      const created = await app.get(PayrollService).createMonthEndDrafts(new Date(Date.UTC(2026, 9, 20)));
      expect(created).toHaveLength(1);
      const again = await app.get(PayrollService).createMonthEndDrafts(new Date(Date.UTC(2026, 9, 20)));
      expect(again).toHaveLength(0);
    });
  });
});
