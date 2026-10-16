import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };
type Item = { id: string; code: string; kind: string; version: string; mustRead: boolean; readAt: string | null; readEarlier: boolean; active: boolean };

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

jest.setTimeout(60_000);

describe('policies and forms', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const items = async (who: string) => (await http().get('/api/library').set(as[who]).expect(200)).body.items as Item[];

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const who of ['hr.global', 'hr.kenya', 'hr.france', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists the 22 policies and 20 forms from the first build, and opens a PDF', async () => {
    const all = await items('employee');
    expect(all.filter((i) => i.kind === 'POLICY')).toHaveLength(22);
    expect(all.filter((i) => i.kind === 'FORM')).toHaveLength(20);
    const pol = all.find((i) => i.code === 'POL-20')!;
    const file = await http().get(`/api/library/${pol.id}/file`).set(as.employee).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('records that an employee read a policy, and counts what is left', async () => {
    const before = (await http().get('/api/library/pending').set(as.employee).expect(200)).body.count;
    expect(before).toBe(22);
    const pol = (await items('employee')).find((i) => i.code === 'POL-01')!;
    expect((await http().post(`/api/library/${pol.id}/acknowledge`).set(as.employee).expect(201)).body.version).toBe(pol.version);
    await http().post(`/api/library/${pol.id}/acknowledge`).set(as.employee).expect(201);
    expect((await http().get('/api/library/pending').set(as.employee).expect(200)).body.count).toBe(before - 1);
    const form = (await items('employee')).find((i) => i.kind === 'FORM')!;
    await http().post(`/api/library/${form.id}/acknowledge`).set(as.employee).expect(400);
  });

  it('lets only group HR administrators publish, and a new version asks everyone again', async () => {
    const pol = (await items('employee')).find((i) => i.code === 'POL-01')!;
    await http().post(`/api/library/${pol.id}/versions`).set(as['hr.kenya']).field('version', '1.0').attach('file', PDF, 'pol.pdf').expect(403);
    await http().post(`/api/library/${pol.id}/versions`).set(as['hr.global']).field('version', '1.0').attach('file', Buffer.from('not a pdf'), 'x.pdf').expect(400);
    const v = await http().post(`/api/library/${pol.id}/versions`).set(as['hr.global']).field('version', '1.0').attach('file', PDF, 'pol.pdf').expect(201);
    expect(v.body.version).toBe('1.0');
    const after = (await items('employee')).find((i) => i.code === 'POL-01')!;
    expect(after).toMatchObject({ readAt: null, readEarlier: true });
    const created = await http()
      .post('/api/library')
      .set(as['hr.global'])
      .field('kind', 'POLICY')
      .field('code', 'POL-23')
      .field('title', 'Travel Safety')
      .field('category', 'Safety')
      .field('version', '0.1')
      .attach('file', PDF, 'pol.pdf')
      .expect(201);
    await http().patch(`/api/library/${created.body.id}`).set(as['hr.global']).send({ active: false }).expect(200);
    expect((await items('employee')).some((i) => i.code === 'POL-23')).toBe(false);
    await http().get(`/api/library/${created.body.id}/file`).set(as.employee).expect(404);
  });

  it("shows HR who has read a policy in their own companies only, and sends reminders there", async () => {
    const pol = (await items('employee')).find((i) => i.code === 'POL-08')!;
    const report = (await http().get(`/api/library/${pol.id}/report`).set(as['hr.kenya']).expect(200)).body;
    expect(report.perCompany.map((c: { code: string }) => c.code).sort()).toEqual(['KE01', 'KE02']);
    expect(report.perCompany[0].read).toBeGreaterThan(0);
    await http().get(`/api/library/${pol.id}/report?entityId=${ids.FR01}`).set(as['hr.kenya']).expect(404);
    await http().get(`/api/library/${pol.id}/report`).set(as.employee).expect(403);
    mail.outbox.length = 0;
    const sent = (await http().post(`/api/library/${pol.id}/remind?entityId=${ids.KE01}`).set(as['hr.kenya']).expect(201)).body.sent;
    expect(sent).toBeGreaterThan(0);
    expect(mail.outbox.every((m) => m.subject.startsWith('Please read POL-08'))).toBe(true);
    expect(mail.outbox.some((m) => m.to === 'hr.france@mindspace.test')).toBe(false);
  });

  it('audits confirmations and publishing', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ action: { startsWith: 'policy.' } }, { action: { startsWith: 'library.' } }] }, select: { action: true } })).map((a) => a.action);
    for (const a of ['policy.read.confirmed', 'library.version.published', 'library.created', 'library.updated', 'policy.reminder.sent']) expect(actions).toContain(a);
  });
});
