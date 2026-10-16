import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveRequest, LeaveStatus, LeaveType, Prisma, Role } from '@prisma/client';
import { can, ROLE_PERMISSIONS } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { assertEntity, entityIds } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { DocumentsService, UploadedFileLike } from '../people/documents.service';
import { inForce, PeopleAccess } from '../people/people-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { eachDay, fromIso, IsoDate, toIso, workingDays } from './calendar';
import { CreateAdjustmentDto, CreateHolidayDto, CreateLeaveDto } from './leave.dto';
import {
  ANNUAL_CARRY_OVER_MAX,
  annualEntitlement,
  LEAVE_RULE_PACK,
  LEAVE_RULES_VERSION,
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
/** Roles that can decide leave for a company; they are told about requests waiting for HR */
const HR_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes('people.manage'));

const EMPLOYMENT_FOR_LEAVE = {
  id: true,
  employeeNumber: true,
  hireDate: true,
  endDate: true,
  status: true,
  userId: true,
  legalEntityId: true,
  person: { select: { firstName: true, lastName: true, dateOfBirth: true } },
  legalEntity: { select: { id: true, code: true, name: true, countryCode: true, weekendDays: true } },
  user: { select: { email: true, isActive: true } },
} satisfies Prisma.EmploymentSelect;
type LeaveEmployment = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT_FOR_LEAVE }>;

