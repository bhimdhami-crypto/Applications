import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSession, LeaveStatus, Prisma, Role, WorkLog } from '@prisma/client';
import { fullName, ownPerson } from '../approvals/people';
import { AuthUser } from '../auth/decorators';
import { IsoDate, addDays, eachDay, fromIso, toIso, workingDays } from '../leave/calendar';
import { LeaveService } from '../leave/leave.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClockInDto, EditSessionDto, ReportQuery, TeamQuery, WorkLogDto } from './activity.dto';
import { AUTO_CLOSE_HOURS, DAY_HOURS, MAX_SESSION_HOURS, localDate, minutesBetween, mondayOf, zoneOf } from './time';

/** How far back an employee may correct their own times and logs */
const EDIT_DAYS = 7;
const HOUR = 3_600_000;

const sessionMinutes = (s: AttendanceSession, now = new Date()) => minutesBetween(s.clockIn, s.clockOut ?? now);

function presentSession(s: AttendanceSession) {
  return {
    id: s.id, date: toIso(s.date), clockIn: s.clockIn, clockOut: s.clockOut, mode: s.mode,
    minutes: sessionMinutes(s), autoClosed: s.autoClosed, edited: !!s.editedAt, editReason: s.editReason,
  };
}
const presentLog = (l: WorkLog) => ({ id: l.id, date: toIso(l.date), hours: Number(l.hours), project: l.project, description: l.description });

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leave: LeaveService,
  ) {}

  /** Closes sessions left open past the limit, a normal day's length after clock-in */
  private async closeForgotten(employeeIds: string[]) {
    const stale = await this.prisma.attendanceSession.findMany({
      where: { employeeId: { in: employeeIds }, clockOut: null, clockIn: { lt: new Date(Date.now() - MAX_SESSION_HOURS * HOUR) } },
    });
    for (const s of stale) {
      await this.prisma.attendanceSession.update({ where: { id: s.id }, data: { clockOut: new Date(s.clockIn.getTime() + AUTO_CLOSE_HOURS * HOUR), autoClosed: true } });
    }
  }

  /** The signed-in employee's week: sessions and work logs per day, and totals */
  async myWeek(actor: AuthUser, week?: string) {
    const me = await ownPerson(this.prisma, actor);
    const cc = me.company.countryCode;
    await this.closeForgotten([me.id]);
    const today = localDate(cc);
    const start = mondayOf(week ?? today);
    const end = addDays(start, 6);
    const [sessions, logs, holidays, leave] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employeeId: me.id, date: { gte: fromIso(start), lte: fromIso(end) } }, orderBy: { clockIn: 'asc' } }),
      this.prisma.workLog.findMany({ where: { employeeId: me.id, date: { gte: fromIso(start), lte: fromIso(end) } }, orderBy: { createdAt: 'asc' } }),
      this.leave.holidaySet(cc, start, end),
      this.approvedLeave([me.id], start, end),
    ]);
    const open = await this.prisma.attendanceSession.findFirst({ where: { employeeId: me.id, clockOut: null } });
    const working = new Set(workingDays(start, end, cc, new Set(holidays.keys())));
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
      today,
      timeZone: zoneOf(cc),
      editableFrom: addDays(today, -EDIT_DAYS),
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

  async clockIn(actor: AuthUser, dto: ClockInDto) {
    const me = await ownPerson(this.prisma, actor);
    await this.closeForgotten([me.id]);
    if (me.exitDate && toIso(me.exitDate) < localDate(me.company.countryCode)) throw new ForbiddenException('Your employment has ended');
    const open = await this.prisma.attendanceSession.findFirst({ where: { employeeId: me.id, clockOut: null } });
    if (open) throw new ConflictException('You are already clocked in');
    const s = await this.prisma.attendanceSession.create({ data: { employeeId: me.id, date: fromIso(localDate(me.company.countryCode)), clockIn: new Date(), mode: dto.mode } });
    return presentSession(s);
  }

  async clockOut(actor: AuthUser) {
    const me = await ownPerson(this.prisma, actor);
    await this.closeForgotten([me.id]);
    const open = await this.prisma.attendanceSession.findFirst({ where: { employeeId: me.id, clockOut: null } });
    if (!open) throw new ConflictException('You are not clocked in');
    const { count } = await this.prisma.attendanceSession.updateMany({ where: { id: open.id, clockOut: null }, data: { clockOut: new Date() } });
    if (count === 0) throw new ConflictException('You are not clocked in');
    return presentSession(await this.prisma.attendanceSession.findUniqueOrThrow({ where: { id: open.id } }));
  }

  private checkEditable(cc: string, date: IsoDate) {
    const today = localDate(cc);
    if (date > today) throw new BadRequestException('That date is in the future');
    if (date < addDays(today, -EDIT_DAYS)) throw new BadRequestException(`Only the last ${EDIT_DAYS} days can be changed. Ask HR to correct older records.`);
  }

  /** Corrects a session's times, e.g. a forgotten clock-out. The change is marked as edited for the manager. */
  async editSession(actor: AuthUser, id: string, dto: EditSessionDto) {
    const me = await ownPerson(this.prisma, actor);
    const s = await this.prisma.attendanceSession.findFirst({ where: { id, employeeId: me.id } });
    if (!s) throw new NotFoundException('Session not found');
    const cc = me.company.countryCode;
    const clockIn = new Date(dto.clockIn);
    const clockOut = new Date(dto.clockOut);
    this.checkEditable(cc, toIso(s.date));
    if (localDate(cc, clockIn) !== toIso(s.date)) throw new BadRequestException('The clock-in time must stay on the same day');
    if (clockOut <= clockIn) throw new BadRequestException('Clock-out must be after clock-in');
    if (clockOut.getTime() - clockIn.getTime() > MAX_SESSION_HOURS * HOUR) throw new BadRequestException(`A session can be at most ${MAX_SESSION_HOURS} hours`);
    if (clockOut > new Date()) throw new BadRequestException('Clock-out cannot be in the future');
    const overlap = await this.prisma.attendanceSession.findFirst({
      where: { employeeId: me.id, id: { not: id }, clockIn: { lt: clockOut }, OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }] },
    });
    if (overlap) throw new BadRequestException('Those times overlap another session');
    const updated = await this.prisma.attendanceSession.update({ where: { id }, data: { clockIn, clockOut, autoClosed: false, editedAt: new Date(), editReason: dto.reason } });
    return presentSession(updated);
  }

  private async checkDayTotal(employeeId: string, date: IsoDate, hours: number, exceptId?: string) {
    const agg = await this.prisma.workLog.aggregate({ where: { employeeId, date: fromIso(date), ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { hours: true } });
    if (Number(agg._sum.hours ?? 0) + hours > 24) throw new BadRequestException('A day cannot have more than 24 hours logged');
  }

  async addLog(actor: AuthUser, dto: WorkLogDto) {
    const me = await ownPerson(this.prisma, actor);
    this.checkEditable(me.company.countryCode, dto.date);
    await this.checkDayTotal(me.id, dto.date, dto.hours);
    const l = await this.prisma.workLog.create({ data: { employeeId: me.id, date: fromIso(dto.date), hours: dto.hours, project: dto.project, description: dto.description } });
    return presentLog(l);
  }

  async editLog(actor: AuthUser, id: string, dto: WorkLogDto) {
    const me = await ownPerson(this.prisma, actor);
    const l = await this.prisma.workLog.findFirst({ where: { id, employeeId: me.id } });
    if (!l) throw new NotFoundException('Work log not found');
    this.checkEditable(me.company.countryCode, toIso(l.date));
    this.checkEditable(me.company.countryCode, dto.date);
    await this.checkDayTotal(me.id, dto.date, dto.hours, id);
    return presentLog(await this.prisma.workLog.update({ where: { id }, data: { date: fromIso(dto.date), hours: dto.hours, project: dto.project, description: dto.description } }));
  }

  async deleteLog(actor: AuthUser, id: string) {
    const me = await ownPerson(this.prisma, actor);
    const l = await this.prisma.workLog.findFirst({ where: { id, employeeId: me.id } });
    if (!l) throw new NotFoundException('Work log not found');
    this.checkEditable(me.company.countryCode, toIso(l.date));
    await this.prisma.workLog.delete({ where: { id } });
    return { deleted: true };
  }

  /** Approved leave days per employee in a range */
  private async approvedLeave(employeeIds: string[], start: IsoDate, end: IsoDate) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: LeaveStatus.APPROVED, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) } },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const map = new Map<string, Set<IsoDate>>();
    for (const r of rows) {
      const from = toIso(r.startDate) < start ? start : toIso(r.startDate);
      const to = toIso(r.endDate) > end ? end : toIso(r.endDate);
      const set = map.get(r.employeeId) ?? new Set<IsoDate>();
      for (const d of eachDay(from, to)) set.add(d);
      map.set(r.employeeId, set);
    }
    return map;
  }

  /**
   * Who the viewer may see (POL-21 3.4): managers see their direct reports;
   * HR, Payroll and admins see a whole company.
   */
  private async scope(actor: AuthUser, companyId?: string): Promise<{ where: Prisma.EmployeeWhereInput; countryCode: string; companyId: string | null }> {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true, companyId: true, company: { select: { countryCode: true } } } });
    if (actor.role === Role.HR || actor.role === Role.PAYROLL || actor.role === Role.ADMIN) {
      const id = companyId ?? me?.companyId;
      const company = id ? await this.prisma.company.findUnique({ where: { id } }) : await this.prisma.company.findFirst({ where: { countryCode: 'KE' } });
      if (!company) throw new NotFoundException('Company not found');
      return { where: { companyId: company.id }, countryCode: company.countryCode, companyId: company.id };
    }
    if (actor.role === Role.MANAGER && me) return { where: { managerId: me.id }, countryCode: me.company.countryCode, companyId: null };
    throw new ForbiddenException('Only managers, HR and Payroll can see team activity');
  }

  async team(actor: AuthUser, q: TeamQuery) {
    const { where, countryCode, companyId } = await this.scope(actor, q.companyId);
    const date = q.date ?? localDate(countryCode);
    const words = (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const people = await this.prisma.employee.findMany({
      where: {
        ...where,
        deletedAt: null,
        hireDate: { lte: fromIso(date) },
        OR: [{ exitDate: null }, { exitDate: { gte: fromIso(date) } }],
        AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { employeeNo: { contains: w, mode: 'insensitive' as const } }] })),
      },
      select: { id: true, firstName: true, lastName: true, employeeNo: true, jobTitle: true, userId: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const ids = people.map((p) => p.id);
    await this.closeForgotten(ids);
    const weekStart = mondayOf(date);
    const [sessions, weekSessions, logs, leave] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employeeId: { in: ids }, date: fromIso(date) }, orderBy: { clockIn: 'asc' } }),
      this.prisma.attendanceSession.findMany({ where: { employeeId: { in: ids }, date: { gte: fromIso(weekStart), lte: fromIso(date) } } }),
      this.prisma.workLog.findMany({ where: { employeeId: { in: ids }, date: fromIso(date) }, orderBy: { createdAt: 'asc' } }),
      this.approvedLeave(ids, date, date),
    ]);
    const rows = people.map((p) => {
      const s = sessions.filter((x) => x.employeeId === p.id);
      const open = s.find((x) => !x.clockOut);
      const status = open ? 'IN' : s.length ? 'OUT' : leave.get(p.id)?.has(date) ? 'ON_LEAVE' : 'NOT_STARTED';
      return {
        id: p.id, name: fullName(p), employeeNo: p.employeeNo, jobTitle: p.jobTitle, hasLogin: !!p.userId,
        status, mode: (open ?? s[s.length - 1])?.mode ?? null,
        firstIn: s[0]?.clockIn ?? null,
        lastOut: open ? null : s[s.length - 1]?.clockOut ?? null,
        workedMinutes: s.reduce((sum, x) => sum + sessionMinutes(x), 0),
        weekMinutes: weekSessions.filter((x) => x.employeeId === p.id).reduce((sum, x) => sum + sessionMinutes(x), 0),
        flags: s.filter((x) => x.autoClosed).length ? ['Forgot to clock out'] : s.some((x) => x.editedAt) ? ['Times edited'] : [],
        logs: logs.filter((x) => x.employeeId === p.id).map(presentLog),
      };
    });
    // People with activity first, then everyone else by name
    const rank = { IN: 0, OUT: 1, ON_LEAVE: 2, NOT_STARTED: 3 } as const;
    rows.sort((a, b) => rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank]);
    const shown = rows.slice(0, 200);
    return {
      date, companyId, timeZone: zoneOf(countryCode),
      summary: { people: rows.length, in: rows.filter((r) => r.status === 'IN').length, out: rows.filter((r) => r.status === 'OUT').length, onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length },
      rows: shown,
      truncated: rows.length > shown.length,
    };
  }

  /** Monthly hours per employee for HR and Payroll; CSV for spreadsheets */
  async report(actor: AuthUser, q: ReportQuery) {
    if (actor.role === Role.MANAGER) throw new ForbiddenException('Only HR and Payroll can export the monthly report');
    const { where, countryCode } = await this.scope(actor, q.companyId);
    const [y, m] = q.month.split('-').map(Number);
    const start = `${q.month}-01`;
    const end = toIso(new Date(Date.UTC(y, m, 0)));
    const [sessions, logs, holidays] = await Promise.all([
      this.prisma.attendanceSession.findMany({ where: { employee: where, date: { gte: fromIso(start), lte: fromIso(end) } }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } }),
      this.prisma.workLog.findMany({ where: { employee: where, date: { gte: fromIso(start), lte: fromIso(end) } }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } } }),
      this.leave.holidaySet(countryCode, start, end),
    ]);
    const expected = workingDays(start, end, countryCode, new Set(holidays.keys())).length * DAY_HOURS;
    const byId = new Map<string, { employeeNo: string; name: string; days: Set<string>; minutes: number; logged: number; autoClosed: number; edited: number }>();
    const row = (e: { id: string; firstName: string; lastName: string; employeeNo: string }) => {
      let r = byId.get(e.id);
      if (!r) byId.set(e.id, (r = { employeeNo: e.employeeNo, name: fullName(e), days: new Set(), minutes: 0, logged: 0, autoClosed: 0, edited: 0 }));
      return r;
    };
    for (const s of sessions) {
      const r = row(s.employee);
      r.days.add(toIso(s.date));
      r.minutes += sessionMinutes(s);
      if (s.autoClosed) r.autoClosed++;
      if (s.editedAt) r.edited++;
    }
    for (const l of logs) row(l.employee).logged += Number(l.hours);
    const rows = [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        employeeNo: r.employeeNo, name: r.name, daysPresent: r.days.size,
        hoursWorked: Math.round(r.minutes / 6) / 10, hoursLogged: r.logged,
        overExpected: Math.max(0, Math.round((r.minutes / 60 - expected) * 10) / 10),
        forgotClockOut: r.autoClosed, edited: r.edited,
      }));
    if (q.format === 'csv') {
      const head = 'Employee ID,Name,Days present,Hours worked,Hours logged,Hours above expected,Forgot to clock out,Edited sessions';
      const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      return [head, ...rows.map((r) => [r.employeeNo, r.name, r.daysPresent, r.hoursWorked, r.hoursLogged, r.overExpected, r.forgotClockOut, r.edited].map(esc).join(','))].join('\n') + '\n';
    }
    return { month: q.month, expectedHours: expected, rows };
  }
}
