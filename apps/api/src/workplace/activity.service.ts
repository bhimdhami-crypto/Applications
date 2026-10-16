import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSession, LeaveStatus, Prisma, WorkLog } from '@prisma/client';
import { can } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { fullName } from '../approvals/people';
import { addDays, eachDay, fromIso, IsoDate, toIso, workingDays } from '../leave/calendar';
import { LeaveService } from '../leave/leave.service';
import { inForce, PeopleAccess } from '../people/people-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityReportQuery, ClockInDto, EditSessionDto, TeamQuery, WorkLogDto } from './activity.dto';
import { AUTO_CLOSE_HOURS, DAY_HOURS, EDIT_DAYS, localDate, MAX_SESSION_HOURS, minutesBetween, mondayOf } from './time';

const HOUR = 3_600_000;
const ENTITY = { id: true, code: true, name: true, countryCode: true, timeZone: true, weekendDays: true } as const;
type Entity = Prisma.LegalEntityGetPayload<{ select: typeof ENTITY }>;

const sessionMinutes = (s: AttendanceSession, now = new Date()) => minutesBetween(s.clockIn, s.clockOut ?? now);

function presentSession(s: AttendanceSession) {
  return {
    id: s.id,
    date: toIso(s.date),
    clockIn: s.clockIn,
    clockOut: s.clockOut,
    mode: s.mode,
    minutes: sessionMinutes(s),
    autoClosed: s.autoClosed,
    edited: !!s.editedAt,
    editReason: s.editReason,
  };
}
const presentLog = (l: WorkLog) => ({ id: l.id, date: toIso(l.date), hours: Number(l.hours), project: l.project, description: l.description });

/** Readers of a whole company's activity: HR and Payroll */
const WHOLE_COMPANY = ['people.read', 'payroll.read'] as const;

