import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { openPayMonth } from '../src/approvals/pay-month';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };
type Company = { code: string; payrollOn: boolean; rules: { verified: boolean } | null; runs: Array<{ id: string; month: number; status: string; rulesVerified: boolean }> };

jest.setTimeout(120_000);

describe('month-end payroll and payslips', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const october = (entityId: string) => ({ entityId, year: 2026, month: 10 });
  let run: string;

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['admin', 'hr.france', 'payroll.kenya', 'approver.kenya', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('starts with a finalised September on unverified draft rules, visible only within scope', async () => {
    const body = (await http().get('/api/payroll/runs?year=2026').set(as['payroll.kenya']).expect(200)).body;
    expect(body.companies.map((c: Company) => c.code)).toEqual(['KE01', 'KE02']);
    const ke01 = body.companies[0] as Company;
    expect(ke01.rules).toMatchObject({ verified: false });
    expect(ke01.runs).toEqual([expect.objectContaining({ month: 9, status: 'FINALIZED', rulesVerified: false })]);
    await http().get('/api/payroll/runs').set(as.employee).expect(403);
    await http().get(`/api/payroll/runs/${ke01.runs[0].id}`).set(as['hr.france']).expect(403);
  });

  it('shows employees their own final payslips only', async () => {
    const mine = (await http().get('/api/payslips/me').set(as.employee).expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ period: expect.stringMatching(/2026/), month: 9, rulesVerified: false, currency: 'KES' })]);
    const slip = (await http().get(`/api/payslips/${mine[0].id}`).set(as.employee).expect(200)).body;
    expect(slip.employee.name).toBe('Kevin Otieno');
    expect(slip.lines.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(['BASIC', 'PAYE']));
    await http().get(`/api/payslips/${mine[0].id}`).set(as.manager).expect(404);
    const before = await prisma.auditLog.count({ where: { action: 'payslip.viewed' } });
    await http().get(`/api/payslips/${mine[0].id}`).set(as['payroll.kenya']).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'payslip.viewed' } })).toBe(before + 1);
  });

  it('refuses companies that are out of scope, switched off or have no rules', async () => {
    await http().post('/api/payroll/runs').set(as['payroll.kenya']).send(october(ids.FR01)).expect(404);
    await http().post('/api/payroll/runs').set(as.admin).send(october(ids.NL02)).expect(403);
    await http().post('/api/payroll/runs').set(as.admin).send(october(ids.FR01)).expect(422);
    await http().post('/api/payroll/runs').set(as['payroll.kenya']).send({ entityId: ids.KE01, year: 2026, month: 9 }).expect(409);
  });

  it('goes from draft to final with maker and checker, and records loan repayments', async () => {
    const created = (await http().post('/api/payroll/runs').set(as['payroll.kenya']).send(october(ids.KE01)).expect(201)).body;
    run = created.id;
    expect(created).toMatchObject({ status: 'DRAFT', rulesVerified: false, can: { prepare: true, approve: false } });
    expect(created.headcount).toBeGreaterThan(30);
    await http().post('/api/payroll/runs').set(as['payroll.kenya']).send(october(ids.KE01)).expect(409);
    await http().post(`/api/payroll/runs/${run}/approve`).set(as['payroll.kenya']).expect(403);
    await http().post(`/api/payroll/runs/${run}/approve`).set(as['approver.kenya']).expect(409);

    await http().post(`/api/payroll/runs/${run}/submit`).set(as['payroll.kenya']).expect(201);
    expect(mail.outbox.some((m) => m.to === 'approver.kenya@mindspace.test' && /^Payroll to approve/.test(m.subject) && /unverified/.test(m.text))).toBe(true);
    await http().post(`/api/payroll/runs/${run}/recalculate`).set(as['payroll.kenya']).expect(409);
    const back = (await http().post(`/api/payroll/runs/${run}/send-back`).set(as['approver.kenya']).send({ note: 'Please check the new joiners' }).expect(201)).body;
    expect(back).toMatchObject({ status: 'DRAFT', returnNote: 'Please check the new joiners' });
    expect(mail.outbox.some((m) => m.to === 'payroll.kenya@mindspace.test' && /^Payroll sent back/.test(m.subject))).toBe(true);

    await http().post(`/api/payroll/runs/${run}/submit`).set(as['payroll.kenya']).expect(201);
    expect((await http().post(`/api/payroll/runs/${run}/approve`).set(as['approver.kenya']).expect(201)).body.status).toBe('APPROVED');
    expect(await openPayMonth(prisma as unknown as PrismaService, ids.KE01)).toBeGreaterThanOrEqual(202611);

    const final = (await http().post(`/api/payroll/runs/${run}/finalize`).set(as['approver.kenya']).expect(201)).body;
    expect(final.status).toBe('FINALIZED');
    expect(final.loanRepayments).toBeGreaterThan(0);
    const repayments = await prisma.loanRepayment.findMany({ where: { year: 2026, month: 10, source: 'PAYROLL' } });
    expect(repayments).toHaveLength(final.loanRepayments);
    expect(repayments.every((r) => r.payslipId)).toBe(true);
    const notice = mail.outbox.find((m) => m.to === 'employee@mindspace.test' && /payslip for .*2026 is ready/.test(m.subject));
    expect(notice?.text).not.toMatch(/KES|\d{3},?\d{3}/);
    expect((await http().get('/api/payslips/me').set(as.employee).expect(200)).body.map((s: { month: number }) => s.month)).toEqual([10, 9]);
    await http().delete(`/api/payroll/runs/${run}`).set(as['payroll.kenya']).expect(409);
  });

  it('exports the register with an unverified banner', async () => {
    const res = await http().get(`/api/payroll/runs/${run}/register`).set(as['approver.kenya']).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const [banner, head] = res.text.split('\n');
    expect(banner).toMatch(/^UNVERIFIED DRAFT RULES \(KE-/);
    expect(head).toMatch(/^Employee number,Name,Job title,Department,/);
  });

  it('never lets whoever prepared a payroll approve it', async () => {
    const approver = await prisma.user.findUniqueOrThrow({ where: { email: 'approver.kenya@mindspace.test' } });
    await prisma.roleAssignment.create({ data: { userId: approver.id, role: 'PAYROLL_OPERATOR', scopeType: 'COUNTRY', countryCode: 'KE' } });
    const created = (await http().post('/api/payroll/runs').set(as['approver.kenya']).send(october(ids.KE02)).expect(201)).body;
    await http().post(`/api/payroll/runs/${created.id}/submit`).set(as['approver.kenya']).expect(201);
    const seen = (await http().get(`/api/payroll/runs/${created.id}`).set(as['approver.kenya']).expect(200)).body;
    expect(seen.can).toMatchObject({ approve: false, preparedByYou: true });
    await http().post(`/api/payroll/runs/${created.id}/approve`).set(as['approver.kenya']).expect(403);
  });

  it('drafts every company at once, skipping those that cannot run', async () => {
    const res = (await http().post('/api/payroll/runs/all').set(as.admin).send({ year: 2026, month: 10 }).expect(201)).body;
    expect(res.created).toEqual(expect.arrayContaining(['EG01', 'NG01', 'ZA01']));
    const reasons = Object.fromEntries(res.skipped.map((s: { code: string; reason: string }) => [s.code, s.reason]));
    expect(reasons.KE01).toMatch(/already has a payroll/);
    expect(reasons.NL02).toMatch(/switched off/);
    expect(reasons.FR01).toMatch(/no payroll rules/);
  });
});
