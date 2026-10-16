import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };
type Item = { id: string; entity: string; title: string; employee: { id: string }; stageLabel: string };

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const today = () => new Date().toISOString().slice(0, 10);

jest.setTimeout(60_000);

describe('advances, loans and IOUs', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const inbox = async (who: string) => (await http().get('/api/approvals').set(as[who]).expect(200)).body as Item[];
  const approve = (who: string, id: string) => http().post(`/api/approvals/loan/${id}/approve`).set(as[who]).send({});

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['admin', 'hr.kenya', 'hr.france', 'payroll.kenya', 'finance', 'ceo', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
    ids.kevin = (await prisma.employment.findFirstOrThrow({ where: { user: { email: 'employee@mindspace.test' } } })).id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('shows limits from the draft rules, marked unverified', async () => {
    const res = await http().get('/api/loans/options').set(as.employee).expect(200);
    expect(res.body).toMatchObject({ rulePack: { status: 'UNVERIFIED' }, payrollPack: { verified: false }, currency: 'KES', hasPayroll: true });
    expect(Number(res.body.maxAdvance)).toBeGreaterThan(0);
    const mine = await http().get('/api/loans').set(as.employee).expect(200);
    expect(mine.body.loans.map((l: { kind: string; status: string }) => `${l.kind}:${l.status}`)).toEqual(expect.arrayContaining(['LOAN:APPROVED', 'ADVANCE:PENDING']));
    expect(Number(mine.body.outstanding)).toBeGreaterThan(0);
  });

  it('takes an advance through manager, Payroll and Finance, each a different person', async () => {
    const pending = (await inbox('manager')).find((i) => i.employee.id === ids.kevin && i.title === 'Salary advance')!;
    expect(pending.stageLabel).toBe('Manager');
    await approve('employee', pending.id).expect(404);
    await approve('finance', pending.id).expect(403);
    expect((await approve('manager', pending.id).expect(201)).body.status).toBe('PENDING');
    expect((await inbox('payroll.kenya')).map((i) => i.id)).toContain(pending.id);
    expect((await approve('payroll.kenya', pending.id).expect(201)).body.stageLabel).toBe('Finance');
    await approve('payroll.kenya', pending.id).expect(403);
    const done = await approve('finance', pending.id).expect(201);
    expect(done.body).toMatchObject({ status: 'APPROVED', stage: null });
    expect(done.body.firstMonthLabel).toBeTruthy();
    expect(mail.outbox.some((m) => m.to === 'employee@mindspace.test' && m.subject === 'Your salary advance was approved')).toBe(true);
  });

  it('allows one advance in any 3 months', async () => {
    const res = await http().post('/api/loans').set(as.employee).send({ kind: 'ADVANCE', amount: 100, purpose: 'Another one' }).expect(400);
    expect(res.body.message).toMatch(/One advance is allowed in any 3 months/);
  });

  it('sends housing loans above 3 times gross pay to the country head', async () => {
    const opts = (await http().get('/api/loans/options').set(as.employee).expect(200)).body;
    const amount = Math.floor(Number(opts.gross) * 5);
    const q = await http().get(`/api/loans/quote?kind=LOAN&product=HOUSING&months=36&amount=${amount}`).set(as.employee).expect(200);
    expect(q.body.stages).toContain('COUNTRY_HEAD');
    const personal = await http().get(`/api/loans/quote?kind=LOAN&product=PERSONAL&months=36&amount=${amount}`).set(as.employee).expect(200);
    expect(personal.body.problems.join(' ')).toMatch(/at most 3 times monthly gross pay/);
  });

  it('issues an IOU and settles it with receipts', async () => {
    const created = await http().post('/api/loans').set(as.employee).send({ kind: 'IOU', amount: 5000, purpose: 'Workshop supplies', neededOn: today(), costCentre: 'CC-101' }).expect(201);
    expect(created.body.stages).toEqual(['Manager', 'Finance']);
    await approve('manager', created.body.id).expect(201);
    expect((await approve('finance', created.body.id).expect(201)).body).toMatchObject({ status: 'APPROVED', canSettle: false });
    const mine = await http().get('/api/loans').set(as.employee).expect(200);
    expect(mine.body.loans.find((l: { id: string }) => l.id === created.body.id).canSettle).toBe(true);

    await http().post(`/api/loans/${created.body.id}/settle`).set(as.employee).field('spent', '4000').field('cashReturned', '0').expect(400);
    const sent = await http().post(`/api/loans/${created.body.id}/settle`).set(as.employee).field('spent', '4000').field('cashReturned', '0').attach('file', PDF, 'receipts.pdf').expect(201);
    expect(sent.body.stageLabel).toBe('Finance (settlement)');
    await http().get(`/api/loans/${created.body.id}/receipt`).set(as.finance).expect(200);
    await http().get(`/api/loans/${created.body.id}/receipt`).set(as['hr.france']).expect(404);
    const settled = await approve('finance', created.body.id).expect(201);
    expect(settled.body).toMatchObject({ status: 'APPROVED', outstanding: '1000.00' });
  });

  it('keeps loan details to the employee, Payroll and Finance', async () => {
    await http().get(`/api/loans?employmentId=${ids.kevin}`).set(as['payroll.kenya']).expect(200);
    await http().get(`/api/loans?employmentId=${ids.kevin}`).set(as.manager).expect(404);
    await http().get(`/api/loans?employmentId=${ids.kevin}`).set(as['hr.france']).expect(404);
    await http().get('/api/loans/book').set(as.employee).expect(403);
    const book = await http().get('/api/loans/book').set(as['payroll.kenya']).expect(200);
    expect(new Set(book.body.rows.map((r: { employee: { entity: { code: string } } }) => r.employee.entity.code))).toEqual(new Set(['KE01', 'KE02']));
    expect(book.body.totals.KES).toBeTruthy();
  });

  it('lets Finance record a cash repayment, but not Payroll', async () => {
    const loan = await prisma.loan.findFirstOrThrow({ where: { employmentId: ids.kevin, kind: 'LOAN', status: 'APPROVED' } });
    await http().post(`/api/loans/${loan.id}/repayments`).set(as['payroll.kenya']).send({ amount: 100 }).expect(403);
    const res = await http().post(`/api/loans/${loan.id}/repayments`).set(as.finance).send({ amount: 100, note: 'Bank transfer' }).expect(201);
    expect(res.body.repayments.some((r: { source: string }) => r.source === 'CASH')).toBe(true);
    await http().post(`/api/loans/${loan.id}/repayments`).set(as.finance).send({ amount: 999_999_999 }).expect(400);
  });

  it('refuses advances where there are no payroll rules to recover them', async () => {
    const fr = await prisma.employment.findFirstOrThrow({ where: { legalEntityId: ids.FR01, status: 'ACTIVE', user: null } });
    await prisma.employment.update({ where: { id: fr.id }, data: { user: { connect: { email: 'hr.france@mindspace.test' } } } });
    const opts = await http().get('/api/loans/options').set(as['hr.france']).expect(200);
    expect(opts.body).toMatchObject({ hasPayroll: false, payrollPack: null, maxAdvance: null });
    const res = await http().post('/api/loans').set(as['hr.france']).send({ kind: 'ADVANCE', amount: 100, purpose: 'Test' }).expect(400);
    expect(res.body.message).toMatch(/Payroll rules for .* are not in the portal yet/);
    await http().post('/api/loans').set(as['hr.france']).send({ kind: 'IOU', amount: 100, purpose: 'Taxi to client', neededOn: today() }).expect(201);
  });

  it('audits requests and decisions', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { action: { startsWith: 'loan.' } }, select: { action: true } })).map((a) => a.action);
    for (const a of ['loan.requested', 'loan.approved', 'loan.iou.settlement.sent', 'loan.iou.settlement.confirmed', 'loan.iou.receipts.viewed', 'loan.repaid.cash']) expect(actions).toContain(a);
  });
});
