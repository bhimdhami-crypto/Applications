import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, lastCode, PASSWORD, resetDatabase, signIn } from './helpers';

describe('sign-in and sessions', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = await resetDatabase();
    ({ app, mail } = await createApp());
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('answers the health check without signing in', async () => {
    await http().get('/api/health').expect(200, /"database":"ok"/);
  });

  it('refuses requests without a token', async () => {
    await http().get('/api/me').expect(401);
  });

  it('signs in with password and emailed code, then shows my roles', async () => {
    const { auth } = await signIn(app, mail, 'hr.kenya@mindspace.test');
    const me = await http().get('/api/me').set(auth).expect(200);
    expect(me.body.user.email).toBe('hr.kenya@mindspace.test');
    expect(me.body.roles).toEqual([expect.objectContaining({ role: 'HR_ADMIN', scopeType: 'COUNTRY', countryCode: 'KE' })]);
    expect(me.body.entities.map((e: { code: string }) => e.code).sort()).toEqual(['KE01', 'KE02']);
    expect(me.body.permissions['geo.manage']).toBeUndefined();
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const a = await http().post('/api/auth/login').send({ email: 'nobody@mindspace.test', password: 'x' }).expect(401);
    const b = await http().post('/api/auth/login').send({ email: 'hr.france@mindspace.test', password: 'wrong' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('locks the account after five wrong passwords', async () => {
    for (let i = 0; i < 5; i++) await http().post('/api/auth/login').send({ email: 'ceo@mindspace.test', password: 'wrong' }).expect(401);
    const res = await http().post('/api/auth/login').send({ email: 'ceo@mindspace.test', password: PASSWORD }).expect(401);
    expect(res.body.message).toMatch(/Too many failed attempts/);
  });

  it('accepts each code once and rejects wrong codes', async () => {
    const login = await http().post('/api/auth/login').send({ email: 'treasury@mindspace.test', password: PASSWORD }).expect(200);
    const code = lastCode(mail, 'treasury@mindspace.test');
    const wrong = code === '000000' ? '111111' : '000000';
    await http().post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: wrong }).expect(401);
    await http().post('/api/auth/verify').send({ challengeId: login.body.challengeId, code }).expect(200);
    await http().post('/api/auth/verify').send({ challengeId: login.body.challengeId, code }).expect(401);
  });

  it('rotates mobile refresh tokens and ends the session when an old one is replayed', async () => {
    const { body } = await signIn(app, mail, 'finance@mindspace.test', 'mobile');
    expect(body.refreshToken).toBeDefined();
    const next = await http().post('/api/auth/refresh').send({ refreshToken: body.refreshToken }).expect(200);
    expect(next.body.refreshToken).not.toBe(body.refreshToken);
    await http().get('/api/me').set({ Authorization: `Bearer ${next.body.accessToken}` }).expect(200);

    // Replaying the first token looks like theft: the whole session ends
    await http().post('/api/auth/refresh').send({ refreshToken: body.refreshToken }).expect(401);
    await http().get('/api/me').set({ Authorization: `Bearer ${next.body.accessToken}` }).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: next.body.refreshToken }).expect(401);
  });

  it('keeps the web refresh token in an http-only cookie, never in the body', async () => {
    const { body, res } = await signIn(app, mail, 'auditor@mindspace.test', 'web');
    expect(body.refreshToken).toBeUndefined();
    const cookie = res.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/^gpp_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    const refreshed = await http().post('/api/auth/refresh').set('Cookie', cookie.split(';')[0]).expect(200);
    expect(refreshed.body.accessToken).toBeDefined();
    expect(refreshed.body.refreshToken).toBeUndefined();
  });

  it('lists my devices and signs one out', async () => {
    const first = await signIn(app, mail, 'hr.global@mindspace.test');
    const second = await signIn(app, mail, 'hr.global@mindspace.test');
    const list = await http().get('/api/auth/sessions').set(second.auth).expect(200);
    expect(list.body.length).toBe(2);
    await http().delete(`/api/auth/sessions/${first.body.sessionId}`).set(second.auth).expect(204);
    await http().get('/api/me').set(first.auth).expect(401);
    await http().get('/api/me').set(second.auth).expect(200);
  });

  it('signs out', async () => {
    const { auth, body } = await signIn(app, mail, 'manager@mindspace.test');
    await http().post('/api/auth/logout').send({ refreshToken: body.refreshToken }).expect(204);
    await http().get('/api/me').set(auth).expect(401);
  });

  it('keeps the audit log append-only', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.signed_in' } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
