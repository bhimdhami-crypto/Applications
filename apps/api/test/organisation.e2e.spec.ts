import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };

describe('organisation and company isolation', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  let admin: Auth, hrKenya: Auth, hrFrance: Auth, hrIndia: Auth;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = await resetDatabase();
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    admin = (await signIn(app, mail, 'admin@mindspace.test')).auth;
    hrKenya = (await signIn(app, mail, 'hr.kenya@mindspace.test')).auth;
    hrFrance = (await signIn(app, mail, 'hr.france@mindspace.test')).auth;
    hrIndia = (await signIn(app, mail, 'hr.india@mindspace.test')).auth;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('shows a group admin all fifteen countries and eighteen companies', async () => {
    const tree = await http().get('/api/org/tree').set(admin).expect(200);
    expect(tree.body.countries).toHaveLength(15);
    expect(tree.body.countries.flatMap((c: { entities: unknown[] }) => c.entities)).toHaveLength(18);
  });

  it('shows country HR only their country, and company HR only their company', async () => {
    const ke = await http().get('/api/org/entities').set(hrKenya).expect(200);
    expect(ke.body.map((e: { code: string }) => e.code)).toEqual(['KE01', 'KE02']);
    const ind = await http().get('/api/org/entities').set(hrIndia).expect(200);
    expect(ind.body.map((e: { code: string }) => e.code)).toEqual(['IN01']);
  });

  it('answers Not found for another country’s company, so its existence is not revealed', async () => {
    await http().get(`/api/org/entities/${ids.FR01}`).set(hrKenya).expect(404);
    await http().get(`/api/org/entities/${ids.IN02}`).set(hrIndia).expect(404);
    await http().get(`/api/org/entities/${ids.KE01}`).set(hrKenya).expect(200);
  });

  it('lets country HR admins build structure in their companies only', async () => {
    await http().post(`/api/org/entities/${ids.KE01}/departments`).set(hrKenya).send({ code: 'RND', name: 'Research' }).expect(201);
    await http().post(`/api/org/entities/${ids.FR01}/departments`).set(hrKenya).send({ code: 'RND', name: 'Research' }).expect(404);
    // HR officers can read structure but not change it
    await http().post(`/api/org/entities/${ids.FR01}/departments`).set(hrFrance).send({ code: 'RND', name: 'Research' }).expect(403);
  });

  it('refuses links to another company’s records', async () => {
    const fr = await prisma.department.findFirstOrThrow({ where: { legalEntityId: ids.FR01 } });
    const res = await http().post(`/api/org/entities/${ids.KE01}/cost-centres`).set(hrKenya).send({ code: 'KE01-X', name: 'Cross', departmentId: fr.id }).expect(400);
    expect(res.body.message).toMatch(/not in this company/);
  });

  it('rejects duplicate codes inside a company with a clear message', async () => {
    const res = await http().post(`/api/org/entities/${ids.KE01}/business-units`).set(hrKenya).send({ code: 'TECH', name: 'Again' }).expect(409);
    expect(res.body.message).toMatch(/code is already in use/);
  });

  it('keeps country and currency setup and new companies to group admins', async () => {
    await http().post('/api/org/currencies').set(hrKenya).send({ code: 'BRL', name: 'Brazilian real', decimals: 2, symbol: 'R$' }).expect(403);
    await http().post('/api/org/currencies').set(admin).send({ code: 'BRL', name: 'Brazilian real', decimals: 2, symbol: 'R$' }).expect(201);
    await http().post('/api/org/countries').set(admin).send({ code: 'BR', name: 'Brazil', currencyCode: 'BRL', languages: ['en'], timeZone: 'Mars/Olympus', weekendDays: [0, 6], region: 'Americas' }).expect(400);
    await http().post('/api/org/countries').set(admin).send({ code: 'BR', name: 'Brazil', currencyCode: 'BRL', languages: ['en'], timeZone: 'America/Sao_Paulo', weekendDays: [0, 6], region: 'Americas' }).expect(201);
    await http().post('/api/org/entities').set(hrKenya).send({ code: 'BR01', name: 'Mindspace Artificial Intelligence Brasil Ltda', countryCode: 'BR' }).expect(403);
    const br = await http().post('/api/org/entities').set(admin).send({ code: 'BR01', name: 'Mindspace Artificial Intelligence Brasil Ltda', countryCode: 'BR' }).expect(201);
    expect(br.body).toMatchObject({ functionalCurrency: 'BRL', timeZone: 'America/Sao_Paulo', defaultLanguage: 'en' });
  });

  it('switches modules per company without touching other companies', async () => {
    await http().put(`/api/org/entities/${ids.KE01}/features/payroll`).set(hrKenya).send({ enabled: false }).expect(200);
    await http().put(`/api/org/entities/${ids.FR01}/features/payroll`).set(hrKenya).send({ enabled: false }).expect(404);
    await http().put(`/api/org/entities/${ids.KE01}/features/people`).set(hrKenya).send({ enabled: false }).expect(400);
    const ke = await http().get(`/api/org/entities/${ids.KE01}`).set(admin).expect(200);
    const ke2 = await http().get(`/api/org/entities/${ids.KE02}`).set(admin).expect(200);
    const flag = (body: { features: { module: string; enabled: boolean }[] }) => body.features.find((f) => f.module === 'payroll')!.enabled;
    expect(flag(ke.body)).toBe(false);
    expect(flag(ke2.body)).toBe(true);
  });

  it('records changes in the audit log, scoped like everything else', async () => {
    const auditor = (await signIn(app, mail, 'auditor@mindspace.test')).auth;
    const all = await http().get('/api/audit?action=org.').set(auditor).expect(200);
    expect(all.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['org.departments.created', 'org.feature.disabled', 'org.entity.created']));
    const ke = await http().get('/api/audit?action=org.').set(hrKenya).expect(200);
    expect(ke.body.items.every((i: { legalEntityId: string }) => [ids.KE01, ids.KE02].includes(i.legalEntityId))).toBe(true);
    await http().get('/api/audit').set(hrIndia).expect(403);
  });
});
