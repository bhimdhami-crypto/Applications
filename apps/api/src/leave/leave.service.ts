import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveRequest, LeaveStatus, LeaveType, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { isHrEditor, profileAccess } from '../profiles/profile-access';
import { ProfilesService, UploadedFileLike } from '../profiles/profiles.service';
import { eachDay, fromIso, IsoDate, toIso, workingDays } from './calendar';
import { CreateAdjustmentDto, CreateHolidayDto, CreateLeaveDto } from './leave.dto';
import {
  ANNUAL_CARRY_OVER_MAX,
  annualEntitlement,
  LEAVE_TYPES,
  leaveTypeInfo,
  perRequestLimit,
  PersonForLeave,
  SICK_CERTIFICATE_AFTER_DAYS,
  SICK_FULL_PAY_DAYS,
  SICK_HALF_PAY_DAYS,
  TRACKING_FROM_YEAR,
  yearlyAllowance,
} from './leave-rules';
import { publicHolidays } from './public-holidays';

const OPEN: LeaveStatus[] = [LeaveStatus.PENDING_MANAGER, LeaveStatus.PENDING_HR];
const COUNTED: LeaveStatus[] = [...OPEN, LeaveStatus.APPROVED];
const SEES_ALL: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL];

const EMPLOYEE_FOR_LEAVE = {
  id: true,
  firstName: true,
  lastName: true,
  employeeNo: true,
  hireDate: true,
  dateOfBirth: true,
  userId: true,
  managerId: true,
  deletedAt: true,
  status: true,
  company: { select: { countryCode: true, name: true } },
  user: { select: { email: true, isActive: true } },
  manager: { select: { id: true, firstName: true, userId: true, user: { select: { email: true, isActive: true } } } },
} satisfies Prisma.EmployeeSelect;
type LeaveEmployee = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_FOR_LEAVE }>;

const REQUEST_INCLUDE = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, managerId: true, userId: true, company: { select: { countryCode: true, name: true } } } },
} satisfies Prisma.LeaveRequestInclude;

const person = (e: { hireDate: Date; dateOfBirth: Date | null; company: { countryCode: string } }): PersonForLeave => ({
  countryCode: e.company.countryCode,
  hireDate: e.hireDate,
  dateOfBirth: e.dateOfBirth,
});
const yearOf = (d: Date) => d.getUTCFullYear();
const today = () => toIso(new Date());
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const describe = (r: { type: LeaveType; startDate: Date; endDate: Date; days: number }) =>
  `${leaveTypeInfo(r.type).label}, ${toIso(r.startDate)} to ${toIso(r.endDate)} (${r.days} working day${r.days === 1 ? '' : 's'})`;

export interface Balance {
  type: LeaveType;
  label: string;
  /** Allowance for the year (null: limited per request instead) */
  entitlement: number | null;
  carriedOver: number;
  adjustment: number;
  approved: number;
  pending: number;
  /** Days still free to request: allowance + carry-over + adjustments - approved - pending */
  left: number | null;
}

