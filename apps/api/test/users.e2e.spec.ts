import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };

describe('users, roles and segregation of duties', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  let admin: Auth, hrKenya: Auth;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  beforeAll(async () => {
    prisma = await resetDatabase();
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    admin = (await signIn(app, mail, 'admin@mindspace.test')).auth;
    hrKenya = (await signIn(app, mail, 'hr.kenya@mindspace.test')).auth;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lets country HR see only users inside their country', async () => {
    const res = await http().get('/api/users?pageSize=100').set(hrKenya).expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining(['manager@mindspace.test', 'payroll.kenya@mindspace.test', 'employee@mindspace.test']));
    expect(emails).not.toContain('admin@mindspace.test');
    expect(emails).not.toContain('hr.france@mindspace.test');
    await http().get(`/api/users/${await userId('hr.france@mindspace.test')}`).set(hrKenya).expect(404);
  });

  it('invites a user who sets a password and signs in', async () => {
    const created = await http()
      .post('/api/users')
      .set(hrKenya)
      .send({ email: 'New.Starter@Mindspace.test', displayName: 'New Starter', roles: [{ role: 'HR', scopeType: 'LEGAL_ENTITY', legalEntityId: ids.KE01 }] })
      .expect(201);
    expect(created.body).toMatchObject({ email: 'new.starter@mindspace.test', invitePending: true });
    const invite = mail.outbox.find((m) => m.to === 'new.starter@mindspace.test')!;
    const token = invite.text.match(/token=([\w-]+)/)![1];
    await http().post('/api/auth/accept-invite').send({ token, password: 'short' }).expect(400);
    await http().post('/api/auth/accept-invite').send({ token, password: 'A-much-longer-passw0rd' }).expect(200);
    await http().post('/api/auth/accept-invite').send({ token, password: 'A-much-longer-passw0rd' }).expect(400);
    const { auth } = await signIn(app, mail, 'new.starter@mindspace.test', 'mobile', 'A-much-longer-passw0rd');
    const me = await http().get('/api/me').set(auth).expect(200);
    expect(me.body.entities.map((e: { code: string }) => e.code)).toEqual(['KE01']);
  });

  it('stops country HR handing out powerful roles or roles abroad', async () => {
    const base = { email: 'x1@mindspace.test', displayName: 'X One' };
    await http().post('/api/users').set(hrKenya).send({ ...base, roles: [{ role: 'PAYROLL_OPERATOR', scopeType: 'LEGAL_ENTITY', legalEntityId: ids.KE01 }] }).expect(403);
    await http().post('/api/users').set(hrKenya).send({ ...base, roles: [{ role: 'HR', scopeType: 'LEGAL_ENTITY', legalEntityId: ids.FR01 }] }).expect(403);
    await http().post('/api/users').set(hrKenya).send({ ...base, roles: [{ role: 'HR', scopeType: 'GROUP' }] }).expect(403);
    await http().post('/api/users').set(hrKenya).send({ ...base, roles: [{ role: 'HR', scopeType: 'COUNTRY' }] }).expect(403);
  });

  it('refuses maker and checker for the same payroll', async () => {
    const operator = await userId('payroll.kenya@mindspace.test');
    const res = await http().post(`/api/users/${operator}/roles`).set(admin).send({ role: 'PAYROLL_APPROVER', scopeType: 'LEGAL_ENTITY', legalEntityId: ids.KE01 }).expect(403);
    expect(res.body.message).toMatch(/cannot be held by one person/);
    await http().post(`/api/users/${operator}/roles`).set(admin).send({ role: 'PAYROLL_APPROVER', scopeType: 'LEGAL_ENTITY', legalEntityId: ids.FR01 }).expect(201);
  });

  it('stops anyone changing their own roles', async () => {
    const me = await userId('admin@mindspace.test');
    await http().post(`/api/users/${me}/roles`).set(admin).send({ role: 'PAYROLL_APPROVER', scopeType: 'GROUP' }).expect(403);
  });

  it('signs a deactivated user out everywhere', async () => {
    const { auth } = await signIn(app, mail, 'employee@mindspace.test');
    await http().patch(`/api/users/${await userId('employee@mindspace.test')}`).set(hrKenya).send({ isActive: false }).expect(200);
    await http().get('/api/me').set(auth).expect(401);
  });

  it('does not let country HR deactivate a group-wide account', async () => {
    await http().patch(`/api/users/${await userId('admin@mindspace.test')}`).set(hrKenya).send({ isActive: false }).expect(404);
  });
});
