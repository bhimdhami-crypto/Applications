// End-to-end checks against a real Postgres test database (TEST_DATABASE_URL, default hrportal_test).
// Mail is kept in memory and the CAPTCHA is switched off so the flow can run unattended.
process.env.MAIL_TRANSPORT = 'memory';
process.env.CAPTCHA_PROVIDER = 'disabled';
process.env.JWT_SECRET ??= 'e2e-secret';
process.env.PAYROLL_AUTODRAFT = 'false';
process.env.STORAGE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'hr-storage-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://hr:hr@localhost:5432/hrportal_test';
// The suite wipes every table, so refuse anything that is not clearly a test database.
if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { importSample } from '../prisma/import-sample';
import { parseCsv } from '../prisma/csv';
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

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, who: string) =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);

    await prisma.$executeRawUnsafe(
      'TRUNCATE "Candidate", "JobOpening", "Goal", "PerformanceReview", "ReviewCycle", "ContentReport", "PostComment", "PostLike", "CommunityPost", "ChatMessage", "ConversationMember", "Conversation", "PolicyAcknowledgement", "LibraryItem", "AttendanceSession", "WorkLog", "LoanRepayment", "Loan", "BenefitEnrolment", "BenefitPlan", "GiftVoucher", "LeaveRequest", "LeaveAdjustment", "PublicHoliday", "Payslip", "PayrollRun", "EmployeeDocument", "NextOfKin", "Employee", "LoginChallenge", "User", "Company", "AuditLog" CASCADE',
    );
    process.env.SEED_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.SEED_USER_PASSWORD = USER_PASSWORD;
    await seed(prisma);

    tokens.admin = await signIn('admin@mindspace-ai.test', ADMIN_PASSWORD);
    for (const who of ['hr', 'payroll', 'manager', 'developer', 'tester', 'finance']) tokens[who] = await signIn(`${who}@mindspace-ai.test`);
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
      expect(login.body.demoCode).toBeUndefined();
      await request(app.getHttpServer()).post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: '000000' }).expect(401);
    });

    it('lists the test accounts and returns the code only in demo mode', async () => {
      const off = await request(app.getHttpServer()).get('/api/auth/demo').expect(200);
      expect(off.body).toEqual({ demo: false });
      process.env.DEMO_MODE = 'true';
      try {
        const on = await request(app.getHttpServer()).get('/api/auth/demo').expect(200);
        expect(on.body.accounts).toContainEqual(expect.objectContaining({ email: 'admin@mindspace-ai.test', password: ADMIN_PASSWORD }));
        expect(on.body.accounts).toContainEqual(expect.objectContaining({ email: 'tester@mindspace-ai.test', password: USER_PASSWORD }));
        const login = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'manager@mindspace-ai.test', password: USER_PASSWORD })
          .expect(200);
        expect(login.body.demoCode).toMatch(/^\d{6}$/);
        const verify = await request(app.getHttpServer())
          .post('/api/auth/verify')
          .send({ challengeId: login.body.challengeId, code: login.body.demoCode })
          .expect(200);
        expect(verify.body.user.email).toBe('manager@mindspace-ai.test');
      } finally {
        delete process.env.DEMO_MODE;
      }
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
      expect(res.body.employeeNo).toBe('MSA-KE-000001');
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
      expect(res.body.items.map((e: { user: { email: string } }) => e.user.email).sort()).toEqual([
        'developer@mindspace-ai.test',
        'tester@mindspace-ai.test',
      ]);
      expect(res.body.items[0].monthlyBasic).toBeUndefined();
    });

    it('lets the admin delete an employee, keeping the record and blocking sign-in', async () => {
      await api('delete', `/employees/${newId}`, 'admin').send({ reason: 'Test clean-up' }).expect(200);
      const list = await api('get', '/employees', 'admin').expect(200);
      expect(list.body.items.find((e: { id: string }) => e.id === newId)).toBeUndefined();
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
      expect(run.body.payslips).toHaveLength(6);
      expect(run.body.rulesVerified).toBe(false);
      await api('post', '/payroll/runs', 'payroll').send({ companyId: kenya.id, year: 2026, month: 9 }).expect(409);
    });

    it('calculates the tester payslip from the Kenya rules', async () => {
      const run = await api('get', `/payroll/runs/${runId}`, 'payroll').expect(200);
      const slip = run.body.payslips.find((p: { employee: { employeeNo: string } }) => p.employee.employeeNo === 'MSA-KE-T00005');
      // 128,000 gross: NSSF 4,320, SHIF 3,520, AHL 1,920, PAYE on 118,240
      expect(Number(slip.gross)).toBe(128000);
      const line = (code: string) => Number(slip.lines.find((l: { code: string }) => l.code === code).amount);
      expect(line('NSSF')).toBe(4320);
      expect(line('SHIF')).toBe(3520);
      expect(line('AHL')).toBe(1920);
    });

    it('refuses payroll for the US parent company, which has no payroll rules', async () => {
      const parent = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-INC' } });
      await api('post', '/payroll/runs', 'payroll').send({ companyId: parent.id, year: 2026, month: 9 }).expect(422);
    });

    it('runs payroll in Uganda with PAYE, NSSF and Local Service Tax', async () => {
      const uganda = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-UG' } });
      const emp = await prisma.employee.create({
        data: { employeeNo: 'MSA-UG-T00001', firstName: 'Ruth', lastName: 'Nakato', jobTitle: 'Developer', department: 'Engineering', hireDate: new Date('2025-01-06'), monthlyBasic: '1000000.00', companyId: uganda.id },
      });
      const res = await api('post', '/payroll/runs', 'payroll').send({ companyId: uganda.id, year: 2026, month: 9 }).expect(201);
      const run = await api('get', `/payroll/runs/${res.body.id}`, 'payroll').expect(200);
      expect(run.body.rulesVersion).toBe('UG-2026.1-draft');
      const slip = run.body.payslips.find((p: { employeeId: string }) => p.employeeId === emp.id);
      const line = (code: string) => Number(slip.lines.find((l: { code: string }) => l.code === code).amount);
      expect(line('PAYE')).toBe(202000);
      expect(line('NSSF')).toBe(50000);
      expect(line('LST')).toBe(22500);
      expect(Number(slip.net)).toBe(725500);
      await prisma.payslip.deleteMany({ where: { runId: res.body.id } });
      await prisma.payrollRun.delete({ where: { id: res.body.id } });
      await prisma.employee.delete({ where: { id: emp.id } });
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
      // Every country except the US parent company
      expect(created).toHaveLength(8);
      const again = await app.get(PayrollService).createMonthEndDrafts(new Date(Date.UTC(2026, 9, 20)));
      expect(again).toHaveLength(0);
    });
  });
  describe('staff profiles', () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    let dev: { id: string };
    let hr: { id: string };

    beforeAll(async () => {
      dev = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'developer@mindspace-ai.test' } } });
      hr = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'hr@mindspace-ai.test' } } });
    });

    it('shows an employee their full profile with next of kin', async () => {
      const res = await api('get', `/employees/${dev.id}/profile`, 'developer').expect(200);
      expect(res.body.access).toBe('SELF');
      expect(res.body.nationalIdNumber).toMatch(/^SPECIMEN-KE-/);
      expect(res.body.nextOfKin).toHaveLength(1);
      expect(res.body.can).toMatchObject({ editPersonal: true, editJob: false, verifyDocuments: false });
    });

    it('shows a manager only the work details of their own reports', async () => {
      const res = await api('get', `/employees/${dev.id}/profile`, 'manager').expect(200);
      expect(res.body.access).toBe('MANAGER');
      expect(res.body.nationalIdNumber).toBeUndefined();
      expect(res.body.nextOfKin).toBeUndefined();
      expect(res.body.monthlyBasic).toBeUndefined();
      await api('get', `/employees/${dev.id}/documents`, 'manager').expect(403);
      await api('get', `/employees/${hr.id}/profile`, 'manager').expect(403);
    });

    it('keeps colleagues out of each other’s profiles', async () => {
      await api('get', `/employees/${hr.id}/profile`, 'developer').expect(403);
      await api('get', `/employees/${dev.id}/profile`, 'tester').expect(403);
      await api('get', `/employees/${dev.id}/photo`, 'tester').expect(403);
    });

    it('lets an employee update their contact details and next of kin, but not their job', async () => {
      await api('patch', `/employees/${dev.id}/personal`, 'developer').send({ mobilePhone: '+254 700 000 111', dependants: 2 }).expect(200);
      await api('patch', `/employees/${dev.id}/personal`, 'developer').send({ jobTitle: 'CEO' }).expect(400);
      await api('patch', `/employees/${dev.id}`, 'developer').send({ jobTitle: 'CEO' }).expect(403);
      const kin = await api('put', `/employees/${dev.id}/next-of-kin`, 'developer')
        .send({ contacts: [{ name: 'Mary Mwangi', relationship: 'Sister', phone: '+254 733 200 004' }, { name: 'Paul Mwangi', relationship: 'Father', phone: '+254 711 000 222', isBeneficiary: true }] })
        .expect(200);
      expect(kin.body).toHaveLength(2);
      await api('put', `/employees/${hr.id}/next-of-kin`, 'developer').send({ contacts: [] }).expect(403);
    });

    it('lets HR change job and ID details', async () => {
      const res = await api('patch', `/employees/${dev.id}`, 'hr').send({ grade: 'G4', dateOfBirth: '1996-04-09', taxId: 'SPECIMEN-TAX-1' }).expect(200);
      expect(res.body.grade).toBe('G4');
    });

    it('takes document uploads, pending for employees and verified for HR', async () => {
      const own = await api('post', `/employees/${dev.id}/documents`, 'developer')
        .field('type', 'Highest education certificate').attach('file', PDF, 'degree.pdf').expect(201);
      expect(own.body.status).toBe('PENDING');
      expect(own.body.hrOnly).toBe(false);

      await api('post', `/employees/${dev.id}/documents`, 'developer')
        .field('type', 'Other').attach('file', Buffer.from('<script>alert(1)</script>'), 'evil.pdf').expect(400);

      const hidden = await api('post', `/employees/${dev.id}/documents`, 'hr')
        .field('type', 'Background check report').field('hrOnly', 'true').attach('file', PDF, 'check.pdf').expect(201);
      expect(hidden.body).toMatchObject({ status: 'VERIFIED', hrOnly: true });

      const mine = await api('get', `/employees/${dev.id}/documents`, 'developer').expect(200);
      expect(mine.body.map((d: { id: string }) => d.id)).toEqual([own.body.id]);
      await api('get', `/documents/${hidden.body.id}/file`, 'developer').expect(404);

      const file = await api('get', `/documents/${own.body.id}/file`, 'developer').buffer(true).expect(200);
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

      await api('patch', `/documents/${own.body.id}`, 'developer').send({ status: 'VERIFIED' }).expect(403);
      const verified = await api('patch', `/documents/${own.body.id}`, 'hr').send({ status: 'VERIFIED' }).expect(200);
      expect(verified.body.status).toBe('VERIFIED');
      await api('delete', `/documents/${hidden.body.id}`, 'hr').expect(200);
    });

    it('stores a profile photo that the employee and their manager can see', async () => {
      await api('put', `/employees/${dev.id}/photo`, 'developer').attach('file', PDF, 'me.pdf').expect(400);
      await api('put', `/employees/${dev.id}/photo`, 'developer').attach('file', PNG, 'me.png').expect(200);
      const own = await api('get', `/employees/${dev.id}/photo`, 'developer').expect(200);
      expect(own.headers['content-type']).toBe('image/png');
      await api('get', `/employees/${dev.id}/photo`, 'manager').expect(200);
    });

    it('searches and pages the staff list', async () => {
      const res = await api('get', '/employees?q=mwangi&pageSize=1', 'hr').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].lastName).toBe('Mwangi');
      // Kevin uploaded a photo above; the list says so without exposing where it is stored
      expect(res.body.items[0].hasPhoto).toBe(true);
      expect(res.body.items[0].photoKey).toBeUndefined();
    });

    it('imports sample staff with next of kin, documents and photos, and skips them on a second run', async () => {
      // A three-person slice of the real sample data
      const src = path.join(__dirname, '../../../sample-data');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hr-sample-'));
      const ids = ['MSA-KE-000012', 'MSA-KE-000001', 'MSA-UG-001973'];
      const slice = async (name: string) => {
        const lines = gunzipSync(await fs.readFile(path.join(src, name))).toString('utf8').split('\n');
        const keep = [lines[0], ...lines.filter((l) => ids.some((id) => l.includes(`,${id},`) || l.startsWith(`${id},`)))];
        await fs.writeFile(path.join(dir, name), gzipSync(keep.join('\n') + '\n'));
      };
      await slice('employees.csv.gz');
      await slice('employee_documents_register.csv.gz');
      const photos = JSON.parse(gunzipSync(await fs.readFile(path.join(src, 'profile_photos.json.gz'))).toString('utf8'));
      await fs.writeFile(path.join(dir, 'profile_photos.json.gz'), gzipSync(JSON.stringify(Object.fromEntries(ids.map((id) => [id, photos[id]])))));
      await fs.cp(path.join(src, 'personal_files', 'MSA-KE-000012_Njeri_Njoroge'), path.join(dir, 'personal_files', 'MSA-KE-000012_Njeri_Njoroge'), { recursive: true });
      expect(parseCsv(gunzipSync(await fs.readFile(path.join(dir, 'employees.csv.gz'))).toString('utf8'))).toHaveLength(3);

      // MSA-KE-000001 was given to the employee added earlier in this test run, so that row is skipped
      const first = await importSample(prisma, () => undefined, dir);
      expect(first.imported).toBe(2);
      const grace = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: 'MSA-KE-000001' } });
      expect(grace.firstName).toBe('Grace');
      const njeri = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: 'MSA-KE-000012' }, include: { nextOfKin: true, documents: true } });
      expect(njeri.nextOfKin).toHaveLength(1);
      expect(njeri.photoKey).toBe('photos/MSA-KE-000012.png');
      expect(njeri.documents.filter((d) => d.storageKey).map((d) => d.type).sort()).toEqual(['Employee profile summary', 'Highest education certificate', 'National ID or passport']);

      const res = await api('get', `/employees/${njeri.id}/documents`, 'hr').expect(200);
      const id = res.body.find((d: { type: string }) => d.type === 'National ID or passport');
      await api('get', `/documents/${id.id}/file`, 'hr').expect(200);
      await api('get', `/employees/${njeri.id}/photo`, 'hr').expect(200);

      const again = await importSample(prisma, () => undefined, dir);
      expect(again.imported).toBe(0);
    });
  });
  describe('leave', () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    // Next year, so every date is in the future; the year's Kenya holidays are replaced by one known holiday
    const Y = new Date().getUTCFullYear() + 1;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const firstMonday = new Date(Date.UTC(Y, 1, 1 + ((8 - new Date(Date.UTC(Y, 1, 1)).getUTCDay()) % 7)));
    const day = (week: number, weekday: number) => iso(new Date(firstMonday.getTime() + ((week - 1) * 7 + weekday) * 86_400_000));
    let dev: { id: string };
    let tester: { id: string };
    let devLeaveId: string;

    const annual = async (who: string) => {
      const res = await api('get', `/leave/balances?year=${Y}`, who).expect(200);
      return res.body.find((b: { type: string }) => b.type === 'ANNUAL');
    };

    beforeAll(async () => {
      dev = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'developer@mindspace-ai.test' } } });
      tester = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'tester@mindspace-ai.test' } } });
      await api('get', `/leave/holidays?countryCode=KE&year=${Y}`, 'developer').expect(200);
      await prisma.publicHoliday.deleteMany({ where: { countryCode: 'KE', date: { gte: new Date(`${Y}-01-01`), lte: new Date(`${Y}-12-31`) } } });
    });

    it('publishes each country’s public holidays and lets only HR change them', async () => {
      const res = await api('get', '/leave/holidays?countryCode=KE&year=2026', 'developer').expect(200);
      expect(res.body.map((h: { name: string }) => h.name)).toContain('Jamhuri Day');
      const holiday = { countryCode: 'KE', date: day(2, 2), name: 'Test holiday' };
      await api('post', '/leave/holidays', 'developer').send(holiday).expect(403);
      await api('post', '/leave/holidays', 'hr').send(holiday).expect(201);
      await api('post', '/leave/holidays', 'hr').send(holiday).expect(409);
    });

    it('counts working days, skipping the weekend and public holidays', async () => {
      const res = await api('get', `/leave/preview?startDate=${day(2, 0)}&endDate=${day(2, 6)}`, 'developer').expect(200);
      expect(res.body.days).toBe(4);
      expect(res.body.holidays).toEqual([{ date: day(2, 2), name: 'Test holiday' }]);
    });

    it('sends a request to the manager, who approves it', async () => {
      const before = await annual('developer');
      const res = await api('post', '/leave/requests', 'developer')
        .field('type', 'ANNUAL').field('startDate', day(2, 0)).field('endDate', day(2, 4)).field('handoverTo', 'Faith Njeri')
        .expect(201);
      devLeaveId = res.body.id;
      expect(res.body).toMatchObject({ status: 'PENDING_MANAGER', days: 4, canCancel: true });
      expect(mail.outbox.some((m) => m.to === 'manager@mindspace-ai.test' && m.subject === 'Leave request from Kevin Mwangi')).toBe(true);
      expect((await annual('developer')).pending).toBe(before.pending + 4);

      // No overlapping requests
      await api('post', '/leave/requests', 'developer').field('type', 'SICK').field('startDate', day(2, 4)).field('endDate', day(2, 4)).expect(409);

      const queue = await api('get', '/leave/approvals', 'manager').expect(200);
      expect(queue.body.map((r: { id: string }) => r.id)).toContain(devLeaveId);
      await api('post', `/leave/requests/${devLeaveId}/approve`, 'developer').expect(403);
      await api('post', `/leave/requests/${devLeaveId}/approve`, 'tester').expect(403);
      const ok = await api('post', `/leave/requests/${devLeaveId}/approve`, 'manager').send({ note: 'Enjoy' }).expect(201);
      expect(ok.body.status).toBe('APPROVED');
      await api('post', `/leave/requests/${devLeaveId}/decline`, 'manager').expect(409);
      expect(mail.outbox.some((m) => m.to === 'developer@mindspace-ai.test' && m.subject === 'Your leave was approved')).toBe(true);
      const after = await annual('developer');
      expect(after.approved).toBe(before.approved + 4);
      expect(after.left).toBe(before.left - 4);
    });

    it('keeps other people’s leave private', async () => {
      await api('get', `/leave/requests?employeeId=${dev.id}&year=${Y}`, 'tester').expect(403);
      await api('get', `/leave/requests?employeeId=${dev.id}&year=${Y}`, 'manager').expect(200);
      const hrEmp = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'hr@mindspace-ai.test' } } });
      await api('get', `/leave/requests?employeeId=${hrEmp.id}&year=${Y}`, 'manager').expect(403);
      // A teammate sees that Kevin is away, but not why
      const month = day(2, 0).slice(0, 7);
      const team = await api('get', `/leave/calendar?month=${month}`, 'tester').expect(200);
      expect(team.body.entries.find((e: { employeeId: string }) => e.employeeId === dev.id)).toMatchObject({ type: null, status: 'APPROVED' });
      const mgr = await api('get', `/leave/calendar?month=${month}`, 'manager').expect(200);
      expect(mgr.body.entries.find((e: { employeeId: string }) => e.employeeId === dev.id).type).toBe('ANNUAL');
    });

    it('enforces allowances and the medical certificate rule', async () => {
      const floating = await api('post', '/leave/requests', 'tester').field('type', 'FLOATING').field('startDate', day(3, 0)).field('endDate', day(3, 2)).expect(400);
      expect(floating.body.message).toContain('Only 2 days');
      await api('post', '/leave/requests', 'tester').field('type', 'SICK').field('startDate', day(4, 0)).field('endDate', day(4, 2)).expect(400);
      const sick = await api('post', '/leave/requests', 'tester')
        .field('type', 'SICK').field('startDate', day(4, 0)).field('endDate', day(4, 2)).attach('file', PDF, 'certificate.pdf')
        .expect(201);
      const doc = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: sick.body.documentId } });
      expect(doc).toMatchObject({ type: 'Medical certificate (sick leave)', status: 'PENDING' });
      // The employee can withdraw it while it waits
      const cancelled = await api('post', `/leave/requests/${sick.body.id}/cancel`, 'tester').expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      await api('post', `/leave/requests/${devLeaveId}/cancel`, 'tester').expect(403);
    });

    it('needs HR as well as the manager for unpaid leave, and takes it off pay', async () => {
      const req = await api('post', '/leave/requests', 'tester').field('type', 'UNPAID').field('startDate', day(3, 0)).field('endDate', day(3, 2)).expect(201);
      const step1 = await api('post', `/leave/requests/${req.body.id}/approve`, 'manager').expect(201);
      expect(step1.body.status).toBe('PENDING_HR');
      expect(mail.outbox.some((m) => m.to === 'hr@mindspace-ai.test' && m.subject.startsWith('Leave waiting for HR'))).toBe(true);
      await api('post', `/leave/requests/${req.body.id}/approve`, 'manager').expect(403);
      const step2 = await api('post', `/leave/requests/${req.body.id}/approve`, 'hr').expect(201);
      expect(step2.body.status).toBe('APPROVED');

      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      const run = await api('post', '/payroll/runs', 'payroll').send({ companyId: kenya.id, year: Y, month: 2 }).expect(201);
      const slip = run.body.payslips.find((p: { employeeId: string }) => p.employeeId === tester.id);
      const month = await api('get', `/leave/preview?startDate=${Y}-02-01&endDate=${iso(new Date(Date.UTC(Y, 2, 0)))}`, 'tester').expect(200);
      const unpaid = slip.lines.find((l: { code: string }) => l.code === 'LEAVE_UNPAID');
      expect(unpaid.label).toBe(`Leave: 3 unpaid days of ${month.body.days}`);
      expect(unpaid.amount).toBeCloseTo(-(120000 * 3) / month.body.days, 2);
      expect(Number(slip.gross)).toBeCloseTo(128000 + unpaid.amount, 2);
      const devSlip = run.body.payslips.find((p: { employeeId: string }) => p.employeeId === dev.id);
      expect(devSlip.annualLeaveLeft).toBe((await annual('developer')).left + (await annual('developer')).pending);
    });

    it('lets HR record leave for staff without a login, approved at once', async () => {
      const njeri = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: 'MSA-KE-000012' } });
      await api('post', '/leave/requests', 'developer').field('type', 'ANNUAL').field('startDate', day(5, 0)).field('endDate', day(5, 0)).field('employeeId', njeri.id).expect(403);
      const res = await api('post', '/leave/requests', 'hr').field('type', 'ANNUAL').field('startDate', day(5, 0)).field('endDate', day(5, 1)).field('employeeId', njeri.id).expect(201);
      expect(res.body).toMatchObject({ status: 'APPROVED', days: 2 });
      const adj = await api('post', '/leave/adjustments', 'hr').send({ employeeId: njeri.id, type: 'ANNUAL', year: Y, days: 3, reason: 'Opening balance' }).expect(201);
      expect(adj.body.days).toBe(3);
      const bal = await api('get', `/leave/balances?employeeId=${njeri.id}&year=${Y}`, 'hr').expect(200);
      expect(bal.body.find((b: { type: string }) => b.type === 'ANNUAL')).toMatchObject({ adjustment: 3, approved: 2 });
    });
  });

  describe('advances, loans, IOUs and benefits', () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const now = new Date();
    const thisMonth = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
    const nextMonth = thisMonth % 100 === 12 ? thisMonth + 89 : thisMonth + 1;
    const monthText = (m: number) => `${Math.floor(m / 100)}-${String(m % 100).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    let dev: { id: string };
    let tester: { id: string };
    let advanceId: string;
    let housingId: string;
    let iouId: string;

    const queue = async (who: string) => (await api('get', '/approvals', who).expect(200)).body as Array<{ entity: string; id: string; title: string }>;

    beforeAll(async () => {
      dev = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'developer@mindspace-ai.test' } } });
      tester = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'tester@mindspace-ai.test' } } });
    });

    it('limits an advance to half of net pay and once in 3 months, then takes it through manager, payroll and finance', async () => {
      // The seeded advance is still waiting, so another one is refused until it is withdrawn
      const seeded = await prisma.loan.findFirstOrThrow({ where: { employeeId: tester.id, kind: 'ADVANCE' } });
      const quote = await api('get', '/loans/quote?kind=ADVANCE&amount=10000', 'tester').expect(200);
      expect(quote.body.problems.join(' ')).toContain('One advance is allowed in any 3 months');
      await api('post', `/loans/${seeded.id}/cancel`, 'tester').expect(201);

      const options = await api('get', '/loans/options', 'tester').expect(200);
      expect(Number(options.body.maxAdvance)).toBeCloseTo(Number(options.body.net) / 2, 0);
      const tooMuch = await api('post', '/loans', 'tester').send({ kind: 'ADVANCE', amount: Number(options.body.maxAdvance) + 1, purpose: 'Rent' }).expect(400);
      expect(tooMuch.body.message).toContain('at most half of your net pay');

      const res = await api('post', '/loans', 'tester').send({ kind: 'ADVANCE', amount: 20000, purpose: 'School fees' }).expect(201);
      advanceId = res.body.id;
      expect(res.body).toMatchObject({ status: 'PENDING', stageLabel: 'Manager', stages: ['Manager', 'Payroll', 'Finance'], canCancel: true });
      expect(mail.outbox.some((m) => m.to === 'manager@mindspace-ai.test' && m.subject === 'Salary advance request from Faith Njeri')).toBe(true);

      expect((await queue('manager')).map((q) => q.id)).toContain(advanceId);
      await api('post', `/approvals/loan/${advanceId}/approve`, 'payroll').expect(403);
      await api('post', `/approvals/loan/${advanceId}/approve`, 'manager').expect(201);
      await api('post', `/approvals/loan/${advanceId}/approve`, 'finance').expect(403);
      await api('post', `/approvals/loan/${advanceId}/approve`, 'payroll').expect(201);
      const done = await api('post', `/approvals/loan/${advanceId}/approve`, 'finance').send({ note: 'Paid today' }).expect(201);
      expect(done.body).toMatchObject({ status: 'APPROVED', instalment: '20000.00', outstanding: '20000.00' });
      expect(mail.outbox.some((m) => m.to === 'tester@mindspace-ai.test' && m.subject === 'Your salary advance was approved')).toBe(true);

      await api('post', '/loans', 'tester').send({ kind: 'ADVANCE', amount: 5000, purpose: 'Again' }).expect(400);
    });

    it('caps loans at 3 times gross pay, lets housing go higher with the Country Head, and keeps loans private', async () => {
      const personal = await api('post', '/loans', 'developer').send({ kind: 'LOAN', product: 'PERSONAL', amount: 1_000_000, months: 36, purpose: 'Car' }).expect(400);
      expect(personal.body.message).toContain('3 times monthly gross pay');
      const unaffordable = await api('get', '/loans/quote?kind=LOAN&product=HOUSING&amount=2000000&months=12', 'developer').expect(200);
      expect(unaffordable.body.problems.join(' ')).toContain('below a third of gross pay');

      const res = await api('post', '/loans', 'developer')
        .send({ kind: 'LOAN', product: 'HOUSING', amount: 1_000_000, months: 36, purpose: 'Deposit on a flat', guarantor: 'Amina Hassan' })
        .expect(201);
      housingId = res.body.id;
      expect(res.body.stages).toEqual(['Manager', 'HR', 'Finance', 'Country Head']);
      expect(res.body.interestRate).toBe(4);

      await api('get', `/loans?employeeId=${dev.id}`, 'tester').expect(403);
      await api('get', `/loans?employeeId=${dev.id}`, 'hr').expect(403);
      await api('get', `/loans?employeeId=${dev.id}`, 'finance').expect(200);
      await api('get', '/loans/book', 'hr').expect(403);

      await api('post', `/approvals/loan/${housingId}/approve`, 'manager').expect(201);
      expect((await queue('hr')).map((q) => q.id)).toContain(housingId);
      await api('post', `/approvals/loan/${housingId}/approve`, 'hr').expect(201);
      await api('post', `/approvals/loan/${housingId}/approve`, 'finance').expect(201);
      const done = await api('post', `/approvals/loan/${housingId}/approve`, 'admin').expect(201);
      expect(done.body.status).toBe('APPROVED');
      expect(done.body.upcoming).toHaveLength(36);
    });

    it('settles an IOU with receipts and recovers the unspent balance, or all of it when overdue', async () => {
      await api('post', '/loans', 'tester').send({ kind: 'IOU', amount: 10000, purpose: 'Team offsite supplies', neededOn: today, settleBy: inDays(20) }).expect(400);
      const res = await api('post', '/loans', 'tester').send({ kind: 'IOU', amount: 10000, purpose: 'Team offsite supplies', neededOn: today, costCentre: 'ENG-01' }).expect(201);
      iouId = res.body.id;
      expect(res.body.stages).toEqual(['Manager', 'Finance']);
      await api('post', `/approvals/loan/${iouId}/approve`, 'manager').expect(201);
      const issued = await api('post', `/approvals/loan/${iouId}/approve`, 'finance').expect(201);
      expect(issued.body).toMatchObject({ status: 'APPROVED', outstanding: '0.00' });
      const mine = await api('get', '/loans', 'tester').expect(200);
      expect(mine.body.loans.find((l: { id: string }) => l.id === iouId).canSettle).toBe(true);

      await api('post', `/loans/${iouId}/settle`, 'tester').field('spent', '6000').field('cashReturned', '1000').expect(400);
      const sent = await api('post', `/loans/${iouId}/settle`, 'tester').field('spent', '6000').field('cashReturned', '1000').attach('file', PDF, 'receipts.pdf').expect(201);
      expect(sent.body.stageLabel).toBe('Finance (settlement)');
      const financeQueue = await queue('finance');
      expect(financeQueue.find((q) => q.id === iouId)!.title).toBe('IOU settlement');
      await api('get', `/loans/${iouId}/receipt`, 'finance').expect(200);
      await api('get', `/loans/${iouId}/receipt`, 'manager').expect(403);
      const settled = await api('post', `/approvals/loan/${iouId}/approve`, 'finance').expect(201);
      expect(settled.body).toMatchObject({ status: 'APPROVED', outstanding: '3000.00', instalment: '3000.00' });

      // The seeded IOU is made overdue, then Finance recovers it through payroll after emailing a notice
      const brianIou = await prisma.loan.findFirstOrThrow({ where: { kind: 'IOU', employee: { user: { email: 'payroll@mindspace-ai.test' } } } });
      await api('post', `/loans/${brianIou.id}/recover`, 'finance').expect(409);
      await prisma.loan.update({ where: { id: brianIou.id }, data: { settleBy: new Date(Date.now() - 2 * 86_400_000) } });
      await api('post', `/loans/${brianIou.id}/recover`, 'payroll').expect(403);
      const recovered = await api('post', `/loans/${brianIou.id}/recover`, 'finance').expect(201);
      expect(recovered.body.outstanding).toBe('15000.00');
      expect(mail.outbox.some((m) => m.to === 'payroll@mindspace-ai.test' && m.subject === 'Unsettled IOU will be deducted from your pay')).toBe(true);
    });

    it('enrols staff in meal and gym options their work location allows, through HR and payroll', async () => {
      const plans = (await api('get', '/benefits/plans', 'tester').expect(200)).body as Array<{ id: string; name: string; eligible: boolean }>;
      const plan = (name: string) => plans.find((p) => p.name === name)!;
      expect(plan('Remote meal allowance').eligible).toBe(false);
      await api('post', '/benefits/enrolments', 'tester').send({ planId: plan('Remote meal allowance').id, startMonth: monthText(nextMonth) }).expect(400);
      // Faith already has the canteen wallet
      await api('post', '/benefits/enrolments', 'tester').send({ planId: plan('Partner meal card').id, startMonth: monthText(nextMonth) }).expect(409);
      await api('post', '/benefits/enrolments', 'tester').send({ planId: plan('Premium').id, startMonth: monthText(nextMonth) }).expect(400);
      const res = await api('post', '/benefits/enrolments', 'tester')
        .send({ planId: plan('Premium').id, startMonth: monthText(nextMonth), branch: 'Kilimani', emergencyContact: 'John Njeri, +254 733 200 005' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'PENDING', stageLabel: 'HR' });
      await api('post', `/approvals/enrolment/${res.body.id}/approve`, 'payroll').expect(403);
      await api('post', `/approvals/enrolment/${res.body.id}/approve`, 'hr').expect(201);
      const ok = await api('post', `/approvals/enrolment/${res.body.id}/approve`, 'payroll').expect(201);
      expect(ok.body.status).toBe('APPROVED');
      // Not started yet, so ending it simply cancels it
      const ended = await api('post', `/benefits/enrolments/${res.body.id}/end`, 'tester').expect(201);
      expect(ended.body.status).toBe('CANCELLED');
    });

    it('lets managers nominate their team for gift vouchers, approved by HR', async () => {
      const nominees = await api('get', '/benefits/nominees', 'manager').expect(200);
      expect(nominees.body.map((n: { name: string }) => n.name).sort()).toEqual(['Faith Njeri', 'Kevin Mwangi']);
      await api('post', '/benefits/vouchers', 'tester').send({ employeeId: dev.id, occasion: 'BIRTHDAY', value: 3000 }).expect(403);
      const hrEmp = await prisma.employee.findFirstOrThrow({ where: { user: { email: 'hr@mindspace-ai.test' } } });
      await api('post', '/benefits/vouchers', 'manager').send({ employeeId: hrEmp.id, occasion: 'BIRTHDAY', value: 3000 }).expect(403);
      const nominated = await api('post', '/benefits/vouchers', 'manager').send({ employeeId: dev.id, occasion: 'BIRTHDAY', value: 3000, partner: 'Bookstore' }).expect(201);
      expect(nominated.body).toMatchObject({ status: 'PENDING', stageLabel: 'HR' });

      const seeded = await prisma.giftVoucher.findFirstOrThrow({ where: { employeeId: tester.id } });
      expect((await queue('hr')).map((q) => q.id)).toEqual(expect.arrayContaining([seeded.id, nominated.body.id]));
      const issued = await api('post', `/approvals/voucher/${seeded.id}/approve`, 'hr').expect(201);
      expect(issued.body.status).toBe('APPROVED');
      expect(mail.outbox.some((m) => m.to === 'tester@mindspace-ai.test' && m.subject === 'You have a gift voucher')).toBe(true);
      await api('post', `/approvals/voucher/${nominated.body.id}/decline`, 'hr').send({ note: 'Over budget' }).expect(201);
    });

    it('deducts advances, IOUs, loans and gym shares in payroll, taxes benefits, and records repayments when finalized', async () => {
      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      // The month-end job may already have drafted this month's run; if so it is recalculated
      const existing = await prisma.payrollRun.findUnique({ where: { companyId_periodYear_periodMonth: { companyId: kenya.id, periodYear: Math.floor(thisMonth / 100), periodMonth: thisMonth % 100 } } });
      const run = existing
        ? await api('post', `/payroll/runs/${existing.id}/recalculate`, 'payroll').expect(201)
        : await api('post', '/payroll/runs', 'payroll').send({ companyId: kenya.id, year: Math.floor(thisMonth / 100), month: thisMonth % 100 }).expect(201);
      type Line = { code: string; kind: string; amount: number; ref?: string; label: string };
      const slipOf = (id: string) => run.body.payslips.find((p: { employeeId: string }) => p.employeeId === id) as { id: string; lines: Line[]; gross: string; net: string };

      const faith = slipOf(tester.id);
      const code = (slip: { lines: Line[] }, c: string) => slip.lines.filter((l) => l.code === c);
      expect(code(faith, 'ADVANCE')[0]).toMatchObject({ kind: 'DEDUCTION', amount: 20000, ref: advanceId });
      expect(code(faith, 'IOU')[0]).toMatchObject({ amount: 3000, ref: iouId });
      expect(code(faith, 'MEAL')[0]).toMatchObject({ kind: 'BENEFIT', amount: 4000, label: 'Meal: Canteen wallet (taxed)' });
      expect(code(faith, 'VOUCHER')[0]).toMatchObject({ kind: 'BENEFIT', amount: 5000 });
      expect(Number(faith.gross)).toBe(128000);
      expect(Number(faith.net)).toBeGreaterThanOrEqual(128000 / 3);

      const kevin = slipOf(dev.id);
      expect(code(kevin, 'LOAN')).toHaveLength(2);
      expect(code(kevin, 'GYM_SHARE')[0]).toMatchObject({ amount: 2000 });
      expect(code(kevin, 'GYM')[0]).toMatchObject({ kind: 'BENEFIT', amount: 3000, label: 'Gym: Standard' });
      expect(code(kevin, 'FBT_ER')[0].kind).toBe('EMPLOYER');

      await api('post', `/payroll/runs/${run.body.id}/approve`, 'admin').expect(201);
      await api('post', `/payroll/runs/${run.body.id}/finalize`, 'admin').expect(201);
      const advance = await prisma.loan.findUniqueOrThrow({ where: { id: advanceId }, include: { repayments: true } });
      expect(advance.status).toBe('CLOSED');
      expect(advance.repayments).toHaveLength(1);
      const mine = await api('get', '/loans', 'developer').expect(200);
      const housing = mine.body.loans.find((l: { id: string }) => l.id === housingId);
      expect(housing.repayments).toHaveLength(1);
      expect(Number(housing.outstanding)).toBeLessThan(1_000_000);
      // New requests now start from next month, because this month's payroll is final
      const quote = await api('get', '/loans/quote?kind=LOAN&product=EMERGENCY&amount=10000&months=2', 'developer').expect(200);
      expect(quote.body.firstMonth).toBe(nextMonth);

      const book = await api('get', `/loans/book?companyId=${kenya.id}`, 'finance').expect(200);
      expect(Number(book.body.totals.KES)).toBeGreaterThan(0);
    });
  });

  describe('policies, chat, community page and activity tracker', () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

    it('lists the 22 policies and 20 forms, and records who has read a policy', async () => {
      const all = await api('get', '/library', 'tester').expect(200);
      expect(all.body.filter((i: { kind: string }) => i.kind === 'POLICY')).toHaveLength(22);
      expect(all.body.filter((i: { kind: string }) => i.kind === 'FORM')).toHaveLength(20);
      const pol = all.body.find((i: { code: string }) => i.code === 'POL-20');
      expect(pol.readAt).toBeNull();
      const before = (await api('get', '/library/pending', 'tester').expect(200)).body.count;
      const file = await api('get', `/library/${pol.id}/file`, 'tester').expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      await api('post', `/library/${pol.id}/acknowledge`, 'tester').expect(201);
      expect((await api('get', '/library/pending', 'tester').expect(200)).body.count).toBe(before - 1);
      const form = all.body.find((i: { code: string }) => i.code === 'HR-F10');
      await api('post', `/library/${form.id}/acknowledge`, 'tester').expect(400);
    });

    it('lets only HR publish, and a new version asks everyone to read it again', async () => {
      const pol = (await api('get', '/library?kind=POLICY', 'hr').expect(200)).body.find((i: { code: string }) => i.code === 'POL-20');
      await api('post', `/library/${pol.id}/versions`, 'developer').field('version', '0.2').attach('file', PDF, 'p.pdf').expect(403);
      await api('post', `/library/${pol.id}/versions`, 'hr').field('version', '0.2').attach('file', PNG, 'p.png').expect(400);
      await api('post', `/library/${pol.id}/versions`, 'hr').field('version', '0.2').attach('file', PDF, 'p.pdf').expect(201);
      const again = (await api('get', '/library', 'tester').expect(200)).body.find((i: { code: string }) => i.code === 'POL-20');
      expect(again).toMatchObject({ version: '0.2', readAt: null, readEarlier: true });
      const report = await api('get', `/library/${pol.id}/report`, 'hr').expect(200);
      expect(report.body.perCompany.find((c: { company: string }) => c.company.includes('Kenya')).read).toBe(0);
      const sent = await api('post', `/library/${pol.id}/remind`, 'hr').expect(201);
      expect(sent.body.sent).toBeGreaterThan(0);
      const created = await api('post', '/library', 'hr')
        .field('kind', 'FORM').field('code', 'HR-F21').field('title', 'Equipment Request').field('category', 'Work arrangements').field('version', '1.0')
        .attach('file', PDF, 'f.pdf').expect(201);
      expect(created.body.mustRead).toBe(false);
    });

    it('runs a direct chat and a group, and keeps chats private to their members', async () => {
      const people = await api('get', '/chat/people?q=faith', 'developer').expect(200);
      const faith = people.body[0];
      expect(faith.name).toBe('Faith Njeri');
      const chat = await api('post', '/chat/conversations', 'developer').send({ userIds: [faith.id] }).expect(201);
      const same = await api('post', '/chat/conversations', 'developer').send({ userIds: [faith.id] }).expect(201);
      expect(same.body.id).toBe(chat.body.id);
      const sent = await api('post', `/chat/conversations/${chat.body.id}/messages`, 'developer').send({ body: 'Lunch at 1?' }).expect(201);
      expect((await api('get', '/chat/unread', 'tester').expect(200)).body.count).toBeGreaterThan(0);
      const read = await api('get', `/chat/conversations/${chat.body.id}/messages`, 'tester').expect(200);
      expect(read.body.messages.map((m: { body: string }) => m.body)).toContain('Lunch at 1?');
      const newer = await api('get', `/chat/conversations/${chat.body.id}/messages?after=${sent.body.id}`, 'tester').expect(200);
      expect(newer.body.messages).toHaveLength(0);
      await api('get', `/chat/conversations/${chat.body.id}/messages`, 'manager').expect(404);
      await api('post', `/chat/conversations/${chat.body.id}/messages`, 'manager').send({ body: 'hi' }).expect(404);

      const group = await api('post', '/chat/conversations', 'manager').send({ userIds: [faith.id], name: 'Release war room' }).expect(201);
      const kevin = (await api('get', '/chat/people?q=kevin', 'manager').expect(200)).body[0];
      await api('post', `/chat/conversations/${group.body.id}/members`, 'tester').send({ userIds: [kevin.id] }).expect(201);
      await api('post', `/chat/conversations/${group.body.id}/messages`, 'developer').send({ body: 'Joined' }).expect(201);
      await api('post', `/chat/conversations/${group.body.id}/leave`, 'developer').expect(201);
      await api('post', `/chat/conversations/${group.body.id}/messages`, 'developer').send({ body: 'Still here?' }).expect(403);
      const list = await api('get', '/chat/conversations', 'tester').expect(200);
      expect(list.body.find((c: { id: string }) => c.id === group.body.id).name).toBe('Release war room');
    });

    it('lets a member report a chat message and HR remove it', async () => {
      const chats = (await api('get', '/chat/conversations', 'tester').expect(200)).body;
      const direct = chats.find((c: { kind: string; name: string }) => c.kind === 'DIRECT' && c.name === 'Kevin Mwangi');
      const msgs = (await api('get', `/chat/conversations/${direct.id}/messages`, 'tester').expect(200)).body.messages;
      const theirs = msgs.find((m: { mine: boolean }) => !m.mine);
      await api('post', '/reports', 'manager').send({ target: 'MESSAGE', targetId: theirs.id, reason: 'Not my chat' }).expect(404);
      await api('post', '/reports', 'tester').send({ target: 'MESSAGE', targetId: theirs.id, reason: 'Testing the report button' }).expect(201);
      await api('get', '/reports', 'developer').expect(403);
      const open = await api('get', '/reports', 'hr').expect(200);
      const report = open.body.find((r: { targetId: string }) => r.targetId === theirs.id);
      expect(report.body).toBe(theirs.body);
      await api('post', `/reports/${report.id}/remove`, 'hr').send({ note: 'Removed in testing' }).expect(201);
      const after = (await api('get', `/chat/conversations/${direct.id}/messages`, 'tester').expect(200)).body.messages;
      expect(after.find((m: { id: string }) => m.id === theirs.id)).toMatchObject({ body: null, removed: 'Removed by a moderator' });
      expect(mail.outbox.some((m) => m.to === 'developer@mindspace-ai.test' && m.subject.includes('removed'))).toBe(true);
    });

    it('posts to the community page with a photo, likes, comments and moderation', async () => {
      await api('post', '/community/posts', 'tester').field('body', 'Team photo').attach('files', PNG, 'team.png').expect(400);
      await api('post', '/community/posts', 'tester').field('body', 'Bad file').field('filesConfirmed', 'true').attach('files', Buffer.from('MZ not allowed'), 'x.exe').expect(400);
      const post = await api('post', '/community/posts', 'tester').field('body', 'Team photo from the hackathon').field('filesConfirmed', 'true').attach('files', PNG, 'team.png').expect(201);
      expect(post.body.attachments[0]).toMatchObject({ mime: 'image/png', name: 'team.png' });
      const img = await api('get', `/community/posts/${post.body.id}/files/0`, 'developer').expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect((await api('post', `/community/posts/${post.body.id}/like`, 'developer').expect(201)).body.likes).toBe(1);
      await api('post', `/community/posts/${post.body.id}/comments`, 'developer').send({ body: 'Great shot' }).expect(201);
      const feed = await api('get', '/community/posts', 'tester').expect(200);
      const mine = feed.body.posts.find((p: { id: string }) => p.id === post.body.id);
      expect(mine).toMatchObject({ likes: 1, mine: true });
      expect(mine.comments[0].body).toBe('Great shot');
      await api('delete', `/community/posts/${post.body.id}`, 'developer').expect(403);
      await api('post', '/reports', 'developer').send({ target: 'POST', targetId: post.body.id, reason: 'Checking the copyright of this photo' }).expect(201);
      const report = (await api('get', '/reports', 'hr').expect(200)).body.find((r: { targetId: string }) => r.targetId === post.body.id);
      await api('post', `/reports/${report.id}/dismiss`, 'hr').send({ note: 'Own photo' }).expect(201);
      await api('delete', `/community/posts/${post.body.id}`, 'tester').expect(200);
      const gone = await api('get', '/community/posts', 'developer').expect(200);
      expect(gone.body.posts.some((p: { id: string }) => p.id === post.body.id)).toBe(false);
    });

    it('clocks in and out, logs work and shows the team to the manager only', async () => {
      const week = await api('get', '/activity/me', 'tester').expect(200);
      expect(week.body.days).toHaveLength(7);
      expect(week.body.timeZone).toBe('Africa/Nairobi');
      if (week.body.open) await api('post', '/activity/clock-out', 'tester').expect(201);
      const s = await api('post', '/activity/clock-in', 'tester').send({ mode: 'REMOTE' }).expect(201);
      await api('post', '/activity/clock-in', 'tester').send({ mode: 'REMOTE' }).expect(409);
      await api('post', '/activity/clock-out', 'tester').expect(201);
      await api('post', '/activity/clock-out', 'tester').expect(409);
      const today = week.body.today;
      await api('post', '/activity/logs', 'tester').send({ date: today, hours: 25, project: 'X', description: 'Too long' }).expect(400);
      const log = await api('post', '/activity/logs', 'tester').send({ date: today, hours: 2.5, project: 'HR portal', description: 'Exploratory testing' }).expect(201);
      await api('post', '/activity/logs', 'tester').send({ date: '2020-01-06', hours: 1, project: 'Old', description: 'Too far back' }).expect(400);
      const before = new Date(new Date(s.body.clockIn).getTime() - 60 * 60_000);
      await api('patch', `/activity/sessions/${s.body.id}`, 'tester').send({ clockIn: before.toISOString(), clockOut: new Date(before.getTime() + 30 * 60_000).toISOString(), reason: 'Started earlier' }).expect(200);

      const team = await api('get', '/activity/team', 'manager').expect(200);
      const faith = team.body.rows.find((r: { name: string }) => r.name === 'Faith Njeri');
      expect(faith.logs.map((l: { id: string }) => l.id)).toContain(log.body.id);
      expect(faith.flags).toContain('Times edited');
      await api('get', '/activity/team', 'developer').expect(403);
      const csv = await api('get', `/activity/report?month=${today.slice(0, 7)}&format=csv`, 'payroll').expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Faith Njeri');
      await api('get', `/activity/report?month=${today.slice(0, 7)}`, 'manager').expect(403);
    });
  });

  describe('workforce analytics, organisation, recruitment, performance and audit', () => {
    it('shows workforce figures to HR and payroll only', async () => {
      const res = await api('get', '/analytics/workforce', 'hr').expect(200);
      expect(res.body.totals.headcount).toBeGreaterThan(0);
      expect(res.body.byCompany.find((c: { code: string }) => c.code === 'MSA-KE').headcount).toBeGreaterThan(0);
      expect(res.body.monthly).toHaveLength(12);
      // Counts only: no names or pay of individuals
      expect(JSON.stringify(res.body)).not.toContain('Kamau');
      await api('get', '/analytics/workforce', 'payroll').expect(200);
      await api('get', '/analytics/workforce', 'manager').expect(403);
      await api('get', '/analytics/workforce', 'developer').expect(403);
    });

    it('lets anyone see their own reporting line but not other companies', async () => {
      const mine = await api('get', '/organisation/chart', 'developer').expect(200);
      expect(mine.body.root.firstName).toBe('Kevin');
      expect(mine.body.chain.map((n: { firstName: string }) => n.firstName)).toContain('Amina');
      expect(mine.body.root).not.toHaveProperty('monthlyBasic');
      expect(mine.body.root).not.toHaveProperty('nationalIdNumber');
      const amina = mine.body.chain.find((n: { firstName: string }) => n.firstName === 'Amina');
      const team = await api('get', `/organisation/chart?employeeId=${amina.id}`, 'tester').expect(200);
      expect(team.body.reports.length).toBeGreaterThanOrEqual(2);
      const entities = await api('get', '/organisation/entities', 'developer').expect(200);
      expect(entities.body.length).toBeGreaterThanOrEqual(9);
      const nz = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-NZ' } });
      await api('get', `/organisation/departments?companyId=${nz.id}`, 'developer').expect(403);
      await api('get', `/organisation/departments?companyId=${nz.id}`, 'hr').expect(200);
      const outsider = await prisma.employee.create({
        data: { employeeNo: 'MSA-NZ-T09999', firstName: 'Aroha', lastName: 'Ngata', jobTitle: 'Analyst', department: 'Data', hireDate: new Date('2025-01-06'), monthlyBasic: 8000, companyId: nz.id },
      });
      await api('get', `/organisation/chart?employeeId=${outsider.id}`, 'developer').expect(403);
      await api('get', `/organisation/chart?employeeId=${outsider.id}`, 'hr').expect(200);
    });

    it('runs an opening from candidate to hired employee', async () => {
      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      const amina = await prisma.employee.findFirstOrThrow({ where: { workEmail: 'manager@mindspace-ai.test' } });
      await api('post', '/recruitment/openings', 'manager').send({ companyId: kenya.id, title: 'Data Engineer', department: 'Engineering' }).expect(403);
      await api('post', '/recruitment/openings', 'hr').send({ companyId: kenya.id, title: 'Data Engineer', department: 'Engineering', salaryMin: 300000, salaryMax: 200000 }).expect(400);
      const opening = await api('post', '/recruitment/openings', 'hr')
        .send({ companyId: kenya.id, title: 'Data Engineer', department: 'Engineering', workLocation: 'HYBRID', positions: 1, hiringManagerId: amina.id, salaryMin: 200000, salaryMax: 300000 })
        .expect(201);
      expect(opening.body.reference).toMatch(/^REQ-KE-\d{4}$/);

      // The hiring manager sees and works the opening; other staff cannot
      const listed = await api('get', '/recruitment/openings', 'manager').expect(200);
      expect(listed.body.map((o: { id: string }) => o.id)).toContain(opening.body.id);
      await api('get', '/recruitment/openings', 'developer').expect(403);
      const referral = await api('post', `/recruitment/openings/${opening.body.id}/candidates`, 'manager')
        .send({ firstName: 'Njoki', lastName: 'Mwangi', email: 'njoki.mwangi@example.com' })
        .expect(201);
      expect(referral.body.source).toBe('Referral');
      await api('post', `/recruitment/openings/${opening.body.id}/candidates`, 'hr').send({ firstName: 'Njoki', lastName: 'Mwangi', email: 'NJOKI.MWANGI@example.com' }).expect(409);

      const id = referral.body.id;
      await api('patch', `/recruitment/candidates/${id}`, 'manager').send({ stage: 'HIRED' }).expect(400);
      await api('post', `/recruitment/candidates/${id}/hire`, 'hr').send({ hireDate: '2026-11-02', monthlyBasic: 250000 }).expect(400);
      for (const stage of ['SCREENING', 'INTERVIEW', 'OFFER']) await api('patch', `/recruitment/candidates/${id}`, 'manager').send({ stage, rating: 4 }).expect(200);
      await api('post', `/recruitment/candidates/${id}/hire`, 'manager').send({ hireDate: '2026-11-02', monthlyBasic: 250000 }).expect(403);
      const hired = await api('post', `/recruitment/candidates/${id}/hire`, 'hr')
        .send({ hireDate: '2026-11-02', monthlyBasic: 250000, workEmail: 'njoki.mwangi@mindspace-ai.test' })
        .expect(201);
      expect(hired.body.filled).toBe(true);
      const employee = await prisma.employee.findUniqueOrThrow({ where: { id: hired.body.employee.id }, include: { user: true } });
      expect(employee.managerId).toBe(amina.id);
      expect(employee.jobTitle).toBe('Data Engineer');
      expect(employee.user?.role).toBe('EMPLOYEE');
      expect(mail.outbox.some((m) => m.to === 'njoki.mwangi@mindspace-ai.test' && m.subject.includes('Welcome'))).toBe(true);
      const after = await api('get', `/recruitment/openings/${opening.body.id}`, 'hr').expect(200);
      expect(after.body.status).toBe('FILLED');
      await api('post', `/recruitment/openings/${opening.body.id}/candidates`, 'hr').send({ firstName: 'Late', lastName: 'Applicant', email: 'late@example.com' }).expect(400);
    });

    it('runs a review cycle: self review, then the manager, never yourself', async () => {
      const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
      // Close the example cycle from the seed so a new one can open
      for (const c of (await api('get', '/performance/cycles', 'hr').expect(200)).body) {
        if (c.status === 'OPEN' && c.companyId === kenya.id) await api('post', `/performance/cycles/${c.id}/close`, 'hr').expect(201);
      }
      const body = { name: 'E2E year-end review', companyId: kenya.id, periodStart: '2026-07-01', periodEnd: '2026-12-31', selfDueOn: '2026-12-15', managerDueOn: '2027-01-15' };
      await api('post', '/performance/cycles', 'manager').send(body).expect(403);
      await api('post', '/performance/cycles', 'hr').send({ ...body, managerDueOn: '2026-12-01' }).expect(400);
      const cycle = await api('post', '/performance/cycles', 'hr').send(body).expect(201);
      expect(cycle.body.reviews).toBeGreaterThanOrEqual(6);
      await api('post', '/performance/cycles', 'hr').send(body).expect(400);
      expect(mail.outbox.some((m) => m.to === 'tester@mindspace-ai.test' && m.subject.includes('E2E year-end review'))).toBe(true);

      const tester = (await api('get', '/performance/reviews/mine', 'tester').expect(200)).body.own.find((r: { cycleId: string }) => r.cycleId === cycle.body.id);
      expect(tester.status).toBe('SELF_REVIEW');
      await api('post', `/performance/reviews/${tester.id}/manager`, 'manager').send({ rating: 4, comments: 'Strong quarter overall.' }).expect(400);
      await api('post', `/performance/reviews/${tester.id}/self`, 'developer').send({ rating: 5, comments: 'Not my review at all' }).expect(403);
      await api('post', `/performance/reviews/${tester.id}/self`, 'tester').send({ rating: 4, comments: 'Automated the leave regression suite.' }).expect(201);
      await api('post', `/performance/reviews/${tester.id}/self`, 'tester').send({ rating: 5, comments: 'Trying to send it again' }).expect(400);
      await api('post', `/performance/reviews/${tester.id}/manager`, 'tester').send({ rating: 5, comments: 'Rating myself highly here' }).expect(403);
      await api('post', `/performance/reviews/${tester.id}/manager`, 'developer').send({ rating: 1, comments: 'A colleague, not the manager' }).expect(403);
      const toGive = (await api('get', '/performance/reviews/mine', 'manager').expect(200)).body.toGive;
      expect(toGive.map((r: { id: string }) => r.id)).toContain(tester.id);
      const done = await api('post', `/performance/reviews/${tester.id}/manager`, 'manager').send({ rating: 4, comments: 'Reliable and thorough testing.' }).expect(201);
      expect(done.body.status).toBe('COMPLETED');
      expect(mail.outbox.some((m) => m.to === 'tester@mindspace-ai.test' && m.subject.includes('review is complete'))).toBe(true);

      const all = await api('get', `/performance/cycles/${cycle.body.id}/reviews`, 'hr').expect(200);
      expect(all.body.length).toBe(cycle.body.reviews);
      const managers = await api('get', `/performance/cycles/${cycle.body.id}/reviews`, 'manager').expect(200);
      expect(managers.body.every((r: { reviewer: { firstName: string } | null }) => r.reviewer?.firstName === 'Amina')).toBe(true);
      await api('get', `/performance/cycles/${cycle.body.id}/reviews`, 'developer').expect(403);
      const listed = (await api('get', '/performance/cycles', 'hr').expect(200)).body.find((c: { id: string }) => c.id === cycle.body.id);
      expect(listed.progress.completed).toBe(1);
      expect(listed.ratings.find((r: { rating: number }) => r.rating === 4).count).toBe(1);
    });

    it('keeps goals to the employee, their manager and HR', async () => {
      const goal = await api('post', '/performance/goals', 'tester').send({ title: 'Automate payslip checks', weight: 50 }).expect(201);
      await api('patch', `/performance/goals/${goal.body.id}`, 'tester').send({ progress: 100 }).expect(200);
      const mine = await api('get', '/performance/goals', 'tester').expect(200);
      expect(mine.body.goals.find((g: { id: string }) => g.id === goal.body.id).status).toBe('COMPLETED');
      const tester = await prisma.employee.findFirstOrThrow({ where: { workEmail: 'tester@mindspace-ai.test' } });
      await api('get', `/performance/goals?employeeId=${tester.id}`, 'manager').expect(200);
      await api('get', `/performance/goals?employeeId=${tester.id}`, 'hr').expect(200);
      await api('get', `/performance/goals?employeeId=${tester.id}`, 'developer').expect(403);
      await api('patch', `/performance/goals/${goal.body.id}`, 'developer').send({ progress: 0 }).expect(403);
      await api('post', '/performance/goals', 'manager').send({ employeeId: tester.id, title: 'Mentor the new QA hire', weight: 20 }).expect(201);
      await api('delete', `/performance/goals/${goal.body.id}`, 'tester').expect(200);
    });

    it('shows the audit trail to the administrator only', async () => {
      const res = await api('get', '/audit?q=recruitment.hire', 'admin').expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].actor.email).toBe('hr@mindspace-ai.test');
      const byActor = await api('get', '/audit?actor=manager@&pageSize=10', 'admin').expect(200);
      expect(byActor.body.items.every((i: { actor: { email: string } }) => i.actor.email === 'manager@mindspace-ai.test')).toBe(true);
      await api('get', '/audit', 'hr').expect(403);
      await api('get', '/audit', 'payroll').expect(403);
    });
  });
});
