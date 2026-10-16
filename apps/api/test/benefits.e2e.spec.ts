import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };
type Item = { entity: string; id: string; title: string; employee: { id: string }; stageLabel: string };
type Plan = { id: string; name: string; kind: string; eligible: boolean; active: boolean };

const thisMonth = () => new Date().toISOString().slice(0, 7);

jest.setTimeout(60_000);

describe('meal, gym and gift-voucher benefits', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const inbox = async (who: string) => (await http().get('/api/approvals').set(as[who]).expect(200)).body as Item[];
  const decide = (who: string, kind: string, id: string, approve = true) => http().post(`/api/approvals/${kind}/${id}/${approve ? 'approve' : 'decline'}`).set(as[who]).send({});

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['admin', 'hr.kenya', 'hr.france', 'payroll.kenya', 'finance', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
    ids.kevin = (await prisma.employment.findFirstOrThrow({ where: { user: { email: 'employee@mindspace.test' } } })).id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("shows the employee their company's options and what they already have", async () => {
    const plans = (await http().get('/api/benefits/plans').set(as.employee).expect(200)).body;
    expect(plans.entity.currency).toBe('KES');
    expect(plans.canEdit).toBe(false);
    expect(plans.plans.map((p: Plan) => p.name)).toEqual(expect.arrayContaining(['Canteen wallet', 'Standard', 'Premium']));
    await http().get(`/api/benefits/plans?entityId=${ids.FR01}`).set(as.employee).expect(404);
    const mine = (await http().get('/api/benefits/mine').set(as.employee).expect(200)).body;
    expect(mine.enrolments.map((e: { plan: { name: string }; status: string }) => `${e.plan.name}:${e.status}`)).toContain('Standard:APPROVED');
    expect(mine.vouchersReceived).toHaveLength(0);
  });

  it('takes a meal enrolment through HR and then Payroll', async () => {
    const plans = (await http().get('/api/benefits/plans').set(as.employee).expect(200)).body.plans as Plan[];
    const meal = plans.find((p) => p.kind === 'MEAL' && p.eligible)!;
    await http().post('/api/benefits/enrolments').set(as.employee).send({ planId: meal.id, startMonth: '2020-01' }).expect(400);
    const created = await http().post('/api/benefits/enrolments').set(as.employee).send({ planId: meal.id, startMonth: thisMonth(), dietaryNeeds: 'Vegetarian' }).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', stageLabel: 'HR' });
    await http().post('/api/benefits/enrolments').set(as.employee).send({ planId: meal.id, startMonth: thisMonth() }).expect(409);
    await decide('payroll.kenya', 'enrolment', created.body.id).expect(403);
    await decide('hr.france', 'enrolment', created.body.id).expect(404);
    expect((await inbox('hr.kenya')).map((i) => i.id)).toContain(created.body.id);
    expect((await decide('hr.kenya', 'enrolment', created.body.id).expect(201)).body.stageLabel).toBe('Payroll');
    expect((await decide('payroll.kenya', 'enrolment', created.body.id).expect(201)).body.status).toBe('APPROVED');
    expect(mail.outbox.some((m) => m.to === 'employee@mindspace.test' && m.subject === 'Your meal voucher was approved')).toBe(true);
  });

  it('counts the gym share against what an advance or loan can take', async () => {
    const opts = (await http().get('/api/loans/options').set(as.employee).expect(200)).body;
    expect(Number(opts.commitments)).toBeGreaterThanOrEqual(2000);
  });

  it('lets a manager nominate their own report, then HR approves it', async () => {
    await http().post('/api/benefits/vouchers').set(as.employee).send({ employmentId: ids.kevin, occasion: 'BIRTHDAY', value: 1000 }).expect(403);
    const nominees = (await http().get('/api/benefits/nominees?q=Kevin').set(as.manager).expect(200)).body;
    expect(nominees.map((n: { id: string }) => n.id)).toContain(ids.kevin);
    const v = await http().post('/api/benefits/vouchers').set(as.manager).send({ employmentId: ids.kevin, occasion: 'BIRTHDAY', value: 3000, reason: 'Team birthday' }).expect(201);
    expect(v.body).toMatchObject({ status: 'PENDING', stageLabel: 'HR', currency: 'KES' });
    await decide('manager', 'voucher', v.body.id).expect(403);
    const done = await decide('hr.kenya', 'voucher', v.body.id).expect(201);
    expect(done.body).toMatchObject({ status: 'APPROVED' });
    expect(done.body.taxMonthLabel).toBeTruthy();
    expect(mail.outbox.some((m) => m.to === 'employee@mindspace.test' && m.subject === 'You have a gift voucher')).toBe(true);
    expect((await http().get('/api/benefits/mine').set(as.employee).expect(200)).body.vouchersReceived.length).toBeGreaterThan(0);
  });

  it('keeps managers to their own team and HR to their countries', async () => {
    const outsider = await prisma.employment.findFirstOrThrow({ where: { legalEntityId: ids.FR01, status: 'ACTIVE' } });
    await http().post('/api/benefits/vouchers').set(as.manager).send({ employmentId: outsider.id, occasion: 'BIRTHDAY', value: 100 }).expect(404);
    await http().post('/api/benefits/vouchers').set(as['hr.kenya']).send({ employmentId: outsider.id, occasion: 'BIRTHDAY', value: 100 }).expect(404);
    await http().get(`/api/benefits/overview?entityId=${ids.FR01}`).set(as['hr.kenya']).expect(404);
    await http().get('/api/benefits/overview').set(as.employee).expect(403);
  });

  it('lets HR change an option in their country only', async () => {
    const plans = (await http().get(`/api/benefits/plans?entityId=${ids.KE01}`).set(as['hr.kenya']).expect(200)).body;
    expect(plans.canEdit).toBe(true);
    const premium = plans.plans.find((p: Plan) => p.name === 'Premium');
    await http().patch(`/api/benefits/plans/${premium.id}`).set(as['hr.france']).send({ companyShare: 1 }).expect(404);
    await http().patch(`/api/benefits/plans/${premium.id}`).set(as['payroll.kenya']).send({ companyShare: 1 }).expect(403);
    expect((await http().patch(`/api/benefits/plans/${premium.id}`).set(as['hr.kenya']).send({ companyShare: 4500 }).expect(200)).body.companyShare).toBe('4500.00');
    await http().post('/api/benefits/plans').set(as['hr.france']).send({ entityId: ids.FR01, kind: 'GYM', name: 'Salle partenaire', companyShare: 30, employeeShare: 10 }).expect(201);
    const overview = (await http().get(`/api/benefits/overview?entityId=${ids.KE01}`).set(as.finance).expect(200)).body;
    expect(Number(overview.monthlyCompanyCost)).toBeGreaterThan(0);
  });

  it('ends a running membership at the end of the open payroll month', async () => {
    const mine = (await http().get('/api/benefits/mine').set(as.employee).expect(200)).body;
    const gym = mine.enrolments.find((e: { kind: string; status: string }) => e.kind === 'GYM' && e.status === 'APPROVED');
    const ended = await http().post(`/api/benefits/enrolments/${gym.id}/end`).set(as.employee).expect(201);
    expect(ended.body).toMatchObject({ status: 'CLOSED' });
    expect(ended.body.endLabel).toBeTruthy();
    await http().post(`/api/benefits/enrolments/${gym.id}/end`).set(as.employee).expect(409);
  });

  it('audits enrolments, nominations and decisions', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ action: { startsWith: 'benefit.' } }, { action: { startsWith: 'voucher.' } }] }, select: { action: true } })).map((a) => a.action);
    for (const a of ['benefit.enrolment.requested', 'benefit.enrolment.approved', 'benefit.enrolment.ended', 'benefit.plan.updated', 'benefit.plan.created', 'voucher.nominated', 'voucher.approved']) expect(actions).toContain(a);
  });
});
