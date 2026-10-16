import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

jest.setTimeout(60_000);

describe('employee records', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const employmentOf = async (email: string) => (await prisma.employment.findFirstOrThrow({ where: { user: { email } } })).id;

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['admin', 'hr.kenya', 'hr.france', 'hr.india', 'manager', 'employee', 'payroll.kenya', 'auditor']) {
      as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
    }
    ids.kevin = await employmentOf('employee@mindspace.test');
    ids.amina = await employmentOf('manager@mindspace.test');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('who sees whom', () => {
    it('limits country HR to their own companies', async () => {
      const res = await http().get('/api/employees?pageSize=200').set(as['hr.kenya']).expect(200);
      expect(res.body.total).toBeGreaterThan(30);
      expect(new Set(res.body.items.map((i: { entity: { code: string } }) => i.entity.code))).toEqual(new Set(['KE01', 'KE02']));
      await http().get(`/api/employees/${ids.kevin}`).set(as['hr.france']).expect(404);
      await http().get(`/api/employees?entityId=${ids.KE01}`).set(as['hr.france']).expect(404);
    });

    it('finds people by full name, number and local script', async () => {
      const byName = await http().get('/api/employees?q=Kevin%20Otieno').set(as['hr.kenya']).expect(200);
      expect(byName.body.items.map((i: { id: string }) => i.id)).toContain(ids.kevin);
      const cn = await prisma.person.findFirstOrThrow({ where: { localName: { not: null }, personNumber: { startsWith: 'P-CN' } } });
      const byLocal = await http().get(`/api/employees?q=${encodeURIComponent(cn.localName!)}`).set(as.admin).expect(200);
      expect(byLocal.body.total).toBeGreaterThan(0);
    });

    it('shows a manager their team with work details only', async () => {
      const team = await http().get('/api/employees/team').set(as.manager).expect(200);
      expect(team.body.map((t: { id: string }) => t.id)).toContain(ids.kevin);
      const profile = await http().get(`/api/employees/${ids.kevin}`).set(as.manager).expect(200);
      expect(profile.body.relation).toBe('MANAGER');
      expect(profile.body.personal).toBeNull();
      expect(profile.body.job.manager.id).toBe(ids.amina);
      await http().get(`/api/employees/${ids.kevin}/pay`).set(as.manager).expect(404);
      await http().get(`/api/employees/${ids.kevin}/documents`).set(as.manager).expect(404);
      // Someone outside the team
      const other = await prisma.employment.findFirstOrThrow({ where: { legalEntityId: ids.UG01 } });
      await http().get(`/api/employees/${other.id}`).set(as.manager).expect(404);
    });

    it('lets employees see their own record but not the directory', async () => {
      await http().get('/api/employees').set(as.employee).expect(403);
      const mine = await http().get('/api/employees/mine').set(as.employee).expect(200);
      expect(mine.body.map((m: { id: string }) => m.id)).toEqual([ids.kevin]);
      const me = await http().get(`/api/employees/${ids.kevin}`).set(as.employee).expect(200);
      expect(me.body.relation).toBe('SELF');
      expect(me.body.personal.contacts.length).toBeGreaterThan(0);
      await http().get(`/api/employees/${ids.amina}`).set(as.employee).expect(404);
    });

    it('reports headcount within scope', async () => {
      const res = await http().get('/api/employees/headcount').set(as['hr.kenya']).expect(200);
      expect(res.body.companies.map((c: { code: string }) => c.code).sort()).toEqual(['KE01', 'KE02']);
      const all = await http().get('/api/employees/headcount').set(as.admin).expect(200);
      expect(all.body.countries).toHaveLength(15);
      const active = await prisma.employment.count({ where: { status: 'ACTIVE' } });
      expect(all.body.total).toBe(active);
    });
  });

  describe('sensitive data', () => {
    it('masks identity and bank numbers and audits each reveal', async () => {
      const pay = await http().get(`/api/employees/${ids.kevin}/pay`).set(as['hr.kenya']).expect(200);
      expect(pay.body.compensation[0].currency).toBe('KES');
      const nid = pay.body.identifiers.find((i: { kind: string }) => i.kind === 'NATIONAL_ID' || i.kind === 'PASSPORT');
      expect(nid.value).toMatch(/^•••• /);
      expect(JSON.stringify(pay.body)).not.toContain('SPECIMEN');
      const revealed = await http().post(`/api/employees/${ids.kevin}/identifiers/${nid.id}/reveal`).set(as['hr.kenya']).expect(200);
      expect(revealed.body.value).toMatch(/^SPECIMEN-/);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'people.identifier.revealed', targetId: ids.kevin } });
      expect(audit).not.toBeNull();
      // Stored encrypted
      const row = await prisma.personIdentifier.findUniqueOrThrow({ where: { id: nid.id } });
      expect(row.valueEncrypted).not.toContain('SPECIMEN');
    });

    it('keeps pay from HR officers without sensitive access', async () => {
      const india = await prisma.employment.findFirstOrThrow({ where: { legalEntityId: ids.IN01 } });
      const profile = await http().get(`/api/employees/${india.id}`).set(as['hr.india']).expect(200);
      expect(profile.body.can.viewPay).toBe(false);
      await http().get(`/api/employees/${india.id}/pay`).set(as['hr.india']).expect(404);
    });

    it('lets employees see and reveal their own numbers', async () => {
      const pay = await http().get(`/api/employees/${ids.kevin}/pay`).set(as.employee).expect(200);
      const bank = pay.body.bankAccounts[0];
      const res = await http().post(`/api/employees/${ids.kevin}/bank-accounts/${bank.id}/reveal`).set(as.employee).expect(200);
      expect(res.body.value).toMatch(/^TEST\d{10}$/);
    });
  });

  describe('self-service', () => {
    it('lets employees change contact details but not their name', async () => {
      const res = await http().patch(`/api/employees/${ids.kevin}/personal`).set(as.employee).send({ mobilePhone: '+254 700 000 001', dependants: 2 }).expect(200);
      expect(res.body.personal.mobilePhone).toBe('+254 700 000 001');
      await http().patch(`/api/employees/${ids.kevin}/personal`).set(as.employee).send({ firstName: 'Kev' }).expect(403);
      await http().patch(`/api/employees/${ids.amina}/personal`).set(as.employee).send({ mobilePhone: '+254 700 000 002' }).expect(404);
    });

    it('replaces next of kin', async () => {
      const res = await http()
        .put(`/api/employees/${ids.kevin}/contacts`)
        .set(as.employee)
        .send({ contacts: [{ name: 'Mary Otieno', relationship: 'Mother', phone: '+254 711 000 000', isBeneficiary: true }] })
        .expect(200);
      expect(res.body.personal.contacts).toHaveLength(1);
      expect(res.body.personal.contacts[0].isEmergencyContact).toBe(true);
    });

    it('sends bank changes through an HR approval by someone else', async () => {
      const req = await http().post(`/api/employees/${ids.kevin}/bank-change`).set(as.employee).send({ bankName: 'Test Bank Two', accountName: 'Kevin Otieno', accountNumber: 'TEST 9999 8888 77' }).expect(201);
      expect(req.body.status).toBe('PENDING');
      expect(req.body.summary).toContain('8877');
      await http().post(`/api/employees/${ids.kevin}/bank-change`).set(as.employee).send({ bankName: 'Again', accountName: 'Kevin Otieno', accountNumber: 'TEST11112222' }).expect(409);
      await http().post(`/api/change-requests/${req.body.id}/approve`).set(as.employee).expect(403);
      // HR officers without sensitive access cannot see it
      await http().get(`/api/change-requests/${req.body.id}`).set(as['hr.india']).expect(404);
      const queue = await http().get('/api/change-requests').set(as['hr.kenya']).expect(200);
      expect(queue.body.map((r: { id: string }) => r.id)).toContain(req.body.id);
      const details = await http().get(`/api/change-requests/${req.body.id}`).set(as['hr.kenya']).expect(200);
      expect(details.body.requested.accountNumber).toBe('TEST99998888' + '77');
      await http().post(`/api/change-requests/${req.body.id}/approve`).set(as['hr.kenya']).send({ note: 'Checked with the bank letter' }).expect(200);
      await http().post(`/api/change-requests/${req.body.id}/reject`).set(as['hr.kenya']).expect(409);
      const pay = await http().get(`/api/employees/${ids.kevin}/pay`).set(as.employee).expect(200);
      const current = pay.body.bankAccounts.filter((b: { effectiveTo: string | null }) => !b.effectiveTo);
      expect(current).toHaveLength(1);
      expect(current[0].accountNumber).toBe('•••• 8877');
      expect(pay.body.bankAccounts.length).toBe(2);
    });

    it('stops HR approving changes to their own record', async () => {
      const own = await employmentOf('hr.kenya@mindspace.test');
      const req = await http().post(`/api/employees/${own}/bank-change`).set(as['hr.kenya']).send({ bankName: 'Mine', accountName: 'Wanjiru Kamau', accountNumber: 'TEST55556666' }).expect(201);
      await http().post(`/api/change-requests/${req.body.id}/approve`).set(as['hr.kenya']).expect(403);
      await http().post(`/api/change-requests/${req.body.id}/cancel`).set(as['hr.kenya']).expect(200);
    });
  });

  describe('HR changes', () => {
    it('hires into a company in scope with the next employee number', async () => {
      const dept = await prisma.department.findFirstOrThrow({ where: { legalEntityId: ids.KE01, code: 'ENG' } });
      const before = await prisma.employment.count({ where: { employeeNumber: { startsWith: 'MSA-KE-' } } });
      const res = await http()
        .post('/api/employees')
        .set(as['hr.kenya'])
        .send({ legalEntityId: ids.KE01, firstName: 'Test', lastName: 'Hire', hireDate: '2026-10-05', jobTitle: 'Software Engineer', gradeCode: 'G2', departmentId: dept.id, managerId: ids.amina, baseAmount: '150000.00' })
        .expect(201);
      expect(res.body.employeeNumber).toBe(`MSA-KE-${String(before + 1).padStart(6, '0')}`);
      expect(res.body.job.department.id).toBe(dept.id);
      expect(res.body.job.costCentre).not.toBeNull();
      ids.hire = res.body.id;
      await http().post('/api/employees').set(as['hr.kenya']).send({ legalEntityId: ids.UG01, firstName: 'No', lastName: 'Access', hireDate: '2026-10-05', jobTitle: 'X' }).expect(404);
      // Departments must belong to the company
      const ugDept = await prisma.department.findFirstOrThrow({ where: { legalEntityId: ids.UG01 } });
      await http().post('/api/employees').set(as['hr.kenya']).send({ legalEntityId: ids.KE01, firstName: 'Bad', lastName: 'Dept', hireDate: '2026-10-05', jobTitle: 'X', departmentId: ugDept.id }).expect(400);
    });

    it('rejects pay with more decimals than the currency has', async () => {
      await http().post('/api/employees').set(as.admin).send({ legalEntityId: ids.UG01, firstName: 'A', lastName: 'B', hireDate: '2026-10-05', jobTitle: 'X', baseAmount: '1000.50' }).expect(400);
      await http().post('/api/employees').set(as.admin).send({ legalEntityId: ids.KE01, firstName: 'A', lastName: 'B', hireDate: '2026-10-05', jobTitle: 'X', baseAmount: '1e5' }).expect(400);
    });

    it('keeps job history effective-dated', async () => {
      await http().post(`/api/employees/${ids.hire}/assignments`).set(as['hr.kenya']).send({ effectiveFrom: '2026-10-01', reason: 'CHANGE' }).expect(400);
      const res = await http().post(`/api/employees/${ids.hire}/assignments`).set(as['hr.kenya']).send({ effectiveFrom: '2027-01-01', reason: 'PROMOTION', jobTitle: 'Senior Software Engineer', gradeCode: 'G3' }).expect(201);
      expect(res.body.assignments).toHaveLength(2);
      const [next, first] = res.body.assignments;
      expect(next.grade.code).toBe('G3');
      expect(next.manager.id).toBe(ids.amina);
      expect(first.effectiveTo.slice(0, 10)).toBe('2027-01-01');
      // Today the old record is still in force
      const profile = await http().get(`/api/employees/${ids.hire}`).set(as['hr.kenya']).expect(200);
      expect(profile.body.job.jobTitle).toBe('Software Engineer');
    });

    it('refuses a manager who would create a loop', async () => {
      await http().post(`/api/employees/${ids.amina}/assignments`).set(as['hr.kenya']).send({ effectiveFrom: '2026-12-01', reason: 'CHANGE', managerId: ids.kevin }).expect(400);
      await http().post(`/api/employees/${ids.kevin}/assignments`).set(as['hr.kenya']).send({ effectiveFrom: '2026-12-01', reason: 'CHANGE', managerId: ids.kevin }).expect(400);
    });

    it('changes pay only with sensitive access, never your own', async () => {
      await http().post(`/api/employees/${ids.hire}/compensation`).set(as['hr.kenya']).send({ effectiveFrom: '2027-01-01', baseAmount: '180000.00', reason: 'PROMOTION' }).expect(201);
      const india = await prisma.employment.findFirstOrThrow({ where: { legalEntityId: ids.IN01, status: 'ACTIVE' } });
      await http().post(`/api/employees/${india.id}/compensation`).set(as['hr.india']).send({ effectiveFrom: '2027-01-01', baseAmount: '1.00', reason: 'CHANGE' }).expect(403);
      const own = await employmentOf('hr.kenya@mindspace.test');
      await http().post(`/api/employees/${own}/compensation`).set(as['hr.kenya']).send({ effectiveFrom: '2027-01-01', baseAmount: '999999.00', reason: 'CHANGE' }).expect(403);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'people.pay.changed', targetId: ids.hire } });
      expect(audit?.detail).toMatchObject({ previous: '150000', next: '180000.00' });
    });

    it('ends employment and refuses to end it twice', async () => {
      const res = await http().post(`/api/employees/${ids.hire}/terminate`).set(as['hr.kenya']).send({ endDate: '2026-10-06', exitReason: 'Resignation - relocation' }).expect(200);
      expect(res.body.endDate.slice(0, 10)).toBe('2026-10-06');
      await prisma.employment.update({ where: { id: ids.hire }, data: { status: 'TERMINATED' } });
      await http().post(`/api/employees/${ids.hire}/terminate`).set(as['hr.kenya']).send({ endDate: '2026-10-06', exitReason: 'Again' }).expect(409);
      await http().post(`/api/employees/${ids.kevin}/terminate`).set(as.employee).send({ endDate: '2026-10-06', exitReason: 'Bye' }).expect(403);
    });
  });

  describe('documents and photos', () => {
    it('handles uploads, HR-only files and verification', async () => {
      const up = await http().post(`/api/employees/${ids.kevin}/documents`).set(as.employee).field('type', 'Professional certification').attach('file', PDF, 'cert.pdf').expect(201);
      expect(up.body.status).toBe('PENDING');
      await http().post(`/api/employees/${ids.kevin}/documents`).set(as.employee).field('type', 'Other').attach('file', Buffer.from('MZ not a pdf'), 'x.pdf').expect(400);
      await http().post(`/api/employees/${ids.kevin}/documents`).set(as.employee).field('type', 'Other').field('hrOnly', 'true').attach('file', PDF, 'x.pdf').expect(403);
      const secret = await http().post(`/api/employees/${ids.kevin}/documents`).set(as['hr.kenya']).field('type', 'Background check report').field('hrOnly', 'true').attach('file', PDF, 'bg.pdf').expect(201);

      const mine = await http().get(`/api/employees/${ids.kevin}/documents`).set(as.employee).expect(200);
      expect(mine.body.map((d: { id: string }) => d.id)).toContain(up.body.id);
      expect(mine.body.map((d: { id: string }) => d.id)).not.toContain(secret.body.id);
      expect(mine.body.some((d: { hrOnly: boolean }) => d.hrOnly)).toBe(false);
      await http().get(`/api/documents/${secret.body.id}/file`).set(as.employee).expect(404);

      await http().patch(`/api/documents/${up.body.id}`).set(as.employee).send({ status: 'VERIFIED' }).expect(403);
      const ok = await http().patch(`/api/documents/${up.body.id}`).set(as['hr.kenya']).send({ status: 'VERIFIED' }).expect(200);
      expect(ok.body.verifiedAt).not.toBeNull();
      const file = await http().get(`/api/documents/${up.body.id}/file`).set(as.employee).expect(200);
      expect(file.headers['content-type']).toContain('application/pdf');
      await http().get(`/api/documents/${up.body.id}/file`).set(as['hr.france']).expect(404);
    });

    it('draws an avatar until a photo is uploaded', async () => {
      const drawn = await http().get(`/api/employees/${ids.kevin}/photo`).set(as.manager).expect(200);
      expect(drawn.headers['content-type']).toContain('image/svg+xml');
      expect(drawn.headers['content-security-policy']).toContain('sandbox');
      await http().put(`/api/employees/${ids.kevin}/photo`).set(as.manager).attach('file', PNG, 'me.png').expect(403);
      await http().put(`/api/employees/${ids.kevin}/photo`).set(as.employee).attach('file', PDF, 'me.pdf').expect(400);
      await http().put(`/api/employees/${ids.kevin}/photo`).set(as.employee).attach('file', PNG, 'me.png').expect(200);
      const photo = await http().get(`/api/employees/${ids.kevin}/photo`).set(as.employee).expect(200);
      expect(photo.headers['content-type']).toContain('image/png');
    });
  });
});
