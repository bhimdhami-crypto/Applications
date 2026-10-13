import { ConversationKind, LibraryKind, PrismaClient, WorkMode } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { localDate } from '../src/activity/time';
import { addDays, fromIso, workingDays } from '../src/leave/calendar';
import { publicHolidays } from '../src/leave/public-holidays';

interface CatalogueEntry {
  kind: 'POLICY' | 'FORM';
  code: string;
  title: string;
  category: string;
  owner: string;
  summary: string | null;
  version: string;
  file: string;
}

const LIBRARY_DIR = path.resolve(__dirname, '../../../sample-data/library');

/** The 22 group policies and 20 HR forms from the policy pack. Added once; HR's later changes are kept. */
export async function seedLibrary(prisma: PrismaClient) {
  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? 'storage');
  const catalogue: CatalogueEntry[] = JSON.parse(await fs.readFile(path.join(LIBRARY_DIR, 'catalogue.json'), 'utf8'));
  for (const c of catalogue) {
    if (await prisma.libraryItem.findUnique({ where: { code: c.code } })) continue;
    const fileKey = `library/${c.code}/v${c.version}.pdf`;
    const target = path.join(storageRoot, fileKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(LIBRARY_DIR, c.file), target);
    await prisma.libraryItem.create({
      data: {
        kind: c.kind as LibraryKind, code: c.code, title: c.title, category: c.category, owner: c.owner, summary: c.summary,
        version: c.version, fileKey, fileName: `${c.code} ${c.title}.pdf`, mustRead: c.kind === 'POLICY',
      },
    });
  }
}

/** Nairobi local time on a date, as a UTC moment (Kenya is UTC+3 all year) */
const nairobi = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:00`);

/**
 * A few chats, community posts and a week of clock-ins and work logs for the Kenya test team,
 * so the new screens have something to show. Added once.
 */
export async function seedWorkplace(prisma: PrismaClient, employeeIdByEmail: Map<string, string>) {
  const users = new Map((await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email.split('@')[0], u.id]));
  const u = (name: string) => users.get(name)!;
  const emp = (name: string) => employeeIdByEmail.get(`${name}@mindspace-ai.test`)!;

  if ((await prisma.conversation.count()) === 0) {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await prisma.conversation.create({
      data: {
        kind: ConversationKind.DIRECT, directKey: [u('manager'), u('tester')].sort().join(':'), createdById: u('manager'), lastMessageAt: ago(42),
        members: { create: [{ userId: u('manager'), lastReadAt: ago(42) }, { userId: u('tester'), lastReadAt: ago(120) }] },
        messages: {
          create: [
            { senderId: u('tester'), body: 'Hi Amina, the regression run for the payroll release finished. Two defects logged, both minor.', createdAt: ago(60) },
            { senderId: u('manager'), body: 'Thanks Faith. Can you share the defect numbers in the release channel before stand-up?', createdAt: ago(48) },
            { senderId: u('manager'), body: 'Also, your advance request is in my approvals. I will look at it today.', createdAt: ago(42) },
          ],
        },
      },
    });
    await prisma.conversation.create({
      data: {
        kind: ConversationKind.GROUP, name: 'Kenya engineering', createdById: u('manager'), lastMessageAt: ago(15),
        members: { create: [{ userId: u('manager') }, { userId: u('developer'), lastReadAt: ago(30) }, { userId: u('tester'), lastReadAt: ago(200) }] },
        messages: {
          create: [
            { senderId: u('manager'), body: 'Welcome to the team chat. Please keep client names and source code out of chat (POL-20 3.3).', createdAt: ago(300) },
            { senderId: u('developer'), body: 'Deploy of the leave calendar fix is done. Monitoring for the next hour.', createdAt: ago(25) },
            { senderId: u('manager'), body: 'Great work, Kevin. Stand-up moves to 10:30 tomorrow.', createdAt: ago(15) },
          ],
        },
      },
    });
  }

  if ((await prisma.communityPost.count()) === 0) {
    const welcome = await prisma.communityPost.create({
      data: {
        authorId: u('hr'),
        body: 'Welcome to the Mindspace community page! Share team news, wins, events and things you have learned. Please read POL-20 Community Page, Chat and Copyright Guidelines in Policies and forms, and only share photos and videos you made or have permission to use.',
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    const release = await prisma.communityPost.create({
      data: {
        authorId: u('manager'),
        body: 'Shout-out to the Nairobi engineering team: the new leave calendar went live for all eight countries this week, with public holidays from Kenya to New Zealand. Thank you Kevin and Faith for the late testing sessions.',
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });
    await prisma.postLike.createMany({ data: [u('developer'), u('tester'), u('payroll')].map((userId) => ({ postId: release.id, userId })) });
    await prisma.postLike.createMany({ data: [u('manager'), u('finance')].map((userId) => ({ postId: welcome.id, userId })) });
    await prisma.postComment.createMany({
      data: [
        { postId: release.id, authorId: u('developer'), body: 'Team effort! The Coptic Easter dates for Egypt were the tricky part.' },
        { postId: release.id, authorId: u('hr'), body: 'Congratulations everyone.' },
      ],
    });
  }

  // A working week of clock-ins and work logs up to yesterday, plus today for Kevin
  const engineers = ['developer', 'tester', 'manager'];
  if ((await prisma.attendanceSession.count({ where: { employeeId: { in: engineers.map(emp) } } })) === 0) {
    const today = localDate('KE');
    const holidays = new Set(publicHolidays('KE', Number(today.slice(0, 4))).map((h) => h.date));
    const days = workingDays(addDays(today, -9), addDays(today, -1), 'KE', holidays).slice(-5);
    const plan: Record<string, { start: string; end: string; mode: WorkMode; logs: Array<[number, string, string]> }> = {
      developer: { start: '08:12', end: '17:20', mode: WorkMode.REMOTE, logs: [[5, 'HR portal', 'Leave calendar and holiday rules'], [3, 'Code review', 'Reviewed payroll changes']] },
      tester: { start: '08:45', end: '17:05', mode: WorkMode.REMOTE, logs: [[6, 'HR portal', 'Regression tests for payroll and leave'], [2, 'Test automation', 'Playwright scripts']] },
      manager: { start: '08:30', end: '18:10', mode: WorkMode.OFFICE, logs: [[4, 'Team management', 'One-to-ones and planning'], [4, 'HR portal', 'Architecture and release review']] },
    };
    for (const name of engineers) {
      const p = plan[name];
      for (const date of days) {
        await prisma.attendanceSession.create({ data: { employeeId: emp(name), date: fromIso(date), clockIn: nairobi(date, p.start), clockOut: nairobi(date, p.end), mode: p.mode } });
        for (const [hours, project, description] of p.logs) {
          await prisma.workLog.create({ data: { employeeId: emp(name), date: fromIso(date), hours, project, description } });
        }
      }
    }
    if (!holidays.has(today) && workingDays(today, today, 'KE', holidays).length) {
      await prisma.attendanceSession.create({ data: { employeeId: emp('developer'), date: fromIso(today), clockIn: nairobi(today, '08:05'), mode: WorkMode.REMOTE } });
    }
  }

  // Kevin has already read the code of conduct and the data privacy policy
  const kevin = emp('developer');
  if ((await prisma.policyAcknowledgement.count({ where: { employeeId: kevin } })) === 0) {
    for (const item of await prisma.libraryItem.findMany({ where: { code: { in: ['POL-01', 'POL-08'] } } })) {
      await prisma.policyAcknowledgement.create({ data: { itemId: item.id, version: item.version, employeeId: kevin } });
    }
  }
}
