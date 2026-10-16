import { ConversationKind, Prisma, PrismaClient, ReportTarget, WorkLocation, WorkMode } from '@prisma/client';
import { addDays, eachDay, fromIso, toIso, workingDays } from '../src/leave/calendar';
import { publicHolidays } from '../src/leave/public-holidays';
import { localDate } from '../src/workplace/time';
import { rng } from './staff-generator';

const WORKPLACE_SEED = 20261021;
/** Working days of tracker history before today */
const HISTORY_DAYS = 10;
const MODE_BY_LOCATION: Record<WorkLocation, Array<readonly [WorkMode, number]>> = {
  ON_SITE: [['OFFICE', 92], ['FIELD', 8]],
  HYBRID: [['OFFICE', 55], ['REMOTE', 45]],
  FULLY_REMOTE: [['REMOTE', 100]],
};
const PROJECTS: Array<readonly [string, string[]]> = [
  ['HR portal', ['Leave calendar and holiday rules', 'Payslip layout fixes', 'Approvals inbox', 'Release testing']],
  ['Client onboarding', ['Data migration checks', 'Workshop with the client team', 'Configuration review']],
  ['Model training', ['Labelled a new batch of training data', 'Evaluated the latest model run', 'Tuned the data pipeline']],
  ['Internal tools', ['Fixed the build pipeline', 'Updated documentation', 'Code review']],
  ['Team management', ['One-to-ones and planning', 'Hiring interviews', 'Sprint review']],
];

/** A moment at local wall-clock time in a time zone, found by correcting a UTC guess with the zone's offset */
function at(date: string, minutes: number, timeZone: string) {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (shown - guess));
}

/**
 * Sample chats, community posts with one open report, and two weeks of clock-ins and work notes for
 * the Kenyan companies, so the workplace screens have something to show. Added once per group.
 * Every name is fictional.
 */