/**
 * The daily activity tracker carried over from the first build (POL-21): clock-in and clock-out
 * with where people worked, and notes of what they worked on. No location, screen or keystrokes are
 * recorded. Managers see the people below them; HR and Payroll see their companies.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leave: LeaveService,
    private readonly access: PeopleAccess,
  ) {}

  /** The caller's own active employment, with its company's time zone and weekend */
  private async me(auth: AuthContext) {
    const e = await this.prisma.employment.findFirst({
      where: { userId: auth.userId, legalEntity: { groupId: auth.groupId } },
      orderBy: { hireDate: 'desc' },
      select: { id: true, status: true, endDate: true, legalEntity: { select: ENTITY } },
    });
    if (!e) throw new ForbiddenException('Only employees record their working time');
    return e;
  }

  private async assertModuleOn(entity: Entity) {
    const f = await this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId: entity.id, module: 'attendance' } } });
    if (!f?.enabled) throw new ForbiddenException(`Time and attendance is switched off for ${entity.name}`);
  }

  /** Closes sessions left open past the limit, a normal day's length after clock-in */
  private async closeForgotten(employmentIds: string[]) {
    const stale = await this.prisma.attendanceSession.findMany({
      where: { employmentId: { in: employmentIds }, clockOut: null, clockIn: { lt: new Date(Date.now() - MAX_SESSION_HOURS * HOUR) } },
    });
    for (const s of stale) {
      await this.prisma.attendanceSession.update({ where: { id: s.id }, data: { clockOut: new Date(s.clockIn.getTime() + AUTO_CLOSE_HOURS * HOUR), autoClosed: true } });
    }
  }

  /** The signed-in employee's week: sessions and work notes per day, and totals */
  async myWeek(auth: AuthContext, week?: string) {
    const me = await this.me(auth);
    const entity = me.legalEntity;
    await this.closeForgotten([me.id]);
    const today = localDate(entity.timeZone);
    const start = mondayOf(week ?? today);
    const end = addDays(start, 6);
    const range = { gte: fromIso(start), lte: fromIso(end) };
    const [sessions, logs, holidays, leave, feature] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employmentId: me.id, date: range }, orderBy: { clockIn: 'asc' } }),
      this.prisma.workLog.findMany({ where: { employmentId: me.id, date: range }, orderBy: { createdAt: 'asc' } }),
      this.leave.holidaySet(entity.countryCode, start, end),
      this.approvedLeave([me.id], start, end),
      this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId: entity.id, module: 'attendance' } } }),
    ]);
    const open = await this.prisma.attendanceSession.findFirst({ where: { employmentId: me.id, clockOut: null } });
    const working = new Set(workingDays(start, end, entity.weekendDays, new Set(holidays.keys())));
    const days = eachDay(start, end).map((date) => {
      const s = sessions.filter((x) => toIso(x.date) === date);
      const l = logs.filter((x) => toIso(x.date) === date);
      return {
        date,
        working: working.has(date),
        holiday: holidays.get(date) ?? null,
        onLeave: leave.get(me.id)?.has(date) ?? false,
        sessions: s.map(presentSession),
        logs: l.map(presentLog),
        workedMinutes: s.reduce((sum, x) => sum + sessionMinutes(x), 0),
        loggedHours: l.reduce((sum, x) => sum + Number(x.hours), 0),
      };
    });
    const expectedDays = days.filter((d) => d.working && !d.onLeave).length;
    return {
      enabled: !!feature?.enabled,
      company: entity.name,
      today,
      timeZone: entity.timeZone,
      editableFrom: addDays(today, -EDIT_DAYS),
      limits: { editDays: EDIT_DAYS, autoCloseAfterHours: MAX_SESSION_HOURS, dayHours: DAY_HOURS },
      week: { start, end },
      open: open ? presentSession(open) : null,
      days,
      totals: {
        workedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
        loggedHours: days.reduce((s, d) => s + d.loggedHours, 0),
        expectedHours: expectedDays * DAY_HOURS,
      },
    };
  }

  async clockIn(auth: AuthContext, dto: ClockInDto) {
    const me = await this.me(auth);
    await this.assertModuleOn(me.legalEntity);
    await this.closeForgotten([me.id]);
    const today = localDate(me.legalEntity.timeZone);
    if (me.status !== 'ACTIVE' || (me.endDate && toIso(me.endDate) < today)) throw new ForbiddenException('Your employment has ended');
    try {
      const s = await this.prisma.attendanceSession.create({ data: { employmentId: me.id, date: fromIso(today), clockIn: new Date(), mode: dto.mode } });
      return presentSession(s);
    } catch (err) {
      // One open session at a time, enforced by the database
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('You are already clocked in');
      throw err;
    }
  }

  async clockOut(auth: AuthContext) {
    const me = await this.me(auth);
    await this.closeForgotten([me.id]);
    const open = await this.prisma.attendanceSession.findFirst({ where: { employmentId: me.id, clockOut: null } });
    if (!open) throw new ConflictException('You are not clocked in');
    const { count } = await this.prisma.attendanceSession.updateMany({ where: { id: open.id, clockOut: null }, data: { clockOut: new Date() } });
    if (count === 0) throw new ConflictException('You are not clocked in');
    return presentSession(await this.prisma.attendanceSession.findUniqueOrThrow({ where: { id: open.id } }));
  }

  private checkEditable(timeZone: string, date: IsoDate) {
    const today = localDate(timeZone);
    if (date > today) throw new BadRequestException('That date is in the future');
    if (date < addDays(today, -EDIT_DAYS)) throw new BadRequestException(`Only the last ${EDIT_DAYS} days can be changed. Ask HR to correct older records.`);
  }

  /** Corrects a session's times, e.g. a forgotten clock-out. The change is marked as edited for the manager. */
  async editSession(auth: AuthContext, id: string, dto: EditSessionDto) {
    const me = await this.me(auth);
    const s = await this.prisma.attendanceSession.findFirst({ where: { id, employmentId: me.id } });
    if (!s) throw new NotFoundException('Session not found');
    const tz = me.legalEntity.timeZone;
    const clockIn = new Date(dto.clockIn);
    const clockOut = new Date(dto.clockOut);
    this.checkEditable(tz, toIso(s.date));
    if (localDate(tz, clockIn) !== toIso(s.date)) throw new BadRequestException('The clock-in time must stay on the same day');
    if (clockOut <= clockIn) throw new BadRequestException('Clock-out must be after clock-in');
    if (clockOut.getTime() - clockIn.getTime() > MAX_SESSION_HOURS * HOUR) throw new BadRequestException(`A session can be at most ${MAX_SESSION_HOURS} hours`);
    if (clockOut > new Date()) throw new BadRequestException('Clock-out cannot be in the future');
    const overlap = await this.prisma.attendanceSession.findFirst({
      where: { employmentId: me.id, id: { not: id }, clockIn: { lt: clockOut }, OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }] },
    });
    if (overlap) throw new BadRequestException('Those times overlap another session');
    const updated = await this.prisma.attendanceSession.update({ where: { id }, data: { clockIn, clockOut, autoClosed: false, editedAt: new Date(), editReason: dto.reason } });
    return presentSession(updated);
  }

  private async checkDayTotal(employmentId: string, date: IsoDate, hours: number, exceptId?: string) {
    const agg = await this.prisma.workLog.aggregate({ where: { employmentId, date: fromIso(date), ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { hours: true } });
    if (Number(agg._sum.hours ?? 0) + hours > 24) throw new BadRequestException('A day cannot have more than 24 hours noted');
  }

  async addLog(auth: AuthContext, dto: WorkLogDto) {
    const me = await this.me(auth);
    await this.assertModuleOn(me.legalEntity);
    this.checkEditable(me.legalEntity.timeZone, dto.date);
    await this.checkDayTotal(me.id, dto.date, dto.hours);
    const l = await this.prisma.workLog.create({ data: { employmentId: me.id, date: fromIso(dto.date), hours: dto.hours, project: dto.project, description: dto.description } });
    return presentLog(l);
  }

  async editLog(auth: AuthContext, id: string, dto: WorkLogDto) {
    const me = await this.me(auth);
    const l = await this.prisma.workLog.findFirst({ where: { id, employmentId: me.id } });
    if (!l) throw new NotFoundException('Work note not found');
    this.checkEditable(me.legalEntity.timeZone, toIso(l.date));
    this.checkEditable(me.legalEntity.timeZone, dto.date);
    await this.checkDayTotal(me.id, dto.date, dto.hours, id);
    return presentLog(await this.prisma.workLog.update({ where: { id }, data: { date: fromIso(dto.date), hours: dto.hours, project: dto.project, description: dto.description } }));
  }

  async deleteLog(auth: AuthContext, id: string) {
    const me = await this.me(auth);
    const l = await this.prisma.workLog.findFirst({ where: { id, employmentId: me.id } });
    if (!l) throw new NotFoundException('Work note not found');
    this.checkEditable(me.legalEntity.timeZone, toIso(l.date));
    await this.prisma.workLog.delete({ where: { id } });
    return { deleted: true };
  }

  /** Approved leave days per employment in a range */
  private async approvedLeave(employmentIds: string[], start: IsoDate, end: IsoDate) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employmentId: { in: employmentIds }, status: LeaveStatus.APPROVED, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) } },
      select: { employmentId: true, startDate: true, endDate: true },
    });
    const map = new Map<string, Set<IsoDate>>();
    for (const r of rows) {
      const from = toIso(r.startDate) < start ? start : toIso(r.startDate);
      const to = toIso(r.endDate) > end ? end : toIso(r.endDate);
      const set = map.get(r.employmentId) ?? new Set<IsoDate>();
      for (const d of eachDay(from, to)) set.add(d);
      map.set(r.employmentId, set);
    }
    return map;
  }

  /** Companies whose whole activity the caller may read (HR and Payroll) */
  private companyIds(auth: AuthContext) {
    return [...new Set(WHOLE_COMPANY.flatMap((p) => entityIds(auth, p)))];
  }

  /** The company asked for, or the caller's own, or the first they cover; Not found outside their scope */
  private async company(auth: AuthContext, entityId?: string): Promise<Entity> {
    const allowed = this.companyIds(auth);
    let id = entityId;
    if (id && !allowed.includes(id)) throw new NotFoundException('Company not found');
    if (!id) {
      const own = await this.prisma.employment.findFirst({ where: { userId: auth.userId, legalEntityId: { in: allowed } }, select: { legalEntityId: true } });
      id = own?.legalEntityId ?? allowed[0];
    }
    if (!id) throw new NotFoundException('Company not found');
    return this.prisma.legalEntity.findUniqueOrThrow({ where: { id }, select: ENTITY });
  }

  /**
   * Who the viewer may see (POL-21 3.4): HR and Payroll a whole company; managers everyone below
   * them in the reporting line.
   */
  private async scope(auth: AuthContext, entityId?: string): Promise<{ where: Prisma.EmploymentWhereInput; entity: Entity; wholeCompany: boolean }> {
    if (this.companyIds(auth).length) {
      const entity = await this.company(auth, entityId);
      return { where: { legalEntityId: entity.id }, entity, wholeCompany: true };
    }
    if (can(auth.access, 'team.read')) {
      const me = await this.me(auth);
      const team = await this.access.team(auth);
      return { where: { id: { in: [...team.keys()] } }, entity: me.legalEntity, wholeCompany: false };
    }
    throw new ForbiddenException('Only managers, HR and Payroll can see team activity');
  }

  async team(auth: AuthContext, q: TeamQuery) {
    const { where, entity, wholeCompany } = await this.scope(auth, q.entityId);
    const date = q.date ?? localDate(entity.timeZone);
    const words = (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const people = await this.prisma.employment.findMany({
      where: {
        ...where,
        hireDate: { lte: fromIso(date) },
        OR: [{ endDate: null }, { endDate: { gte: fromIso(date) } }],
        AND: words.map((w) => ({
          OR: [
            { person: { firstName: { contains: w, mode: 'insensitive' as const } } },
            { person: { lastName: { contains: w, mode: 'insensitive' as const } } },
            { employeeNumber: { contains: w, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: { id: true, employeeNumber: true, userId: true, person: { select: { firstName: true, lastName: true } }, assignments: { where: inForce(fromIso(date)), take: 1, select: { jobTitle: true } } },
      orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }],
    });
    const ids = people.map((p) => p.id);
    await this.closeForgotten(ids);
    const weekStart = mondayOf(date);
    const [sessions, weekSessions, logs, leave] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employmentId: { in: ids }, date: fromIso(date) }, orderBy: { clockIn: 'asc' } }),
      this.prisma.attendanceSession.findMany({ where: { employmentId: { in: ids }, date: { gte: fromIso(weekStart), lte: fromIso(date) } } }),
      this.prisma.workLog.findMany({ where: { employmentId: { in: ids }, date: fromIso(date) }, orderBy: { createdAt: 'asc' } }),
      this.approvedLeave(ids, date, date),
    ]);
    const rows = people.map((p) => {
      const s = sessions.filter((x) => x.employmentId === p.id);
      const open = s.find((x) => !x.clockOut);
      const status = open ? 'IN' : s.length ? 'OUT' : leave.get(p.id)?.has(date) ? 'ON_LEAVE' : 'NOT_STARTED';
      return {
        id: p.id,
        name: fullName(p.person),
        employeeNumber: p.employeeNumber,
        jobTitle: p.assignments[0]?.jobTitle ?? null,
        hasLogin: !!p.userId,
        status,
        mode: (open ?? s[s.length - 1])?.mode ?? null,
        firstIn: s[0]?.clockIn ?? null,
        lastOut: open ? null : s[s.length - 1]?.clockOut ?? null,
        workedMinutes: s.reduce((sum, x) => sum + sessionMinutes(x), 0),
        weekMinutes: weekSessions.filter((x) => x.employmentId === p.id).reduce((sum, x) => sum + sessionMinutes(x), 0),
        flags: s.some((x) => x.autoClosed) ? ['Forgot to clock out'] : s.some((x) => x.editedAt) ? ['Times edited'] : [],
        logs: logs.filter((x) => x.employmentId === p.id).map(presentLog),
      };
    });
    // People with activity first, then everyone else by name
    const rank = { IN: 0, OUT: 1, ON_LEAVE: 2, NOT_STARTED: 3 } as const;
    rows.sort((a, b) => rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank]);
    const shown = rows.slice(0, 200);
    return {
      date,
      wholeCompany,
      entity: { id: entity.id, code: entity.code, name: entity.name },
      timeZone: entity.timeZone,
      summary: {
        people: rows.length,
        in: rows.filter((r) => r.status === 'IN').length,
        out: rows.filter((r) => r.status === 'OUT').length,
        onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length,
      },
      rows: shown,
      truncated: rows.length > shown.length,
    };
  }

  /** Monthly hours per employee for HR and Payroll; CSV for spreadsheets */
  async report(auth: AuthContext, q: ActivityReportQuery) {
    if (!this.companyIds(auth).length) throw new ForbiddenException('Only HR and Payroll can export the monthly report');
    const entity = await this.company(auth, q.entityId);
    const [y, m] = q.month.split('-').map(Number);
    const start = `${q.month}-01`;
    const end = toIso(new Date(Date.UTC(y, m, 0)));
    const range = { gte: fromIso(start), lte: fromIso(end) };
    const who = { select: { id: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } } } };
    const [sessions, logs, holidays] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employment: { legalEntityId: entity.id }, date: range }, include: { employment: who } }),
      this.prisma.workLog.findMany({ where: { employment: { legalEntityId: entity.id }, date: range }, include: { employment: who } }),
      this.leave.holidaySet(entity.countryCode, start, end),
    ]);
    const expected = workingDays(start, end, entity.weekendDays, new Set(holidays.keys())).length * DAY_HOURS;
    type Row = { employeeNumber: string; name: string; days: Set<string>; minutes: number; logged: number; autoClosed: number; edited: number };
    const byId = new Map<string, Row>();
    const row = (e: { id: string; employeeNumber: string; person: { firstName: string; lastName: string } }) => {
      let r = byId.get(e.id);
      if (!r) byId.set(e.id, (r = { employeeNumber: e.employeeNumber, name: fullName(e.person), days: new Set(), minutes: 0, logged: 0, autoClosed: 0, edited: 0 }));
      return r;
    };
    for (const s of sessions) {
      const r = row(s.employment);
      r.days.add(toIso(s.date));
      r.minutes += sessionMinutes(s);
      if (s.autoClosed) r.autoClosed++;
      if (s.editedAt) r.edited++;
    }
    for (const l of logs) row(l.employment).logged += Number(l.hours);
    const rows = [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        employeeNumber: r.employeeNumber,
        name: r.name,
        daysPresent: r.days.size,
        hoursWorked: Math.round(r.minutes / 6) / 10,
        hoursLogged: Math.round(r.logged * 100) / 100,
        overExpected: Math.max(0, Math.round((r.minutes / 60 - expected) * 10) / 10),
        forgotClockOut: r.autoClosed,
        edited: r.edited,
      }));
    if (q.format === 'csv') {
      const head = 'Employee number,Name,Days present,Hours worked,Hours noted,Hours above expected,Forgot to clock out,Edited sessions';
      // Leading = + - @ would make a spreadsheet run a formula
      const esc = (v: string | number) => {
        const s = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return [head, ...rows.map((r) => [r.employeeNumber, r.name, r.daysPresent, r.hoursWorked, r.hoursLogged, r.overExpected, r.forgotClockOut, r.edited].map(esc).join(','))].join('\n') + '\n';
    }
    return { month: q.month, entity: { id: entity.id, code: entity.code, name: entity.name }, expectedHours: expected, rows };
  }
}
