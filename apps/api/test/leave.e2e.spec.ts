import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { addDays, weekday } from '../src/leave/calendar';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
/** Next year, so every date is in the future and has a fresh balance */
const Y = new Date().getUTCFullYear() + 1;
/** The Monday of a given ISO week-ish position in a month of next year */
const monday = (month: number, nth = 2) => {
  let d = `${Y}-${String(month).padStart(2, '0')}-01`;
  while (weekday(d) !== 1) d = addDays(d, 1);
  return addDays(d, (nth - 1) * 7);
};

jest.setTimeout(60_000);

describe('leave', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const employmentOf = async (email: string) => (await prisma.employment.findFirstOrThrow({ where: { user: { email } } })).id;
  const ask = (who: string, body: Record<string, string>) => http().post('/api/leave/requests').set(as[who]).send(body);

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['admin', 'hr.kenya', 'hr.france', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
    ids.kevin = await employmentOf('employee@mindspace.test');
    ids.amina = await employmentOf('manager@mindspace.test');
    ids.wanjiru = await employmentOf('hr.kenya@mindspace.test');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('labels the rule pack as an unverified draft', async () => {
    const res = await http().get('/api/leave/types').set(as.employee).expect(200);
    expect(res.body.rulePack).toMatchObject({ status: 'UNVERIFIED', version: 'LEAVE-2026.1-draft' });
    expect(res.body.types.map((t: { type: string }) => t.type)).toContain('MATERNITY');
    const bal = await http().get(`/api/leave/balances?year=${Y}`).set(as.employee).expect(200);
    expect(bal.body.rulePack.status).toBe('UNVERIFIED');
    expect(bal.body.balances.find((b: { type: string }) => b.type === 'ANNUAL').entitlement).toBeGreaterThanOrEqual(21);
  });

  it('seeds a request from Kevin waiting for Amina', async () => {
    const queue = await http().get('/api/leave/approvals').set(as.manager).expect(200);
    const kevins = queue.body.filter((r: { employee: { id: string } }) => r.employee.id === ids.kevin);
    expect(kevins).toHaveLength(1);
    expect(kevins[0]).toMatchObject({ status: 'PENDING_MANAGER', step: 'manager', rulesVersion: 'LEAVE-2026.1-draft' });
  });

  it('sends annual leave to the manager, who approves it', async () => {
    mail.outbox.length = 0;
    const start = monday(3);
    const res = await ask('employee', { type: 'ANNUAL', startDate: start, endDate: addDays(start, 4), reason: 'Holiday' }).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING_MANAGER', approver: { id: ids.amina }, canCancel: true });
    expect(res.body.days).toBeGreaterThan(0);
    expect(mail.outbox.some((m) => m.to === 'manager@mindspace.test' && m.subject.includes('Leave request'))).toBe(true);

    // Kevin cannot decide it; Amina can
    await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as.employee).send({}).expect(404);
    const ok = await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as.manager).send({ note: 'Enjoy' }).expect(201);
    expect(ok.body.status).toBe('APPROVED');
    expect(mail.outbox.some((m) => m.to === 'employee@mindspace.test' && m.subject === 'Your leave was approved')).toBe(true);

    // Overlapping leave is refused
    const clash = await ask('employee', { type: 'ANNUAL', startDate: addDays(start, 1), endDate: addDays(start, 1) });
    expect([clash.status, clash.body.message]).toEqual([409, expect.stringContaining('overlaps')]);
  });

  it('needs HR after the manager for study leave, and only HR for that company', async () => {
    const start = monday(4);
    const res = await ask('employee', { type: 'STUDY', startDate: start, endDate: addDays(start, 1) }).expect(201);
    const mid = await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as.manager).send({}).expect(201);
    expect(mid.body.status).toBe('PENDING_HR');
    await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as.manager).send({}).expect(403);
    await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as['hr.france']).send({}).expect(404);
    const hrQueue = await http().get('/api/leave/approvals').set(as['hr.kenya']).expect(200);
    expect(hrQueue.body.map((r: { id: string }) => r.id)).toContain(res.body.id);
    const done = await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as['hr.kenya']).send({}).expect(201);
    expect(done.body.status).toBe('APPROVED');
  });

  it('stops people deciding their own leave, even in HR', async () => {
    const start = monday(5);
    const res = await ask('hr.kenya', { type: 'ANNUAL', startDate: start, endDate: start }).expect(201);
    await http().post(`/api/leave/requests/${res.body.id}/approve`).set(as['hr.kenya']).send({}).expect(403);
  });

  it('checks dates, sick notes and allowances', async () => {
    const sat = addDays(monday(6), 5);
    await ask('employee', { type: 'ANNUAL', startDate: sat, endDate: addDays(sat, 1) }).expect(400);
    await ask('employee', { type: 'ANNUAL', startDate: `${Y}-12-30`, endDate: `${Y + 1}-01-03` }).expect(400);
    await ask('employee', { type: 'FLOATING', startDate: monday(6), endDate: addDays(monday(6), 4) }).expect(400);
    const sickStart = monday(7);
    await ask('employee', { type: 'SICK', startDate: sickStart, endDate: addDays(sickStart, 3) }).expect(400);
    const withNote = await http()
      .post('/api/leave/requests')
      .set(as.employee)
      .field('type', 'SICK')
      .field('startDate', sickStart)
      .field('endDate', addDays(sickStart, 3))
      .attach('file', PDF, 'note.pdf')
      .expect(201);
    expect(withNote.body.documentId).toBeTruthy();
    const doc = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: withNote.body.documentId } });
    expect(doc).toMatchObject({ employmentId: ids.kevin, type: 'Medical certificate (sick leave)' });
  });

  it('lets HR record leave, which is approved at once, and adjust balances', async () => {
    const start = monday(8);
    const res = await ask('hr.kenya', { type: 'ANNUAL', startDate: start, endDate: start, employmentId: ids.kevin }).expect(201);
    expect(res.body.status).toBe('APPROVED');
    await ask('hr.france', { type: 'ANNUAL', startDate: start, endDate: start, employmentId: ids.kevin }).expect(404);
    await ask('manager', { type: 'ANNUAL', startDate: start, endDate: start, employmentId: ids.kevin }).expect(403);

    await http().post('/api/leave/adjustments').set(as['hr.kenya']).send({ employmentId: ids.kevin, type: 'ANNUAL', year: Y, days: 2, reason: 'Agreed carry-over' }).expect(201);
    await http().post('/api/leave/adjustments').set(as['hr.kenya']).send({ employmentId: ids.wanjiru, type: 'ANNUAL', year: Y, days: 2, reason: 'Myself' }).expect(403);
    const bal = await http().get(`/api/leave/balances?year=${Y}&employmentId=${ids.kevin}`).set(as['hr.kenya']).expect(200);
    expect(bal.body.balances.find((b: { type: string }) => b.type === 'ANNUAL').adjustment).toBe(2);
    await http().get(`/api/leave/balances?employmentId=${ids.kevin}`).set(as['hr.france']).expect(404);
  });

  it('lets the employee cancel a request still waiting', async () => {
    const start = monday(9);
    const res = await ask('employee', { type: 'ANNUAL', startDate: start, endDate: start }).expect(201);
    const done = await http().post(`/api/leave/requests/${res.body.id}/cancel`).set(as.employee).expect(201);
    expect(done.body).toMatchObject({ status: 'CANCELLED', canCancel: false });
    await http().post(`/api/leave/requests/${res.body.id}/cancel`).set(as.employee).expect(403);
  });

  it('shows the calendar by role: colleagues without the reason', async () => {
    const month = monday(3).slice(0, 7);
    const own = await http().get(`/api/leave/calendar?month=${month}`).set(as.employee).expect(200);
    expect(own.body.scope).toBe('colleagues');
    const mine = own.body.entries.filter((e: { employmentId: string }) => e.employmentId === ids.kevin);
    expect(mine[0].type).toBe('ANNUAL');
    expect(own.body.entries.filter((e: { employmentId: string }) => e.employmentId !== ids.kevin).every((e: { type: null }) => e.type === null)).toBe(true);

    const team = await http().get(`/api/leave/calendar?month=${month}`).set(as.manager).expect(200);
    expect(team.body.scope).toBe('team');
    expect(team.body.entries.find((e: { employmentId: string }) => e.employmentId === ids.kevin).type).toBe('ANNUAL');

    const company = await http().get(`/api/leave/calendar?month=${month}&entityId=${ids.KE01}`).set(as['hr.kenya']).expect(200);
    expect(company.body).toMatchObject({ scope: 'company', entity: { code: 'KE01' } });
    await http().get(`/api/leave/calendar?month=${month}&entityId=${ids.KE01}`).set(as['hr.france']).expect(404);
  });

  it('drafts holidays only for first-build countries and lets local HR maintain them', async () => {
    const ke = await http().get(`/api/leave/holidays?countryCode=KE&year=${Y}`).set(as.employee).expect(200);
    expect(ke.body.drafted).toBe(true);
    expect(ke.body.holidays.length).toBeGreaterThan(8);
    expect(ke.body.holidays.every((h: { source: string }) => h.source === 'DRAFT')).toBe(true);

    const fr = await http().get(`/api/leave/holidays?countryCode=FR&year=${Y}`).set(as['hr.france']).expect(200);
    expect(fr.body).toMatchObject({ drafted: false, holidays: [] });
    await http().post('/api/leave/holidays').set(as['hr.kenya']).send({ countryCode: 'FR', date: `${Y}-07-14`, name: 'Fête nationale' }).expect(403);
    const added = await http().post('/api/leave/holidays').set(as['hr.france']).send({ countryCode: 'FR', date: `${Y}-07-14`, name: 'Fête nationale' }).expect(201);
    expect(added.body.source).toBe('MANUAL');
    await http().post('/api/leave/holidays').set(as['hr.france']).send({ countryCode: 'FR', date: `${Y}-07-14`, name: 'Again' }).expect(409);

    const confirmed = await http().post(`/api/leave/holidays/${ke.body.holidays[0].id}/confirm`).set(as['hr.kenya']).expect(201);
    expect(confirmed.body.source).toBe('MANUAL');
    await http().delete(`/api/leave/holidays/${added.body.id}`).set(as['hr.kenya']).expect(403);
    await http().delete(`/api/leave/holidays/${added.body.id}`).set(as['hr.france']).expect(200);
  });

  it('refuses requests when a company has leave switched off', async () => {
    await http().put(`/api/org/entities/${ids.KE01}/features/leave`).set(as.admin).send({ enabled: false }).expect(200);
    await ask('employee', { type: 'ANNUAL', startDate: monday(10, 3), endDate: monday(10, 3) }).expect(403);
    await http().put(`/api/org/entities/${ids.KE01}/features/leave`).set(as.admin).send({ enabled: true }).expect(200);
    await ask('employee', { type: 'ANNUAL', startDate: monday(10, 3), endDate: monday(10, 3) }).expect(201);
  });

  it('audits every decision', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { action: { startsWith: 'leave.' } }, select: { action: true } })).map((a) => a.action);
    for (const a of ['leave.requested', 'leave.approved', 'leave.cancelled', 'leave.adjusted', 'leave.holiday.added', 'leave.holiday.confirmed', 'leave.holiday.removed']) expect(actions).toContain(a);
  });
});