/**
 * Leave requests, approvals, balances and the public holiday calendar.
 * Requests go to the employee's manager, then to HR for the types that need it.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly profiles: ProfilesService,
  ) {}

  types() {
    return LEAVE_TYPES;
  }

  // ---------- public holidays ----------

  /** Creates the draft calendar for a country and year the first time it is needed. */
  async ensureHolidays(countryCode: string, year: number) {
    const count = await this.prisma.publicHoliday.count({
      where: { countryCode, date: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
    });
    if (count > 0) return;
    const list = publicHolidays(countryCode, year);
    if (list.length === 0) return;
    await this.prisma.publicHoliday.createMany({
      data: list.map((h) => ({ countryCode, date: fromIso(h.date), name: h.name })),
      skipDuplicates: true,
    });
  }

  async holidays(countryCode: string, year: number) {
    await this.ensureHolidays(countryCode, year);
    return this.prisma.publicHoliday.findMany({
      where: { countryCode, date: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
      orderBy: { date: 'asc' },
    });
  }

  async addHoliday(actor: AuthUser, dto: CreateHolidayDto) {
    await this.ensureHolidays(dto.countryCode, Number(dto.date.slice(0, 4)));
    const date = fromIso(dto.date.slice(0, 10));
    const exists = await this.prisma.publicHoliday.findUnique({ where: { countryCode_date: { countryCode: dto.countryCode, date } } });
    if (exists) throw new ConflictException(`${dto.date.slice(0, 10)} is already a holiday (${exists.name})`);
    const h = await this.prisma.publicHoliday.create({ data: { countryCode: dto.countryCode, date, name: dto.name } });
    await this.audit.record(actor.id, 'holiday.add', 'PublicHoliday', h.id, { countryCode: h.countryCode, date: dto.date, name: dto.name });
    return h;
  }

  async removeHoliday(actor: AuthUser, id: string) {
    const h = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.prisma.publicHoliday.delete({ where: { id } });
    await this.audit.record(actor.id, 'holiday.remove', 'PublicHoliday', id, { countryCode: h.countryCode, date: toIso(h.date), name: h.name });
    return { id, deleted: true };
  }

  async holidaySet(countryCode: string, start: IsoDate, end: IsoDate) {
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) await this.ensureHolidays(countryCode, y);
    const rows = await this.prisma.publicHoliday.findMany({ where: { countryCode, date: { gte: fromIso(start), lte: fromIso(end) } } });
    return new Map(rows.map((h) => [toIso(h.date), h.name]));
  }

  /** Working days in a date range for a country, with the holidays it skips */
  async countDays(countryCode: string, start: IsoDate, end: IsoDate) {
    const holidays = await this.holidaySet(countryCode, start, end);
    const days = workingDays(start, end, countryCode, new Set(holidays.keys()));
    const skipped = [...holidays.entries()].filter(([d]) => d >= start && d <= end).map(([date, name]) => ({ date, name }));
    return { days: days.length, holidays: skipped };
  }

  async preview(actor: AuthUser, startDate: string, endDate: string, employeeId?: string) {
    const employee = await this.targetEmployee(actor, employeeId);
    const { start, end } = checkRange(startDate, endDate);
    return this.countDays(employee.company.countryCode, start, end);
  }

  // ---------- balances ----------

  async balances(actor: AuthUser, employeeId: string | undefined, year: number) {
    const employee = await this.visibleEmployee(actor, employeeId);
    return this.balancesFor(employee, year);
  }

  async balancesFor(employee: Pick<LeaveEmployee, 'id' | 'hireDate' | 'dateOfBirth' | 'company'>, year: number): Promise<Balance[]> {
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: employee.id, status: { in: COUNTED }, startDate: { gte: fromIso(`${Math.min(year, TRACKING_FROM_YEAR)}-01-01`), lte: fromIso(`${year}-12-31`) } },
        select: { type: true, status: true, startDate: true, days: true },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employeeId: employee.id, year: { lte: year } }, select: { type: true, year: true, days: true } }),
    ]);
    const p = person(employee);
    const used = (type: LeaveType, y: number, statuses: LeaveStatus[]) =>
      requests.filter((r) => r.type === type && yearOf(r.startDate) === y && statuses.includes(r.status)).reduce((s, r) => s + r.days, 0);
    const adjusted = (type: LeaveType, y: number) => adjustments.filter((a) => a.type === type && a.year === y).reduce((s, a) => s + a.days, 0);

    const annualTotal = (y: number): number => annualEntitlement(p, y) + carry(y) + adjusted(LeaveType.ANNUAL, y);
    const carry = (y: number): number => {
      if (y - 1 < TRACKING_FROM_YEAR || annualEntitlement(p, y - 1) === 0) return 0;
      return Math.min(ANNUAL_CARRY_OVER_MAX, Math.max(0, annualTotal(y - 1) - used(LeaveType.ANNUAL, y - 1, [LeaveStatus.APPROVED])));
    };

    return LEAVE_TYPES.map((t): Balance => {
      const approved = used(t.type, year, [LeaveStatus.APPROVED]);
      const pending = used(t.type, year, OPEN);
      const adjustment = adjusted(t.type, year);
      if (t.type === LeaveType.ANNUAL) {
        const entitlement = annualEntitlement(p, year);
        const carriedOver = carry(year);
        return { type: t.type, label: t.label, entitlement, carriedOver, adjustment, approved, pending, left: entitlement + carriedOver + adjustment - approved - pending };
      }
      if (!t.yearly) return { type: t.type, label: t.label, entitlement: null, carriedOver: 0, adjustment, approved, pending, left: null };
      const entitlement = yearlyAllowance(t.type);
      return { type: t.type, label: t.label, entitlement, carriedOver: 0, adjustment, approved, pending, left: entitlement + adjustment - approved - pending };
    });
  }

  /** Annual leave left (approved leave only) for many employees at once, for payslips */
  async annualLeftMany(employees: Array<{ id: string; hireDate: Date; dateOfBirth: Date | null; company: { countryCode: string } }>, year: number) {
    const ids = employees.map((e) => e.id);
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: { gte: fromIso(`${Math.min(year, TRACKING_FROM_YEAR)}-01-01`), lte: fromIso(`${year}-12-31`) } },
        select: { employeeId: true, startDate: true, days: true },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employeeId: { in: ids }, type: LeaveType.ANNUAL, year: { lte: year } }, select: { employeeId: true, year: true, days: true } }),
    ]);
    const usedBy = new Map<string, number>();
    for (const r of requests) usedBy.set(`${r.employeeId}:${yearOf(r.startDate)}`, (usedBy.get(`${r.employeeId}:${yearOf(r.startDate)}`) ?? 0) + r.days);
    const adjBy = new Map<string, number>();
    for (const a of adjustments) adjBy.set(`${a.employeeId}:${a.year}`, (adjBy.get(`${a.employeeId}:${a.year}`) ?? 0) + a.days);

    const result = new Map<string, number>();
    for (const e of employees) {
      const p = person(e);
      const total = (y: number): number => {
        const carry = y - 1 < TRACKING_FROM_YEAR || annualEntitlement(p, y - 1) === 0
          ? 0
          : Math.min(ANNUAL_CARRY_OVER_MAX, Math.max(0, total(y - 1) - (usedBy.get(`${e.id}:${y - 1}`) ?? 0)));
        return annualEntitlement(p, y) + carry + (adjBy.get(`${e.id}:${y}`) ?? 0);
      };
      result.set(e.id, total(year) - (usedBy.get(`${e.id}:${year}`) ?? 0));
    }
    return result;
  }

  async addAdjustment(actor: AuthUser, dto: CreateAdjustmentDto) {
    const employee = await this.findEmployee(dto.employeeId);
    const adj = await this.prisma.leaveAdjustment.create({ data: { ...dto, employeeId: employee.id, createdById: actor.id } });
    await this.audit.record(actor.id, 'leave.adjust', 'Employee', employee.id, { type: dto.type, year: dto.year, days: dto.days, reason: dto.reason });
    return adj;
  }

  // ---------- requests ----------

  async list(actor: AuthUser, employeeId: string | undefined, year: number) {
    const employee = await this.visibleEmployee(actor, employeeId);
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: employee.id, startDate: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employeeId: employee.id, year }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      employee: { id: employee.id, name: fullName(employee), employeeNo: employee.employeeNo, countryCode: employee.company.countryCode, company: employee.company.name },
      requests: requests.map((r) => this.withActions(actor, r, employee)),
      adjustments,
    };
  }

  async create(actor: AuthUser, dto: CreateLeaveDto, file?: UploadedFileLike) {
    const employee = await this.targetEmployee(actor, dto.employeeId);
    const recordingForOther = employee.userId !== actor.id;
    const hr = isHrEditor(actor);
    const info = leaveTypeInfo(dto.type);
    const { start, end } = checkRange(dto.startDate, dto.endDate);
    if (start.slice(0, 4) !== end.slice(0, 4)) throw new BadRequestException('Leave cannot cross into a new year. Split it into two requests.');
    if (!hr && !info.backdated && start < today()) throw new BadRequestException(`${info.label} must start today or later`);
    if (toIso(employee.hireDate) > start) throw new BadRequestException('Leave cannot start before the employee joined');

    const { days } = await this.countDays(employee.company.countryCode, start, end);
    if (days === 0) throw new BadRequestException('Those dates are all weekends or public holidays, so no leave is needed');
    const limit = perRequestLimit(dto.type, employee.company.countryCode);
    if (limit !== null && days > limit) throw new BadRequestException(`${info.label} is limited to ${limit} working days per request`);

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { employeeId: employee.id, status: { in: COUNTED }, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) } },
    });
    if (overlap) throw new ConflictException(`This overlaps ${describe(overlap)}, which is ${overlap.status === LeaveStatus.APPROVED ? 'approved' : 'waiting for approval'}`);

    // Sick leave can run past its allowance (half pay, then unpaid); the other yearly types cannot
    if (info.yearly && dto.type !== LeaveType.SICK) {
      const balance = (await this.balancesFor(employee, Number(start.slice(0, 4)))).find((b) => b.type === dto.type)!;
      if (balance.left !== null && days > balance.left) {
        throw new BadRequestException(`Only ${Math.max(0, balance.left)} day${balance.left === 1 ? '' : 's'} of ${info.label.toLowerCase()} left for ${start.slice(0, 4)}, and this needs ${days}`);
      }
    }
    if (dto.type === LeaveType.SICK && days > SICK_CERTIFICATE_AFTER_DAYS && !file && !hr) {
      throw new BadRequestException(`Attach a medical certificate for sick leave longer than ${SICK_CERTIFICATE_AFTER_DAYS} days`);
    }

    let documentId: string | undefined;
    if (file) {
      const docType = dto.type === LeaveType.SICK ? 'Medical certificate (sick leave)' : 'Leave supporting document';
      const doc = await this.profiles.uploadDocument(actor, employee.id, { type: docType, issuedDate: start }, file);
      documentId = doc.id;
    }

    // HR recording leave for someone else approves it at once
    const manager = employee.manager && employee.manager.user?.isActive && employee.manager.userId !== employee.userId ? employee.manager : null;
    const status = recordingForOther && hr ? LeaveStatus.APPROVED : manager ? LeaveStatus.PENDING_MANAGER : LeaveStatus.PENDING_HR;
    const now = new Date();
    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        type: dto.type,
        startDate: fromIso(start),
        endDate: fromIso(end),
        days,
        reason: dto.reason || null,
        handoverTo: dto.handoverTo || null,
        contactWhileAway: dto.contactWhileAway || null,
        documentId,
        status,
        approverId: manager?.id ?? null,
        createdById: actor.id,
        ...(status === LeaveStatus.APPROVED ? { hrById: actor.id, hrAt: now, hrNote: 'Recorded by HR' } : {}),
      },
    });
    await this.audit.record(actor.id, 'leave.request', 'LeaveRequest', request.id, { employeeId: employee.id, type: dto.type, start, end, days, status });

    const what = describe(request);
    if (status === LeaveStatus.PENDING_MANAGER) {
      await this.mail.send({
        to: manager!.user!.email,
        subject: `Leave request from ${fullName(employee)}`,
        text: `Hello ${manager!.firstName},\n\n${fullName(employee)} asked for ${what}.\nPlease approve or decline it in the HR portal within 3 working days.`,
      });
    } else if (status === LeaveStatus.PENDING_HR) {
      await this.mailHr(`Leave request from ${fullName(employee)}`, `${fullName(employee)} (${employee.company.name}) asked for ${what}.\nThey have no manager in the portal, so HR decides. Open Leave approvals in the HR portal.`);
    } else if (employee.user?.isActive && employee.userId !== actor.id) {
      await this.mail.send({ to: employee.user.email, subject: 'Leave recorded', text: `Hello ${employee.firstName},\n\nHR recorded ${what} for you.` });
    }
    return this.withActions(actor, request, employee);
  }

  async decide(actor: AuthUser, id: string, approve: boolean, note?: string) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Leave request not found');
    const employee = await this.findEmployee(request.employeeId);
    const mine = await this.actorEmployeeId(actor);
    if (employee.userId === actor.id) throw new ForbiddenException('You cannot approve your own leave');
    const hr = isHrEditor(actor);
    const info = leaveTypeInfo(request.type);
    const now = new Date();
    let data: Prisma.LeaveRequestUpdateInput;

    if (request.status === LeaveStatus.PENDING_MANAGER) {
      const isApprover = !!mine && request.approverId === mine;
      if (!isApprover && !hr) throw new ForbiddenException('Only their manager or HR can decide this request');
      const managerStep = { managerById: actor.id, managerAt: now, managerNote: note || null };
      if (!approve) data = { ...managerStep, status: LeaveStatus.DECLINED };
      // HR deciding at the manager step settles both steps
      else if (hr) data = { ...managerStep, hrById: actor.id, hrAt: now, status: LeaveStatus.APPROVED };
      else data = { ...managerStep, status: info.hrApproval ? LeaveStatus.PENDING_HR : LeaveStatus.APPROVED };
    } else if (request.status === LeaveStatus.PENDING_HR) {
      if (!hr) throw new ForbiddenException('Only HR can decide this request');
      data = { hrById: actor.id, hrAt: now, hrNote: note || null, status: approve ? LeaveStatus.APPROVED : LeaveStatus.DECLINED };
    } else {
      throw new ConflictException(`This request is already ${request.status.toLowerCase()}`);
    }

    // Guard against two people deciding at the same moment
    const { count } = await this.prisma.leaveRequest.updateMany({ where: { id, status: request.status }, data: data as Prisma.LeaveRequestUpdateManyMutationInput });
    if (count === 0) throw new ConflictException('Someone else decided this request a moment ago. Refresh to see it.');
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    await this.audit.record(actor.id, approve ? 'leave.approve' : 'leave.decline', 'LeaveRequest', id, { status: updated.status, note: note ?? null });

    const what = describe(updated);
    if (updated.status === LeaveStatus.PENDING_HR) {
      await this.mailHr(`Leave waiting for HR: ${fullName(employee)}`, `${fullName(employee)}'s manager approved ${what}.\n${info.label} also needs HR approval. Open Leave approvals in the HR portal.`);
    } else if (employee.user?.isActive) {
      const verdict = updated.status === LeaveStatus.APPROVED ? 'approved' : 'declined';
      await this.mail.send({
        to: employee.user.email,
        subject: `Your leave was ${verdict}`,
        text: `Hello ${employee.firstName},\n\nYour request for ${what} was ${verdict}.${note ? `\nNote: ${note}` : ''}`,
      });
    }
    return this.withActions(actor, updated, employee);
  }

  async cancel(actor: AuthUser, id: string) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Leave request not found');
    const employee = await this.findEmployee(request.employeeId);
    if (!this.canCancel(actor, request, employee)) throw new ForbiddenException('This request cannot be cancelled');
    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id, status: request.status },
      data: { status: LeaveStatus.CANCELLED, cancelledById: actor.id, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('This request changed a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, 'leave.cancel', 'LeaveRequest', id);
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    // Tell the manager if they had already approved or were about to decide
    if (request.approverId && employee.manager?.user?.isActive && employee.manager.userId !== actor.id) {
      await this.mail.send({ to: employee.manager.user.email, subject: `Leave cancelled: ${fullName(employee)}`, text: `${fullName(employee)}'s ${describe(request)} was cancelled.` });
    }
    return this.withActions(actor, updated, employee);
  }

  /** Requests waiting for the signed-in person: their team's, and HR's queue for HR */
  async approvals(actor: AuthUser) {
    const mine = await this.actorEmployeeId(actor);
    const or: Prisma.LeaveRequestWhereInput[] = [];
    if (mine) or.push({ status: LeaveStatus.PENDING_MANAGER, approverId: mine });
    if (isHrEditor(actor)) or.push({ status: LeaveStatus.PENDING_HR });
    if (or.length === 0) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: { OR: or, employee: { userId: { not: actor.id } } },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const memo = new Map<string, Promise<{ days: number }>>();
    return Promise.all(
      rows.map(async (r) => {
        const key = `${r.employee.company.countryCode}:${toIso(r.createdAt)}`;
        if (!memo.has(key)) memo.set(key, this.countDays(r.employee.company.countryCode, toIso(r.createdAt), today()));
        const waiting = await memo.get(key)!;
        // The day it arrived does not count towards the 3-working-day target
        const waitingDays = Math.max(0, waiting.days - 1);
        return { ...r, waitingDays, overdue: waitingDays > 3 };
      }),
    );
  }

  /**
   * Who is away in a month. HR, payroll and admins see a whole company; managers see their
   * team; everyone else sees their own leave and when teammates are away (without the type).
   */
  async calendar(actor: AuthUser, month: string, companyId?: string) {
    const start = `${month}-01`;
    const end = toIso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, include: { company: true } });
    let where: Prisma.EmployeeWhereInput;
    let countryCode: string;
    let showDetail: (employeeId: string) => boolean;

    if (SEES_ALL.includes(actor.role)) {
      const company = companyId
        ? await this.prisma.company.findUnique({ where: { id: companyId } })
        : me?.company ?? (await this.prisma.company.findFirst({ where: { countryCode: { not: 'US' } }, orderBy: { code: 'asc' } }));
      if (!company) throw new BadRequestException('Unknown company');
      where = { companyId: company.id };
      countryCode = company.countryCode;
      showDetail = () => true;
    } else {
      if (!me) throw new ForbiddenException('Your login is not linked to an employee record');
      countryCode = me.company.countryCode;
      if (actor.role === Role.MANAGER) {
        where = { OR: [{ id: me.id }, { managerId: me.id }] };
        showDetail = () => true;
      } else {
        where = { OR: [{ id: me.id }, ...(me.managerId ? [{ managerId: me.managerId }, { id: me.managerId }] : [])] };
        showDetail = (id) => id === me.id;
      }
    }

    const [holidays, requests] = await Promise.all([
      this.holidaySet(countryCode, start, end),
      this.prisma.leaveRequest.findMany({
        where: { status: { in: COUNTED }, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) }, employee: { ...where, deletedAt: null } },
        include: REQUEST_INCLUDE,
        orderBy: [{ startDate: 'asc' }],
        take: 2000,
      }),
    ]);
    return {
      month,
      countryCode,
      days: eachDay(start, end),
      holidays: [...holidays.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date)),
      entries: requests
        .filter((r) => showDetail(r.employeeId) || r.status === LeaveStatus.APPROVED)
        .map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: fullName(r.employee),
          startDate: toIso(r.startDate),
          endDate: toIso(r.endDate),
          days: r.days,
          // Colleagues only see that someone is away, not why
          type: showDetail(r.employeeId) ? r.type : null,
          status: showDetail(r.employeeId) ? r.status : LeaveStatus.APPROVED,
        })),
    };
  }

  /**
   * Days in a pay period that reduce pay: approved unpaid leave, and sick leave past the
   * full-pay allowance (the next 30 days on half pay, any beyond that unpaid).
   */
  async payCuts(employeeIds: string[], countryCode: string, periodStart: IsoDate, periodEnd: IsoDate) {
    const year = periodStart.slice(0, 4);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: LeaveStatus.APPROVED,
        type: { in: [LeaveType.UNPAID, LeaveType.SICK] },
        startDate: { gte: fromIso(`${year}-01-01`), lte: fromIso(periodEnd) },
      },
      orderBy: { startDate: 'asc' },
    });
    const cuts = new Map<string, { unpaidDays: number; halfPayDays: number }>();
    if (requests.length === 0) return cuts;
    const holidays = new Set((await this.holidaySet(countryCode, `${year}-01-01`, periodEnd)).keys());
    const sickSoFar = new Map<string, number>();
    for (const r of requests) {
      const cut = cuts.get(r.employeeId) ?? { unpaidDays: 0, halfPayDays: 0 };
      for (const day of workingDays(toIso(r.startDate), toIso(r.endDate), countryCode, holidays)) {
        let unpaid = false;
        let half = false;
        if (r.type === LeaveType.UNPAID) unpaid = true;
        else {
          const n = (sickSoFar.get(r.employeeId) ?? 0) + 1;
          sickSoFar.set(r.employeeId, n);
          half = n > SICK_FULL_PAY_DAYS && n <= SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS;
          unpaid = n > SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS;
        }
        if (day < periodStart || day > periodEnd) continue;
        if (unpaid) cut.unpaidDays += 1;
        if (half) cut.halfPayDays += 1;
      }
      if (cut.unpaidDays || cut.halfPayDays) cuts.set(r.employeeId, cut);
    }
    return cuts;
  }

  // ---------- helpers ----------

  private withActions(actor: AuthUser, r: LeaveRequest, employee: { userId: string | null }) {
    return { ...r, canCancel: this.canCancel(actor, r, employee) };
  }

  private canCancel(actor: AuthUser, r: LeaveRequest, employee: { userId: string | null }) {
    if (r.status === LeaveStatus.CANCELLED || r.status === LeaveStatus.DECLINED) return false;
    if (isHrEditor(actor)) return true;
    if (employee.userId !== actor.id) return false;
    return OPEN.includes(r.status) || toIso(r.startDate) > today();
  }

  private async mailHr(subject: string, text: string) {
    let people = await this.prisma.user.findMany({ where: { role: Role.HR, isActive: true }, select: { email: true } });
    if (people.length === 0) people = await this.prisma.user.findMany({ where: { role: Role.ADMIN, isActive: true }, select: { email: true } });
    for (const p of people) await this.mail.send({ to: p.email, subject, text });
  }

  private async actorEmployeeId(actor: AuthUser) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    return me?.id ?? null;
  }

  private async findEmployee(id: string): Promise<LeaveEmployee> {
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null }, select: EMPLOYEE_FOR_LEAVE });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /** The employee whose leave is being read: yourself by default, or someone you may see */
  private async visibleEmployee(actor: AuthUser, employeeId?: string) {
    if (!employeeId) return this.ownEmployee(actor);
    const employee = await this.findEmployee(employeeId);
    profileAccess(actor, employee, await this.actorEmployeeId(actor));
    return employee;
  }

  /** The employee a request is for: yourself, or anyone when HR records leave for them */
  private async targetEmployee(actor: AuthUser, employeeId?: string) {
    if (!employeeId) return this.ownEmployee(actor);
    const employee = await this.findEmployee(employeeId);
    if (employee.userId === actor.id) return employee;
    if (!isHrEditor(actor)) throw new ForbiddenException('Only HR can record leave for someone else');
    return employee;
  }

  private async ownEmployee(actor: AuthUser) {
    const me = await this.prisma.employee.findFirst({ where: { userId: actor.id, deletedAt: null }, select: EMPLOYEE_FOR_LEAVE });
    if (!me) throw new ForbiddenException('Your login is not linked to an employee record');
    return me;
  }
}

function checkRange(startDate: string, endDate: string) {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (end < start) throw new BadRequestException('The end date is before the start date');
  if (eachDay(start, end).length > 366) throw new BadRequestException('Leave cannot be longer than a year');
  return { start, end };
}
