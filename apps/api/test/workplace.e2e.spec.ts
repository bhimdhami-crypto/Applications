import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, resetDatabase, signIn } from './helpers';

type Auth = { Authorization: string };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32)]);

jest.setTimeout(60_000);

describe('chat, community page and activity tracker', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaClient;
  const as: Record<string, Auth> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = await resetDatabase({ min: 40, max: 60 });
    ({ app, mail } = await createApp());
    for (const e of await prisma.legalEntity.findMany()) ids[e.code] = e.id;
    for (const u of await prisma.user.findMany()) users[u.email.split('@')[0]] = u.id;
    for (const who of ['admin', 'hr.kenya', 'hr.france', 'payroll.kenya', 'manager', 'employee']) as[who] = (await signIn(app, mail, `${who}@mindspace.test`)).auth;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('chat', () => {
    it('reopens the one direct chat between two people, and counts unread messages', async () => {
      const list = (await http().get('/api/chat/conversations').set(as.employee).expect(200)).body;
      const seeded = list.find((c: { kind: string; name: string }) => c.kind === 'DIRECT' && c.name === 'Amina Mwangi');
      expect(seeded).toBeDefined();
      const again = await http().post('/api/chat/conversations').set(as.employee).send({ userIds: [users.manager] }).expect(201);
      expect(again.body.id).toBe(seeded.id);

      const before = (await http().get('/api/chat/unread').set(as.manager).expect(200)).body.count;
      const sent = await http().post(`/api/chat/conversations/${seeded.id}/messages`).set(as.employee).send({ body: '  The defect numbers are in the tracker.  ' }).expect(201);
      expect(sent.body).toMatchObject({ mine: true, body: 'The defect numbers are in the tracker.' });
      expect((await http().get('/api/chat/unread').set(as.manager).expect(200)).body.count).toBe(before + 1);
      const read = await http().get(`/api/chat/conversations/${seeded.id}/messages`).set(as.manager).expect(200);
      expect(read.body.messages.at(-1)).toMatchObject({ id: sent.body.id, mine: false });
      expect((await http().get('/api/chat/unread').set(as.manager).expect(200)).body.count).toBe(before);
      const newer = await http().get(`/api/chat/conversations/${seeded.id}/messages?after=${sent.body.id}`).set(as.manager).expect(200);
      expect(newer.body.messages).toHaveLength(0);
    });

    it('keeps chats private to their members, and hides a deleted message but keeps the record', async () => {
      const chat = (await http().post('/api/chat/conversations').set(as.employee).send({ userIds: [users.manager] }).expect(201)).body.id;
      await http().get(`/api/chat/conversations/${chat}/messages`).set(as['hr.france']).expect(404);
      await http().post(`/api/chat/conversations/${chat}/messages`).set(as['hr.france']).send({ body: 'hello' }).expect(404);
      const m = await http().post(`/api/chat/conversations/${chat}/messages`).set(as.employee).send({ body: 'Oops, wrong chat' }).expect(201);
      await http().delete(`/api/chat/messages/${m.body.id}`).set(as.manager).expect(404);
      await http().delete(`/api/chat/messages/${m.body.id}`).set(as.employee).expect(200);
      const shown = (await http().get(`/api/chat/conversations/${chat}/messages`).set(as.manager).expect(200)).body.messages.find((x: { id: string }) => x.id === m.body.id);
      expect(shown).toMatchObject({ body: null, removed: 'Deleted by the sender' });
      expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: m.body.id } })).body).toBe('Oops, wrong chat');
    });

    it('runs a named group: add people, leave, and keep what was said before leaving', async () => {
      await http().post('/api/chat/conversations').set(as.manager).send({ userIds: [users.employee, users['hr.kenya']] }).expect(400);
      const g = (await http().post('/api/chat/conversations').set(as.manager).send({ userIds: [users.employee], name: 'Release crew' }).expect(201)).body.id;
      await http().post(`/api/chat/conversations/${g}/members`).set(as.manager).send({ userIds: [users['payroll.kenya']] }).expect(201);
      await http().post(`/api/chat/conversations/${g}/messages`).set(as['payroll.kenya']).send({ body: 'Payroll cut-off is Friday.' }).expect(201);
      await http().post(`/api/chat/conversations/${g}/leave`).set(as.employee).expect(201);
      await http().post(`/api/chat/conversations/${g}/messages`).set(as.employee).send({ body: 'still here?' }).expect(403);
      await http().post(`/api/chat/conversations/${g}/messages`).set(as.manager).send({ body: 'After Kevin left' }).expect(201);
      const seen = (await http().get(`/api/chat/conversations/${g}/messages`).set(as.employee).expect(200)).body.messages.map((m: { body: string }) => m.body);
      expect(seen).toContain('Payroll cut-off is Friday.');
      expect(seen).not.toContain('After Kevin left');
      const people = (await http().get('/api/chat/people?q=Amina').set(as.employee).expect(200)).body;
      expect(people.map((p: { name: string }) => p.name)).toContain('Amina Mwangi');
    });
  });

  describe('community page and moderation', () => {
    it('shares a post with a photo and a video once the author confirms they may, and serves the files', async () => {
      await http().post('/api/community/posts').set(as.employee).field('body', 'Team lunch!').attach('files', PNG, 'lunch.png').expect(400);
      await http().post('/api/community/posts').set(as.employee).field('body', 'Team lunch!').field('filesConfirmed', 'true').attach('files', Buffer.from('MZ not a photo'), 'x.png').expect(400);
      const post = await http()
        .post('/api/community/posts')
        .set(as.employee)
        .field('body', 'Team lunch!')
        .field('filesConfirmed', 'true')
        .attach('files', PNG, 'lunch.png')
        .attach('files', MP4, 'clip.mp4')
        .expect(201);
      expect(post.body.attachments.map((a: { mime: string }) => a.mime)).toEqual(['image/png', 'video/mp4']);
      const file = await http().get(`/api/community/posts/${post.body.id}/files/1`).set(as['hr.france']).expect(200);
      expect(file.headers['content-type']).toBe('video/mp4');

      const liked = await http().post(`/api/community/posts/${post.body.id}/like`).set(as.manager).expect(201);
      expect(liked.body).toEqual({ liked: true, likes: 1 });
      await http().post(`/api/community/posts/${post.body.id}/comments`).set(as.manager).send({ body: 'Looks great' }).expect(201);
      const feed = (await http().get('/api/community/posts').set(as.employee).expect(200)).body.posts;
      expect(feed[0]).toMatchObject({ id: post.body.id, mine: true, likes: 1, liked: false });
      expect(feed[0].comments[0]).toMatchObject({ body: 'Looks great', canRemove: false });
    });

    it('lets authors delete their own posts, and only HR for the author’s company remove others', async () => {
      const post = (await http().post('/api/community/posts').set(as.manager).field('body', 'Hackathon on Friday').expect(201)).body;
      await http().delete(`/api/community/posts/${post.id}`).set(as.employee).expect(403);
      await http().delete(`/api/community/posts/${post.id}`).set(as['hr.france']).expect(403);
      const sent = mail.outbox.length;
      await http().delete(`/api/community/posts/${post.id}`).set(as['hr.kenya']).expect(200);
      expect(mail.outbox.slice(sent).some((m) => m.to === 'manager@mindspace.test' && /removed/.test(m.subject))).toBe(true);
      const shown = (await http().get('/api/community/posts').set(as.employee).expect(200)).body.posts.find((p: { id: string }) => p.id === post.id);
      expect(shown).toMatchObject({ body: null, removed: 'Removed by a moderator' });

      const own = (await http().post('/api/community/posts').set(as.employee).field('body', 'Typo post').expect(201)).body;
      await http().delete(`/api/community/posts/${own.id}`).set(as.employee).expect(200);
      expect((await http().get('/api/community/posts').set(as.employee).expect(200)).body.posts.some((p: { id: string }) => p.id === own.id)).toBe(false);
    });

    it('routes reports to HR for the author’s company, who remove or keep the content', async () => {
      const open = (await http().get('/api/community/reports').set(as['hr.kenya']).expect(200)).body;
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ target: 'COMMENT', where: 'Comment on a community post', author: { name: 'Brian Kiptoo' } });
      expect((await http().get('/api/community/reports').set(as['hr.france']).expect(200)).body).toHaveLength(0);
      await http().get('/api/community/reports').set(as.employee).expect(403);
      await http().post(`/api/community/reports/${open[0].id}/remove`).set(as['hr.france']).send({}).expect(404);

      // Chat messages can be reported by members of the chat only
      const chat = (await http().post('/api/chat/conversations').set(as.employee).send({ userIds: [users.manager] }).expect(201)).body.id;
      const m = (await http().post(`/api/chat/conversations/${chat}/messages`).set(as.manager).send({ body: 'Please send me the client password list' }).expect(201)).body;
      await http().post('/api/community/reports').set(as['hr.france']).send({ target: 'MESSAGE', targetId: m.id, reason: 'Asking for passwords' }).expect(404);
      await http().post('/api/community/reports').set(as.manager).send({ target: 'MESSAGE', targetId: m.id, reason: 'Asking for passwords' }).expect(400);
      const sent = mail.outbox.length;
      await http().post('/api/community/reports').set(as.employee).send({ target: 'MESSAGE', targetId: m.id, reason: 'Asking for passwords in chat' }).expect(201);
      expect(mail.outbox.slice(sent).map((x) => x.to)).toContain('hr.kenya@mindspace.test');
      expect(mail.outbox.slice(sent).map((x) => x.to)).not.toContain('hr.france@mindspace.test');
      expect((await http().get('/api/community/reports/open').set(as['hr.kenya']).expect(200)).body.count).toBe(2);

      await http().post(`/api/community/reports/${open[0].id}/dismiss`).set(as['hr.kenya']).send({ note: 'Allowed this once' }).expect(201);
      await http().post(`/api/community/reports/${open[0].id}/remove`).set(as['hr.kenya']).send({}).expect(400);
      const chatReport = (await http().get('/api/community/reports').set(as['hr.kenya']).expect(200)).body[0];
      await http().post(`/api/community/reports/${chatReport.id}/remove`).set(as['hr.kenya']).send({ note: 'No passwords in chat (POL-20 3.3)' }).expect(201);
      const after = (await http().get(`/api/chat/conversations/${chat}/messages`).set(as.employee).expect(200)).body.messages.find((x: { id: string }) => x.id === m.id);
      expect(after).toMatchObject({ body: null, removed: 'Removed by a moderator' });
      expect(await prisma.auditLog.count({ where: { action: 'moderation.remove', targetId: m.id } })).toBe(1);
    });
  });

  describe('activity tracker', () => {
    const week = async (who = 'employee') => (await http().get('/api/activity/me').set(as[who]).expect(200)).body;

    it('clocks in and out once at a time, and records where the employee worked', async () => {
      if ((await week()).open) await http().post('/api/activity/clock-out').set(as.employee).expect(201);
      await http().post('/api/activity/clock-out').set(as.employee).expect(409);
      const s = await http().post('/api/activity/clock-in').set(as.employee).send({ mode: 'REMOTE' }).expect(201);
      await http().post('/api/activity/clock-in').set(as.employee).send({ mode: 'OFFICE' }).expect(409);
      const now = await week();
      expect(now.open).toMatchObject({ id: s.body.id, mode: 'REMOTE' });
      expect(now.timeZone).toBe('Africa/Nairobi');
      expect(now.days).toHaveLength(7);
      const out = await http().post('/api/activity/clock-out').set(as.employee).expect(201);
      expect(out.body.clockOut).not.toBeNull();
      const edited = await http().patch(`/api/activity/sessions/${s.body.id}`).set(as.employee).send({ clockIn: out.body.clockIn, clockOut: out.body.clockOut, reason: 'Checked my times' }).expect(200);
      expect(edited.body).toMatchObject({ edited: true, editReason: 'Checked my times' });
      await http().patch(`/api/activity/sessions/${s.body.id}`).set(as.manager).send({ clockIn: out.body.clockIn, clockOut: out.body.clockOut, reason: 'Not mine' }).expect(404);
    });

    it('keeps work notes within the last 7 days and 24 hours a day', async () => {
      const { today } = await week();
      const old = new Date(Date.parse(`${today}T00:00:00Z`) - 9 * 86_400_000).toISOString().slice(0, 10);
      await http().post('/api/activity/logs').set(as.employee).send({ date: old, hours: 2, project: 'HR portal', description: 'Too late to add' }).expect(400);
      const note = await http().post('/api/activity/logs').set(as.employee).send({ date: today, hours: 2.5, project: 'HR portal', description: 'Release notes' }).expect(201);
      expect(note.body.hours).toBe(2.5);
      await http().post('/api/activity/logs').set(as.employee).send({ date: today, hours: 23, project: 'HR portal', description: 'Too many' }).expect(400);
      await http().patch(`/api/activity/logs/${note.body.id}`).set(as.employee).send({ date: today, hours: 3, project: 'HR portal', description: 'Release notes and demo' }).expect(200);
      await http().delete(`/api/activity/logs/${note.body.id}`).set(as.manager).expect(404);
      await http().delete(`/api/activity/logs/${note.body.id}`).set(as.employee).expect(200);
    });

    it('shows managers their team and HR their own companies, never others', async () => {
      const team = (await http().get('/api/activity/team').set(as.manager).expect(200)).body;
      expect(team.wholeCompany).toBe(false);
      expect(team.rows.map((r: { name: string }) => r.name)).toContain('Kevin Otieno');
      await http().get('/api/activity/team').set(as.employee).expect(403);
      await http().get('/api/activity/report?month=2026-10').set(as.manager).expect(403);

      const company = (await http().get(`/api/activity/team?entityId=${ids.KE01}`).set(as['hr.kenya']).expect(200)).body;
      expect(company).toMatchObject({ wholeCompany: true, entity: { code: 'KE01' } });
      expect(company.summary.people).toBeGreaterThan(30);
      await http().get(`/api/activity/team?entityId=${ids.KE01}`).set(as['hr.france']).expect(404);
      await http().get(`/api/activity/report?month=2026-10&entityId=${ids.KE01}`).set(as['hr.france']).expect(404);

      const month = (await week()).today.slice(0, 7);
      const report = (await http().get(`/api/activity/report?month=${month}&entityId=${ids.KE01}`).set(as['payroll.kenya']).expect(200)).body;
      expect(report.rows.length).toBeGreaterThan(0);
      const csv = await http().get(`/api/activity/report?month=${month}&entityId=${ids.KE01}&format=csv`).set(as['hr.kenya']).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.split('\n')[0]).toBe('Employee number,Name,Days present,Hours worked,Hours noted,Hours above expected,Forgot to clock out,Edited sessions');
    });

    it('refuses new time while the company has time and attendance switched off', async () => {
      if ((await week()).open) await http().post('/api/activity/clock-out').set(as.employee).expect(201);
      await http().put(`/api/org/entities/${ids.KE01}/features/attendance`).set(as.admin).send({ enabled: false }).expect(200);
      expect((await week()).enabled).toBe(false);
      await http().post('/api/activity/clock-in').set(as.employee).send({ mode: 'OFFICE' }).expect(403);
      await http().put(`/api/org/entities/${ids.KE01}/features/attendance`).set(as.admin).send({ enabled: true }).expect(200);
      await http().post('/api/activity/clock-in').set(as.employee).send({ mode: 'OFFICE' }).expect(201);
      await http().get('/api/activity/me').set(as.admin).expect(403);
    });
  });
});