export async function generateWorkplace(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  const users = new Map((await prisma.user.findMany({ where: { groupId }, select: { id: true, email: true } })).map((u) => [u.email.split('@')[0], u.id]));
  const u = (name: string) => users.get(name);
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  let chats = 0;
  let posts = 0;

  const manager = u('manager');
  const employee = u('employee');
  const hrKenya = u('hr.kenya');
  const payroll = u('payroll.kenya');
  const hrGlobal = u('hr.global');
  if (manager && employee && hrKenya && payroll && hrGlobal && !(await prisma.conversation.count({ where: { groupId } }))) {
    await prisma.conversation.create({
      data: {
        groupId,
        kind: ConversationKind.DIRECT,
        directKey: [manager, employee].sort().join(':'),
        createdById: manager,
        lastMessageAt: ago(42),
        members: { create: [{ userId: manager, lastReadAt: ago(42) }, { userId: employee, lastReadAt: ago(120) }] },
        messages: {
          create: [
            { senderId: employee, body: 'Hi Amina, the regression run for the payroll release finished. Two defects logged, both minor.', createdAt: ago(60) },
            { senderId: manager, body: 'Thanks Kevin. Can you share the defect numbers in the team chat before stand-up?', createdAt: ago(48) },
            { senderId: manager, body: 'I also nominated you for a recognition voucher. HR will confirm it.', createdAt: ago(42) },
          ],
        },
      },
    });
    await prisma.conversation.create({
      data: {
        groupId,
        kind: ConversationKind.GROUP,
        name: 'Kenya engineering',
        createdById: manager,
        lastMessageAt: ago(15),
        members: { create: [{ userId: manager }, { userId: employee, lastReadAt: ago(200) }, { userId: hrKenya, lastReadAt: ago(30) }] },
        messages: {
          create: [
            { senderId: manager, body: 'Welcome to the team chat. Please keep client names and source code out of chat (POL-20 3.3).', createdAt: ago(300) },
            { senderId: hrKenya, body: 'Reminder: please read the updated leave policy in Policies and forms this week.', createdAt: ago(25) },
            { senderId: manager, body: 'Stand-up moves to 10:30 tomorrow.', createdAt: ago(15) },
          ],
        },
      },
    });
    chats = 2;
  }

  if (manager && employee && hrKenya && payroll && hrGlobal && !(await prisma.communityPost.count({ where: { groupId } }))) {
    const welcome = await prisma.communityPost.create({
      data: {
        groupId,
        authorId: hrGlobal,
        body: 'Welcome to the Mindspace community page! Share team news, wins, events and things you have learned. Please read POL-20 Community Page, Chat and Copyright Guidelines in Policies and forms, and only share photos and videos you made or have permission to use.',
        createdAt: ago(3 * 24 * 60),
      },
    });
    const release = await prisma.communityPost.create({
      data: {
        groupId,
        authorId: manager,
        body: 'Shout-out to the Nairobi engineering team: the new leave calendar went live for every country this week. Thank you Kevin for the late testing sessions.',
        createdAt: ago(24 * 60),
      },
    });
    await prisma.postLike.createMany({ data: [employee, hrKenya, payroll].map((userId) => ({ postId: release.id, userId })) });
    await prisma.postLike.createMany({ data: [manager, hrKenya].map((userId) => ({ postId: welcome.id, userId })) });
    await prisma.postComment.createMany({
      data: [
        { postId: release.id, authorId: employee, body: 'Team effort! The holiday dates for Egypt were the tricky part.', createdAt: ago(20 * 60) },
        { postId: release.id, authorId: hrKenya, body: 'Congratulations everyone.', createdAt: ago(18 * 60) },
      ],
    });
    // An off-topic advert under the welcome post, reported for HR to review
    const advert = await prisma.postComment.create({
      data: { postId: welcome.id, authorId: payroll, body: 'Selling two concert tickets for Saturday, cash only. Message me.', createdAt: ago(5 * 60) },
    });
    const brianCompany = await prisma.employment.findFirst({ where: { userId: payroll }, select: { legalEntityId: true } });
    await prisma.contentReport.create({
      data: { groupId, target: ReportTarget.COMMENT, targetId: advert.id, legalEntityId: brianCompany?.legalEntityId ?? null, reporterId: employee, reason: 'Selling things is not what the community page is for (POL-20).', createdAt: ago(4 * 60) },
    });
    posts = 2;
  }

  // Two weeks of clock-ins and work notes for the Kenyan companies, and the morning so far
  const kenya = await prisma.legalEntity.findMany({ where: { groupId, countryCode: 'KE' }, select: { id: true, code: true, countryCode: true, timeZone: true, weekendDays: true }, orderBy: { code: 'asc' } });
  let sessions = 0;
  let notes = 0;
  for (const entity of kenya) {
    if (await prisma.attendanceSession.count({ where: { employment: { legalEntityId: entity.id } } })) continue;
    const r = rng(WORKPLACE_SEED + entity.code.charCodeAt(3));
    const today = localDate(entity.timeZone);
    const year = Number(today.slice(0, 4));
    const holidays = new Set([...publicHolidays(entity.countryCode, year - 1), ...publicHolidays(entity.countryCode, year)].map((h) => h.date));
    const days = workingDays(addDays(today, -HISTORY_DAYS * 2), addDays(today, -1), entity.weekendDays, holidays).slice(-HISTORY_DAYS);
    const staff = await prisma.employment.findMany({
      where: { legalEntityId: entity.id, status: 'ACTIVE', hireDate: { lte: fromIso(days[0] ?? today) } },
      select: { id: true, workLocation: true, user: { select: { email: true } } },
      orderBy: { employeeNumber: 'asc' },
    });
    const leave = await prisma.leaveRequest.findMany({
      where: { legalEntityId: entity.id, status: 'APPROVED', startDate: { lte: fromIso(today) }, endDate: { gte: fromIso(days[0] ?? today) } },
      select: { employmentId: true, startDate: true, endDate: true },
    });
    const away = new Set(leave.flatMap((l) => eachDay(toIso(l.startDate), toIso(l.endDate)).map((d) => `${l.employmentId}:${d}`)));
    const sessionRows: Prisma.AttendanceSessionCreateManyInput[] = [];
    const logRows: Prisma.WorkLogCreateManyInput[] = [];
    const nowMinutes = (() => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: entity.timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date()).split(':').map(Number);
      return h * 60 + m;
    })();
    const workingToday = workingDays(today, today, entity.weekendDays, holidays).length > 0;
    for (const s of staff) {
      const demo = !!s.user;
      for (const date of days) {
        if (away.has(`${s.id}:${date}`) || (!demo && !r.chance(0.86))) continue;
        const start = r.int(7 * 60 + 40, 9 * 60 + 20);
        const length = r.int(7 * 60 + 30, 9 * 60 + 40);
        const forgot = !demo && r.chance(0.01);
        const edited = !demo && !forgot && r.chance(0.015);
        sessionRows.push({
          employmentId: s.id,
          date: fromIso(date),
          clockIn: at(date, start, entity.timeZone),
          clockOut: at(date, forgot ? start + 9 * 60 : start + length, entity.timeZone),
          mode: r.weighted(MODE_BY_LOCATION[s.workLocation]),
          autoClosed: forgot,
          editedAt: edited ? at(date, start + length + 30, entity.timeZone) : null,
          editReason: edited ? 'Forgot to clock out; corrected the next morning' : null,
        });
        if (demo || r.chance(0.4)) {
          const [project, tasks] = r.pick(PROJECTS);
          const first = r.int(3, 6);
          logRows.push({ employmentId: s.id, date: fromIso(date), hours: first, project, description: r.pick(tasks) });
          const [other, more] = r.pick(PROJECTS);
          logRows.push({ employmentId: s.id, date: fromIso(date), hours: Math.max(1, Math.round(length / 60) - first), project: other, description: r.pick(more) });
        }
      }
      // Today: people who have started by now, still clocked in; the demo employee always has
      if (workingToday && !away.has(`${s.id}:${today}`) && (s.user?.email === 'employee@mindspace.test' || (!demo && r.chance(0.7)))) {
        const start = s.user ? Math.min(8 * 60 + 5, nowMinutes - 5) : r.int(7 * 60 + 40, 9 * 60 + 20);
        if (start < nowMinutes && start > 0) sessionRows.push({ employmentId: s.id, date: fromIso(today), clockIn: at(today, start, entity.timeZone), mode: r.weighted(MODE_BY_LOCATION[s.workLocation]) });
      }
    }
    await prisma.attendanceSession.createMany({ data: sessionRows });
    await prisma.workLog.createMany({ data: logRows });
    sessions += sessionRows.length;
    notes += logRows.length;
  }
  log(`  Workplace: ${chats} sample chats, ${posts} community posts with one open report, ${sessions} clock-in sessions and ${notes} work notes in the Kenyan companies.`);
}