const REQUEST_INCLUDE = {
  employment: {
    select: {
      id: true,
      employeeNumber: true,
      userId: true,
      person: { select: { firstName: true, lastName: true } },
      legalEntity: { select: { id: true, code: true, name: true, countryCode: true, weekendDays: true } },
    },
  },
  approver: { select: { id: true, person: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.LeaveRequestInclude;
type RequestWithPeople = Prisma.LeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

type Entity = { id: string; countryCode: string; weekendDays: number[] };

const person = (e: { hireDate: Date; person: { dateOfBirth: Date | null }; legalEntity: { countryCode: string } }): PersonForLeave => ({
  countryCode: e.legalEntity.countryCode,
  hireDate: e.hireDate,
  dateOfBirth: e.person.dateOfBirth,
});
const yearOf = (d: Date) => d.getUTCFullYear();
const todayIso = () => toIso(new Date());
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
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
 * Leave requests, approvals, balances and the public holiday calendar, carried over from the
 * first build. Requests go to the employee's line manager, then to HR for the types that need it.
 * HR here means people.manage for the employee's company.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly access: PeopleAccess,
    private readonly documents: DocumentsService,
  ) {}

  types() {
    return { rulePack: LEAVE_RULE_PACK, types: LEAVE_TYPES };
  }

  // ---------- public holidays ----------

  /** Creates the draft calendar for a country and year the first time it is needed (first-build countries only). */
  async ensureHolidays(countryCode: string, year: number) {
    if (!LEAVE_RULE_PACK.draftHolidayCountries.includes(countryCode)) return;
    const count = await this.prisma.publicHoliday.count({
      where: { countryCode, date: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
    });
    if (count > 0) return;
    const list = publicHolidays(countryCode, year);
    if (list.length === 0) return;
    await this.prisma.publicHoliday.createMany({
      data: list.map((h) => ({ countryCode, date: fromIso(h.date), name: h.name, source: 'DRAFT' })),
      skipDuplicates: true,
    });
  }

  async holidays(countryCode: string, year: number) {
    await this.ensureHolidays(countryCode, year);
    const rows = await this.prisma.publicHoliday.findMany({
      where: { countryCode, date: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
      orderBy: { date: 'asc' },
    });
    return {
      countryCode,
      year,
      /** True when the portal drafted this calendar and HR still has to check it against the gazette */
      drafted: LEAVE_RULE_PACK.draftHolidayCountries.includes(countryCode),
      holidays: rows.map((h) => ({ ...h, date: toIso(h.date) })),
    };
  }

  /** HR for any company in the country can maintain its holiday calendar */
  private assertHolidayEditor(auth: AuthContext, countryCode: string) {
    const ok = auth.entities.some((e) => e.countryCode === countryCode && can(auth.access, 'people.manage', e.id));
    if (!ok) throw new ForbiddenException('Only HR for a company in this country can change its holidays');
  }

  async addHoliday(auth: AuthContext, dto: CreateHolidayDto) {
    this.assertHolidayEditor(auth, dto.countryCode);
    await this.ensureHolidays(dto.countryCode, Number(dto.date.slice(0, 4)));
    const date = fromIso(dto.date.slice(0, 10));
    const exists = await this.prisma.publicHoliday.findUnique({ where: { countryCode_date: { countryCode: dto.countryCode, date } } });
    if (exists) throw new ConflictException(`${dto.date.slice(0, 10)} is already a holiday (${exists.name})`);
    const h = await this.prisma.publicHoliday.create({ data: { countryCode: dto.countryCode, date, name: dto.name, source: 'MANUAL', createdById: auth.userId } });
    await this.audit.record(auth, { action: 'leave.holiday.added', targetType: 'public_holiday', targetId: h.id, detail: { countryCode: h.countryCode, date: toIso(date), name: dto.name } });
    return { ...h, date: toIso(h.date) };
  }

  async confirmHoliday(auth: AuthContext, id: string) {
    const h = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('Holiday not found');
    this.assertHolidayEditor(auth, h.countryCode);
    const updated = await this.prisma.publicHoliday.update({ where: { id }, data: { source: 'MANUAL' } });
    await this.audit.record(auth, { action: 'leave.holiday.confirmed', targetType: 'public_holiday', targetId: id, detail: { countryCode: h.countryCode, date: toIso(h.date), name: h.name } });
    return { ...updated, date: toIso(updated.date) };
  }

  async removeHoliday(auth: AuthContext, id: string) {
    const h = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('Holiday not found');
    this.assertHolidayEditor(auth, h.countryCode);
    await this.prisma.publicHoliday.delete({ where: { id } });
    await this.audit.record(auth, { action: 'leave.holiday.removed', targetType: 'public_holiday', targetId: id, detail: { countryCode: h.countryCode, date: toIso(h.date), name: h.name } });
    return { id, deleted: true };
  }

  async holidaySet(countryCode: string, start: IsoDate, end: IsoDate) {
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) await this.ensureHolidays(countryCode, y);
    const rows = await this.prisma.publicHoliday.findMany({ where: { countryCode, date: { gte: fromIso(start), lte: fromIso(end) } } });
    return new Map(rows.map((h) => [toIso(h.date), h.name]));
  }

  /** Working days in a date range for a company, with the holidays it skips */
  async countDays(entity: Entity, start: IsoDate, end: IsoDate) {
    const holidays = await this.holidaySet(entity.countryCode, start, end);
    const days = workingDays(start, end, entity.weekendDays, new Set(holidays.keys()));
    const skipped = [...holidays.entries()].filter(([d]) => d >= start && d <= end).map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
    return { days: days.length, holidays: skipped };
  }

  async preview(auth: AuthContext, startDate: string, endDate: string, employmentId?: string) {
    const employment = await this.targetEmployment(auth, employmentId);
    const { start, end } = checkRange(startDate, endDate);
    return this.countDays(employment.legalEntity, start, end);
  }

  // ---------- balances ----------

  async balances(auth: AuthContext, employmentId: string | undefined, year: number) {
    const employment = await this.visibleEmployment(auth, employmentId);
    return { rulePack: LEAVE_RULE_PACK, year, balances: await this.balancesFor(employment, year) };
  }

  async balancesFor(e: Pick<LeaveEmployment, 'id' | 'hireDate' | 'person' | 'legalEntity'>, year: number): Promise<Balance[]> {
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employmentId: e.id, status: { in: COUNTED }, startDate: { gte: fromIso(`${Math.min(year, TRACKING_FROM_YEAR)}-01-01`), lte: fromIso(`${year}-12-31`) } },
        select: { type: true, status: true, startDate: true, days: true },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employmentId: e.id, year: { lte: year } }, select: { type: true, year: true, days: true } }),
    ]);
    const p = person(e);
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

  /** Annual leave left (approved leave only) for many employments at once, for payslips */
  async annualLeftMany(rows: Array<{ id: string; hireDate: Date; person: { dateOfBirth: Date | null }; legalEntity: { countryCode: string } }>, year: number) {
    const ids = rows.map((e) => e.id);
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employmentId: { in: ids }, type: LeaveType.ANNUAL, status: LeaveStatus.APPROVED, startDate: { gte: fromIso(`${Math.min(year, TRACKING_FROM_YEAR)}-01-01`), lte: fromIso(`${year}-12-31`) } },
        select: { employmentId: true, startDate: true, days: true },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employmentId: { in: ids }, type: LeaveType.ANNUAL, year: { lte: year } }, select: { employmentId: true, year: true, days: true } }),
    ]);
    const usedBy = new Map<string, number>();
    for (const r of requests) {
      const k = `${r.employmentId}:${yearOf(r.startDate)}`;
      usedBy.set(k, (usedBy.get(k) ?? 0) + r.days);
    }
    const adjBy = new Map<string, number>();
    for (const a of adjustments) {
      const k = `${a.employmentId}:${a.year}`;
      adjBy.set(k, (adjBy.get(k) ?? 0) + a.days);
    }
    const result = new Map<string, number>();
    for (const e of rows) {
      const p = person(e);
      const total = (y: number): number => {
        const carry =
          y - 1 < TRACKING_FROM_YEAR || annualEntitlement(p, y - 1) === 0 ? 0 : Math.min(ANNUAL_CARRY_OVER_MAX, Math.max(0, total(y - 1) - (usedBy.get(`${e.id}:${y - 1}`) ?? 0)));
        return annualEntitlement(p, y) + carry + (adjBy.get(`${e.id}:${y}`) ?? 0);
      };
      result.set(e.id, total(year) - (usedBy.get(`${e.id}:${year}`) ?? 0));
    }
    return result;
  }

  async addAdjustment(auth: AuthContext, dto: CreateAdjustmentDto) {
    const { subject } = await this.access.resolve(auth, dto.employmentId);
    if (!can(auth.access, 'people.manage', subject.legalEntityId)) throw new ForbiddenException('Only HR can adjust leave balances');
    if (subject.userId === auth.userId) throw new ForbiddenException('Someone else must adjust your own leave balance');
    const adj = await this.prisma.leaveAdjustment.create({
      data: { employmentId: subject.id, legalEntityId: subject.legalEntityId, type: dto.type, year: dto.year, days: dto.days, reason: dto.reason, createdById: auth.userId },
    });
    await this.audit.record(auth, { action: 'leave.adjusted', targetType: 'employment', targetId: subject.id, legalEntityId: subject.legalEntityId, detail: { type: dto.type, year: dto.year, days: dto.days, reason: dto.reason } });
    return adj;
  }

  // ---------- requests ----------

  async list(auth: AuthContext, employmentId: string | undefined, year: number) {
    const e = await this.visibleEmployment(auth, employmentId);
    const [requests, adjustments] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employmentId: e.id, startDate: { gte: fromIso(`${year}-01-01`), lte: fromIso(`${year}-12-31`) } },
        include: REQUEST_INCLUDE,
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.leaveAdjustment.findMany({ where: { employmentId: e.id, year }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      employee: {
        id: e.id,
        name: fullName(e.person),
        employeeNumber: e.employeeNumber,
        countryCode: e.legalEntity.countryCode,
        entity: { id: e.legalEntity.id, code: e.legalEntity.code, name: e.legalEntity.name },
        self: e.userId === auth.userId,
        hr: can(auth.access, 'people.manage', e.legalEntityId),
      },
      requests: requests.map((r) => this.present(auth, r)),
      adjustments,
    };
  }

  async create(auth: AuthContext, dto: CreateLeaveDto, file?: UploadedFileLike) {
    const e = await this.targetEmployment(auth, dto.employmentId);
    const recordingForOther = e.userId !== auth.userId;
    const hr = can(auth.access, 'people.manage', e.legalEntityId);
    const info = leaveTypeInfo(dto.type);
    const { start, end } = checkRange(dto.startDate, dto.endDate);
    await this.assertLeaveOn(e.legalEntityId, e.legalEntity.name);
    if (e.status !== 'ACTIVE' && !hr) throw new BadRequestException('This employment has ended');
    if (e.endDate && end > toIso(e.endDate)) throw new BadRequestException('Leave cannot run past the last day of employment');
    if (start.slice(0, 4) !== end.slice(0, 4)) throw new BadRequestException('Leave cannot cross into a new year. Split it into two requests.');
    if (!hr && !info.backdated && start < todayIso()) throw new BadRequestException(`${info.label} must start today or later`);
    if (toIso(e.hireDate) > start) throw new BadRequestException('Leave cannot start before the employee joined');

    const { days } = await this.countDays(e.legalEntity, start, end);
    if (days === 0) throw new BadRequestException('Those dates are all weekends or public holidays, so no leave is needed');
    const limit = perRequestLimit(dto.type, e.legalEntity.countryCode);
    if (limit !== null && days > limit) throw new BadRequestException(`${info.label} is limited to ${limit} working days per request`);

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { employmentId: e.id, status: { in: COUNTED }, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) } },
    });
    if (overlap) throw new ConflictException(`This overlaps ${describe(overlap)}, which is ${overlap.status === LeaveStatus.APPROVED ? 'approved' : 'waiting for approval'}`);

    // Sick leave can run past its allowance (half pay, then unpaid); the other yearly types cannot
    if (info.yearly && dto.type !== LeaveType.SICK) {
      const balance = (await this.balancesFor(e, Number(start.slice(0, 4)))).find((b) => b.type === dto.type)!;
      if (balance.left !== null && days > balance.left) {
        throw new BadRequestException(`Only ${Math.max(0, balance.left)} day${balance.left === 1 ? '' : 's'} of ${info.label.toLowerCase()} left for ${start.slice(0, 4)}, and this needs ${days}`);
      }
    }
    if (dto.type === LeaveType.SICK && days > SICK_CERTIFICATE_AFTER_DAYS && !file && !hr) {
      throw new BadRequestException(`Attach a medical certificate for sick leave longer than ${SICK_CERTIFICATE_AFTER_DAYS} days`);
    }

    let documentId: string | undefined;
    if (file) {
      const type = dto.type === LeaveType.SICK ? 'Medical certificate (sick leave)' : 'Leave supporting document';
      const doc = await this.documents.upload(auth, e.id, { type, issuedDate: start, hrOnly: 'false' }, file);
      documentId = doc.id;
    }

    // HR recording leave for someone else approves it at once
    const manager = recordingForOther && hr ? null : await this.lineManager(e.id, e.userId);
    const status = recordingForOther && hr ? LeaveStatus.APPROVED : manager ? LeaveStatus.PENDING_MANAGER : LeaveStatus.PENDING_HR;
    const now = new Date();
    const request = await this.prisma.leaveRequest.create({
      data: {
        employmentId: e.id,
        legalEntityId: e.legalEntityId,
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
        rulesVersion: LEAVE_RULES_VERSION,
        createdById: auth.userId,
        ...(status === LeaveStatus.APPROVED ? { hrById: auth.userId, hrAt: now, hrNote: 'Recorded by HR' } : {}),
      },
      include: REQUEST_INCLUDE,
    });
    await this.audit.record(auth, {
      action: 'leave.requested',
      targetType: 'leave_request',
      targetId: request.id,
      legalEntityId: e.legalEntityId,
      detail: { employmentId: e.id, type: dto.type, start, end, days, status, rulesVersion: LEAVE_RULES_VERSION },
    });

    const what = describe(request);
    const name = fullName(e.person);
    if (status === LeaveStatus.PENDING_MANAGER) {
      await this.mail.send({
        to: manager!.email,
        subject: `Leave request from ${name}`,
        text: `Hello ${manager!.firstName},\n\n${name} asked for ${what}.\nPlease approve or decline it in the portal within 3 working days.`,
      });
    } else if (status === LeaveStatus.PENDING_HR) {
      await this.mailHr(auth.groupId, e, `Leave request from ${name}`, `${name} (${e.legalEntity.name}) asked for ${what}.\nThey have no manager with a portal account, so HR decides. Open Leave approvals in the portal.`);
    } else if (e.user?.isActive && e.userId !== auth.userId) {
      await this.mail.send({ to: e.user.email, subject: 'Leave recorded', text: `Hello ${e.person.firstName},\n\nHR recorded ${what} for you.` });
    }
    return this.present(auth, request);
  }

  async decide(auth: AuthContext, id: string, approve: boolean, note?: string) {
    const request = await this.findRequest(auth, id);
    const e = await this.findEmployment(auth, request.employmentId);
    const mine = await this.access.ownEmploymentIds(auth);
    const hr = can(auth.access, 'people.manage', request.legalEntityId);
    const isApprover = !!request.approverId && mine.includes(request.approverId);
    if (!hr && !isApprover) throw new NotFoundException('Leave request not found');
    if (e.userId === auth.userId) throw new ForbiddenException('You cannot approve your own leave');
    const info = leaveTypeInfo(request.type);
    const now = new Date();
    let data: Prisma.LeaveRequestUpdateManyMutationInput;

    if (request.status === LeaveStatus.PENDING_MANAGER) {
      const managerStep = { managerById: auth.userId, managerAt: now, managerNote: note || null };
      if (!approve) data = { ...managerStep, status: LeaveStatus.DECLINED };
      // HR deciding at the manager step settles both steps
      else if (hr) data = { ...managerStep, hrById: auth.userId, hrAt: now, status: LeaveStatus.APPROVED };
      else data = { ...managerStep, status: info.hrApproval ? LeaveStatus.PENDING_HR : LeaveStatus.APPROVED };
    } else if (request.status === LeaveStatus.PENDING_HR) {
      if (!hr) throw new ForbiddenException('Only HR can decide this request now');
      data = { hrById: auth.userId, hrAt: now, hrNote: note || null, status: approve ? LeaveStatus.APPROVED : LeaveStatus.DECLINED };
    } else {
      throw new ConflictException(`This request is already ${request.status.toLowerCase()}`);
    }

    // Guard against two people deciding at the same moment
    const { count } = await this.prisma.leaveRequest.updateMany({ where: { id, status: request.status }, data });
    if (count === 0) throw new ConflictException('Someone else decided this request a moment ago. Refresh to see it.');
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
    await this.audit.record(auth, {
      action: approve ? 'leave.approved' : 'leave.declined',
      targetType: 'leave_request',
      targetId: id,
      legalEntityId: request.legalEntityId,
      detail: { status: updated.status, step: request.status, note: note ?? null },
    });

    const what = describe(updated);
    const name = fullName(e.person);
    if (updated.status === LeaveStatus.PENDING_HR) {
      await this.mailHr(auth.groupId, e, `Leave waiting for HR: ${name}`, `${name}'s manager approved ${what}.\n${info.label} also needs HR approval. Open Leave approvals in the portal.`);
    } else if (e.user?.isActive) {
      const verdict = updated.status === LeaveStatus.APPROVED ? 'approved' : 'declined';
      await this.mail.send({
        to: e.user.email,
        subject: `Your leave was ${verdict}`,
        text: `Hello ${e.person.firstName},\n\nYour request for ${what} was ${verdict}.${note ? `\nNote: ${note}` : ''}`,
      });
    }
    return this.present(auth, updated);
  }

  async cancel(auth: AuthContext, id: string) {
    const request = await this.findRequest(auth, id);
    if (!this.canCancel(auth, request)) throw new ForbiddenException('This request cannot be cancelled');
    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id, status: request.status },
      data: { status: LeaveStatus.CANCELLED, cancelledById: auth.userId, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('This request changed a moment ago. Refresh to see it.');
    await this.audit.record(auth, { action: 'leave.cancelled', targetType: 'leave_request', targetId: id, legalEntityId: request.legalEntityId, detail: { previousStatus: request.status } });
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
    // Tell the manager who had approved it or was about to decide
    if (request.approverId) {
      const approver = await this.prisma.employment.findUnique({
        where: { id: request.approverId },
        select: { userId: true, person: { select: { firstName: true } }, user: { select: { email: true, isActive: true } } },
      });
      if (approver?.user?.isActive && approver.userId !== auth.userId) {
        await this.mail.send({ to: approver.user.email, subject: `Leave cancelled: ${fullName(request.employment.person)}`, text: `${fullName(request.employment.person)}'s ${describe(request)} was cancelled.` });
      }
    }
    return this.present(auth, updated);
  }

  /** Requests waiting for the signed-in person: their team's at the manager step, and HR's queue for their companies */
  async approvals(auth: AuthContext) {
    const mine = await this.access.ownEmploymentIds(auth);
    const hrEntities = entityIds(auth, 'people.manage');
    const or: Prisma.LeaveRequestWhereInput[] = [];
    if (mine.length) or.push({ status: LeaveStatus.PENDING_MANAGER, approverId: { in: mine } });
    if (hrEntities.length) or.push({ status: LeaveStatus.PENDING_HR, legalEntityId: { in: hrEntities } });
    if (or.length === 0) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: { OR: or, employmentId: { notIn: mine }, employment: { legalEntity: { groupId: auth.groupId } } },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const memo = new Map<string, Promise<{ days: number }>>();
    const today = todayIso();
    return Promise.all(
      rows.map(async (r) => {
        const entity = r.employment.legalEntity;
        const key = `${entity.id}:${toIso(r.createdAt)}`;
        if (!memo.has(key)) memo.set(key, this.countDays(entity, toIso(r.createdAt), today));
        const waiting = await memo.get(key)!;
        // The day it arrived does not count towards the 3-working-day target
        const waitingDays = Math.max(0, waiting.days - 1);
        return { ...this.present(auth, r), waitingDays, overdue: waitingDays > 3, step: r.status === LeaveStatus.PENDING_MANAGER ? 'manager' : 'hr' };
      }),
    );
  }

  /**
   * Who is away in a month. HR sees a whole company; managers see everyone below them;
   * everyone else sees their own leave and when teammates are away (without the type).
   */
  async calendar(auth: AuthContext, month: string, entityId?: string) {
    const start = `${month}-01`;
    const end = toIso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
    const own = await this.prisma.employment.findFirst({
      where: { userId: auth.userId, status: 'ACTIVE', legalEntity: { groupId: auth.groupId } },
      orderBy: { hireDate: 'desc' },
      select: { id: true, legalEntity: { select: { id: true, code: true, name: true, countryCode: true, weekendDays: true } } },
    });
    const hrEntities = entityIds(auth, 'people.read');
    let where: Prisma.LeaveRequestWhereInput;
    let entity: Entity & { code: string; name: string };
    let showDetail: (employmentId: string) => boolean;
    let scope: 'company' | 'team' | 'colleagues';

    if (entityId || (hrEntities.length && (!own || hrEntities.includes(own.legalEntity.id)))) {
      const id = entityId ?? (own && hrEntities.includes(own.legalEntity.id) ? own.legalEntity.id : hrEntities[0]);
      assertEntity(auth, 'people.read', id, 'Company');
      entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, name: true, countryCode: true, weekendDays: true } });
      where = { legalEntityId: id };
      showDetail = () => true;
      scope = 'company';
    } else {
      if (!own) throw new ForbiddenException('Your sign-in is not linked to an employee record');
      entity = own.legalEntity;
      const team = can(auth.access, 'team.read') ? await this.access.team(auth) : new Map<string, number>();
      if (team.size) {
        where = { employmentId: { in: [own.id, ...team.keys()] } };
        showDetail = () => true;
        scope = 'team';
      } else {
        const mgr = await this.prisma.assignment.findFirst({ where: { employmentId: own.id, ...inForce() }, select: { managerId: true } });
        const peers = mgr?.managerId
          ? await this.prisma.assignment.findMany({ where: { managerId: mgr.managerId, ...inForce(), employment: { status: 'ACTIVE' } }, select: { employmentId: true } })
          : [];
        where = { employmentId: { in: [own.id, ...peers.map((p) => p.employmentId), ...(mgr?.managerId ? [mgr.managerId] : [])] } };
        showDetail = (id) => id === own.id;
        scope = 'colleagues';
      }
    }

    const [holidays, requests] = await Promise.all([
      this.holidaySet(entity.countryCode, start, end),
      this.prisma.leaveRequest.findMany({
        where: { ...where, status: { in: COUNTED }, startDate: { lte: fromIso(end) }, endDate: { gte: fromIso(start) } },
        include: REQUEST_INCLUDE,
        orderBy: [{ startDate: 'asc' }],
        take: 2000,
      }),
    ]);
    return {
      month,
      scope,
      entity: { id: entity.id, code: entity.code, name: entity.name, countryCode: entity.countryCode, weekendDays: entity.weekendDays },
      days: eachDay(start, end),
      holidays: [...holidays.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date)),
      entries: requests
        .filter((r) => showDetail(r.employmentId) || r.status === LeaveStatus.APPROVED)
        .map((r) => ({
          id: r.id,
          employmentId: r.employmentId,
          name: fullName(r.employment.person),
          startDate: toIso(r.startDate),
          endDate: toIso(r.endDate),
          days: r.days,
          // Colleagues only see that someone is away, not why
          type: showDetail(r.employmentId) ? r.type : null,
          status: showDetail(r.employmentId) ? r.status : LeaveStatus.APPROVED,
        })),
    };
  }

  /**
   * Days in a pay period that reduce pay: approved unpaid leave, and sick leave past the
   * full-pay allowance (the next 30 days on half pay, any beyond that unpaid). For payroll.
   */
  async payCuts(employmentIds: string[], entity: Entity, periodStart: IsoDate, periodEnd: IsoDate) {
    const year = periodStart.slice(0, 4);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employmentId: { in: employmentIds },
        status: LeaveStatus.APPROVED,
        type: { in: [LeaveType.UNPAID, LeaveType.SICK] },
        startDate: { gte: fromIso(`${year}-01-01`), lte: fromIso(periodEnd) },
      },
      orderBy: { startDate: 'asc' },
    });
    const cuts = new Map<string, { unpaidDays: number; halfPayDays: number }>();
    if (requests.length === 0) return cuts;
    const holidays = new Set((await this.holidaySet(entity.countryCode, `${year}-01-01`, periodEnd)).keys());
    const sickSoFar = new Map<string, number>();
    for (const r of requests) {
      const cut = cuts.get(r.employmentId) ?? { unpaidDays: 0, halfPayDays: 0 };
      for (const day of workingDays(toIso(r.startDate), toIso(r.endDate), entity.weekendDays, holidays)) {
        let unpaid = false;
        let half = false;
        if (r.type === LeaveType.UNPAID) unpaid = true;
        else {
          const n = (sickSoFar.get(r.employmentId) ?? 0) + 1;
          sickSoFar.set(r.employmentId, n);
          half = n > SICK_FULL_PAY_DAYS && n <= SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS;
          unpaid = n > SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS;
        }
        if (day < periodStart || day > periodEnd) continue;
        if (unpaid) cut.unpaidDays += 1;
        if (half) cut.halfPayDays += 1;
      }
      if (cut.unpaidDays || cut.halfPayDays) cuts.set(r.employmentId, cut);
    }
    return cuts;
  }

  // ---------- helpers ----------

  private present(auth: AuthContext, r: RequestWithPeople) {
    const { employment, approver, ...rest } = r;
    return {
      ...rest,
      startDate: toIso(r.startDate),
      endDate: toIso(r.endDate),
      employee: { id: employment.id, employeeNumber: employment.employeeNumber, name: fullName(employment.person), entity: { code: employment.legalEntity.code, name: employment.legalEntity.name } },
      approver: approver ? { id: approver.id, name: fullName(approver.person) } : null,
      canCancel: this.canCancel(auth, r),
    };
  }

  private canCancel(auth: AuthContext, r: LeaveRequest & { employment: { userId: string | null } }) {
    if (r.status === LeaveStatus.CANCELLED || r.status === LeaveStatus.DECLINED) return false;
    if (can(auth.access, 'people.manage', r.legalEntityId) && r.employment.userId !== auth.userId) return true;
    if (r.employment.userId !== auth.userId) return false;
    return OPEN.includes(r.status) || toIso(r.startDate) > todayIso();
  }

  private async assertLeaveOn(legalEntityId: string, name: string) {
    const f = await this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId, module: 'leave' } } });
    if (!f?.enabled) throw new ForbiddenException(`Leave is switched off for ${name}`);
  }

  /** The line manager in force today, when they have an active portal account to approve with */
  private async lineManager(employmentId: string, employeeUserId: string | null) {
    const a = await this.prisma.assignment.findFirst({
      where: { employmentId, ...inForce() },
      select: {
        manager: { select: { id: true, status: true, userId: true, person: { select: { firstName: true } }, user: { select: { email: true, isActive: true } } } },
      },
    });
    const m = a?.manager;
    if (!m || m.status !== 'ACTIVE' || !m.user?.isActive || !m.userId || m.userId === employeeUserId) return null;
    return { id: m.id, firstName: m.person.firstName, email: m.user.email };
  }

  /** HR for the company: company or country scoped first, group-wide administrators only when there is nobody closer */
  private async mailHr(groupId: string, e: LeaveEmployment, subject: string, text: string) {
    const rows = await this.prisma.roleAssignment.findMany({
      where: { role: { in: HR_ROLES }, user: { groupId, isActive: true } },
      select: { scopeType: true, countryCode: true, legalEntityId: true, user: { select: { id: true, email: true } } },
    });
    const notSelf = rows.filter((r) => r.user.id !== e.userId);
    const close = notSelf.filter((r) => (r.scopeType === 'LEGAL_ENTITY' && r.legalEntityId === e.legalEntityId) || (r.scopeType === 'COUNTRY' && r.countryCode === e.legalEntity.countryCode));
    const pick = close.length ? close : notSelf.filter((r) => r.scopeType === 'GROUP');
    for (const email of new Set(pick.map((r) => r.user.email))) await this.mail.send({ to: email, subject, text });
  }

  private async findRequest(auth: AuthContext, id: string) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, employment: { legalEntity: { groupId: auth.groupId } } }, include: REQUEST_INCLUDE });
    if (!r) throw new NotFoundException('Leave request not found');
    return r;
  }

  private async findEmployment(auth: AuthContext, id: string): Promise<LeaveEmployment> {
    const e = await this.prisma.employment.findFirst({ where: { id, legalEntity: { groupId: auth.groupId } }, select: EMPLOYMENT_FOR_LEAVE });
    if (!e) throw new NotFoundException('Employee not found');
    return e;
  }

  /** The employee whose leave is being read: yourself by default, or someone you may see */
  private async visibleEmployment(auth: AuthContext, employmentId?: string) {
    if (!employmentId) return this.ownEmployment(auth);
    await this.access.resolve(auth, employmentId);
    return this.findEmployment(auth, employmentId);
  }

  /** The employee a request is for: yourself, or anyone in your companies when HR records leave for them */
  private async targetEmployment(auth: AuthContext, employmentId?: string) {
    if (!employmentId) return this.ownEmployment(auth);
    const { subject, rel } = await this.access.resolve(auth, employmentId);
    if (!rel.self && !can(auth.access, 'people.manage', subject.legalEntityId)) throw new ForbiddenException('Only HR can record leave for someone else');
    return this.findEmployment(auth, employmentId);
  }

  private async ownEmployment(auth: AuthContext) {
    const e = await this.prisma.employment.findFirst({
      where: { userId: auth.userId, legalEntity: { groupId: auth.groupId } },
      select: EMPLOYMENT_FOR_LEAVE,
    });
    if (!e) throw new ForbiddenException('Your sign-in is not linked to an employee record');
    return e;
  }
}

function checkRange(startDate: string, endDate: string) {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (end < start) throw new BadRequestException('The end date is before the start date');
  if (eachDay(start, end).length > 366) throw new BadRequestException('Leave cannot be longer than a year');
  return { start, end };
}
