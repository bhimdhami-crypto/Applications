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
      'TRUNCATE "LeaveRequest", "LeaveAdjustment", "PublicHoliday", "Payslip", "PayrollRun", "EmployeeDocument", "NextOfKin", "Employee", "LoginChallenge", "User", "Company", "AuditLog" CASCADE',
    );
    process.env.SEED_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.SEED_USER_PASSWORD = USER_PASSWORD;
    await seed(prisma);

    tokens.admin = await signIn('admin@mindspace-ai.test', ADMIN_PASSWORD);
    for (const who of ['hr', 'payroll', 'manager', 'developer', 'tester']) tokens[who] = await signIn(`${who}@mindspace-ai.test`);
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
      expect(run.body.payslips).toHaveLength(5);
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
});
