import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStage, BenefitEnrolment, BenefitKind, BenefitPlan, GiftVoucher, Prisma, RequestStatus, Role, VoucherOccasion } from '@prisma/client';
import { ApprovalNotifier } from '../approvals/notify.service';
import { openPayMonth } from '../approvals/pay-month';
import { actorInfo, findPerson, fullName, ownPerson, toMajor, toMinor } from '../approvals/people';
import { activeManager, decisionsOf, nextAfterDecision, settleOwnSteps, STAGE_LABEL } from '../approvals/stages';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { ym, ymLabel, ymOf } from '../loans/loan-rules';
import { PayItem } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto, EnrolDto, NominateDto, OverviewQuery, UpdatePlanDto } from './benefits.dto';

const LIVE: RequestStatus[] = [RequestStatus.PENDING, RequestStatus.APPROVED];
const MANAGES_BENEFITS: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL, Role.FINANCE];
const HR_LIKE: Role[] = [Role.ADMIN, Role.HR];
/** HR-F06 and HR-F07: HR (Wellness) approves, then Payroll sets up the deduction */
const ENROLMENT_STAGES: ApprovalStage[] = [ApprovalStage.HR, ApprovalStage.PAYROLL];

export const KIND_LABEL: Record<BenefitKind, string> = { MEAL: 'Meal voucher', GYM: 'Gym membership' };
export const OCCASION_LABEL: Record<VoucherOccasion, string> = {
  BIRTHDAY: 'Birthday',
  LONG_SERVICE: 'Long service',
  FESTIVE: 'Festive season',
  RECOGNITION: 'Recognition',
  WEDDING: 'Wedding',
  NEW_BABY: 'New baby',
  OTHER: 'Other',
};

const fmt = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = (month: number) => new Date(Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1));
const monthEnd = (month: number) => new Date(Date.UTC(Math.floor(month / 100), month % 100, 0));
const parseMonth = (value: string) => ym(Number(value.slice(0, 4)), Number(value.slice(5, 7)));

type EnrolmentWithPlan = BenefitEnrolment & { plan: BenefitPlan };

/**
 * Meal vouchers and gym memberships (POL-17 3.7 and 3.8) and gift vouchers (3.9).
 * The company's share is a benefit in kind on the payslip (or cash, for the remote meal
 * allowance); the employee's share of a gym plan is deducted from net pay.
 */
@Injectable()
export class BenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: ApprovalNotifier,
  ) {}

  // ---------- plans ----------

  async plans(actor: AuthUser, companyId?: string) {
    const manages = MANAGES_BENEFITS.includes(actor.role);
    const me = await this.prisma.employee.findFirst({ where: { userId: actor.id, deletedAt: null }, select: { companyId: true, workLocation: true } });
    const company = companyId && manages ? companyId : me?.companyId;
    if (!company) throw new BadRequestException('Choose a company');
    const plans = await this.prisma.benefitPlan.findMany({
      where: { companyId: company, ...(manages ? {} : { active: true }) },
      include: { company: { select: { currency: true } } },
      orderBy: [{ kind: 'asc' }, { companyShare: 'asc' }],
    });
    return plans.map((p) => ({
      ...this.planView(p, p.company.currency),
      // Who may enrol, from the work locations on the plan (HR-F06: canteen and meal card on site, allowance for remote staff)
      eligible: !!me && me.companyId === p.companyId && (p.workLocations.length === 0 || p.workLocations.includes(me.workLocation)),
    }));
  }

  async createPlan(actor: AuthUser, dto: CreatePlanDto) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company) throw new BadRequestException('Unknown company');
    const exists = await this.prisma.benefitPlan.findUnique({ where: { companyId_kind_name: { companyId: dto.companyId, kind: dto.kind, name: dto.name } } });
    if (exists) throw new ConflictException(`${company.name} already has a ${KIND_LABEL[dto.kind].toLowerCase()} option called ${dto.name}`);
    const plan = await this.prisma.benefitPlan.create({
      data: {
        companyId: dto.companyId,
        kind: dto.kind,
        name: dto.name,
        provider: dto.provider || null,
        description: dto.description || null,
        companyShare: dto.companyShare.toFixed(2),
        employeeShare: (dto.paidAsCash ? 0 : dto.employeeShare).toFixed(2),
        paidAsCash: dto.kind === BenefitKind.MEAL && !!dto.paidAsCash,
        workLocations: dto.workLocations ?? [],
      },
    });
    await this.audit.record(actor.id, 'benefit.plan.create', 'BenefitPlan', plan.id, { company: company.code, kind: dto.kind, name: dto.name });
    return this.planView(plan, company.currency);
  }

  /** Price changes apply from the next payroll calculation */
  async updatePlan(actor: AuthUser, id: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.benefitPlan.findUnique({ where: { id }, include: { company: true } });
    if (!plan) throw new NotFoundException('Option not found');
    const updated = await this.prisma.benefitPlan.update({
      where: { id },
      data: {
        provider: dto.provider,
        description: dto.description,
        companyShare: dto.companyShare?.toFixed(2),
        employeeShare: plan.paidAsCash ? undefined : dto.employeeShare?.toFixed(2),
        active: dto.active,
      },
    });
    await this.audit.record(actor.id, 'benefit.plan.update', 'BenefitPlan', id, { ...dto } as Prisma.InputJsonValue);
    return this.planView(updated, plan.company.currency);
  }

  // ---------- my benefits ----------

  async mine(actor: AuthUser) {
    const me = await ownPerson(this.prisma, actor);
    const [enrolments, received, nominated, openMonth] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({ where: { employeeId: me.id }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.giftVoucher.findMany({ where: { employeeId: me.id, status: RequestStatus.APPROVED }, orderBy: { createdAt: 'desc' } }),
      this.prisma.giftVoucher.findMany({
        where: { createdById: actor.id },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      openPayMonth(this.prisma, me.companyId),
    ]);
    return {
      currency: me.company.currency,
      workLocation: me.workLocation,
      firstMonth: `${Math.floor(openMonth / 100)}-${String(openMonth % 100).padStart(2, '0')}`,
      firstMonthLabel: ymLabel(openMonth),
      enrolments: enrolments.map((e) => this.enrolmentView(actor, e, me, openMonth)),
      vouchersReceived: received.map((v) => this.voucherView(v)),
      vouchersNominated: nominated.map((v) => ({ ...this.voucherView(v), nominee: fullName(v.employee), canCancel: v.status === RequestStatus.PENDING })),
    };
  }

  async enrol(actor: AuthUser, dto: EnrolDto) {
    const me = await ownPerson(this.prisma, actor);
    if (me.exitDate) throw new BadRequestException('Benefits cannot be started once a leaving date is set');
    const plan = await this.prisma.benefitPlan.findUnique({ where: { id: dto.planId } });
    if (!plan || plan.companyId !== me.companyId || !plan.active) throw new BadRequestException('That option is not offered by your company');
    if (plan.workLocations.length && !plan.workLocations.includes(me.workLocation)) {
      throw new BadRequestException(`${plan.name} is not available for your work location`);
    }
    const openMonth = await openPayMonth(this.prisma, me.companyId);
    const start = parseMonth(dto.startMonth);
    if (start < openMonth) throw new BadRequestException(`The earliest start is ${ymLabel(openMonth)}, because earlier payroll is already approved`);
    const clash = await this.prisma.benefitEnrolment.findFirst({
      where: {
        employeeId: me.id,
        status: { in: [...LIVE, RequestStatus.CLOSED] },
        OR: [{ endDate: null }, { endDate: { gte: monthStart(start) } }],
        ...(plan.kind === BenefitKind.MEAL ? { kind: BenefitKind.MEAL } : { planId: plan.id }),
      },
      include: { plan: true },
    });
    if (clash) throw new ConflictException(`You already have ${clash.plan.name} (${KIND_LABEL[clash.kind].toLowerCase()}). End it first.`);
    if (plan.kind === BenefitKind.GYM && !dto.emergencyContact) throw new BadRequestException('Give an emergency contact for the gym');

    const enrolment = await this.prisma.benefitEnrolment.create({
      data: {
        employeeId: me.id,
        planId: plan.id,
        kind: plan.kind,
        startDate: monthStart(start),
        dietaryNeeds: plan.kind === BenefitKind.MEAL ? dto.dietaryNeeds || null : null,
        branch: plan.kind === BenefitKind.GYM ? dto.branch || null : null,
        emergencyContact: plan.kind === BenefitKind.GYM ? dto.emergencyContact || null : null,
        status: RequestStatus.PENDING,
        stages: ENROLMENT_STAGES,
        stage: ENROLMENT_STAGES[0],
        createdById: actor.id,
      },
      include: { plan: true },
    });
    await this.audit.record(actor.id, 'benefit.enrol', 'BenefitEnrolment', enrolment.id, { plan: plan.name, start: dto.startMonth });
    await this.notify.stage(enrolment.stage!, null, `${KIND_LABEL[plan.kind]} enrolment from ${fullName(me)}`, `${fullName(me)} asked to join ${plan.name} from ${ymLabel(start)}.`);
    return this.enrolmentView(actor, enrolment, me, openMonth);
  }

  /** Cancels a request, or ends a running enrolment at the end of the open payroll month */
  async endEnrolment(actor: AuthUser, id: string) {
    const enrolment = await this.prisma.benefitEnrolment.findUnique({ where: { id }, include: { plan: true } });
    if (!enrolment) throw new NotFoundException('Enrolment not found');
    const employee = await findPerson(this.prisma, enrolment.employeeId);
    if (employee.userId !== actor.id && !HR_LIKE.includes(actor.role)) throw new ForbiddenException('Only the member or HR can end this');
    const openMonth = await openPayMonth(this.prisma, employee.companyId);
    let data: Prisma.BenefitEnrolmentUpdateManyMutationInput;
    if (enrolment.status === RequestStatus.PENDING || (enrolment.status === RequestStatus.APPROVED && ymOf(enrolment.startDate) > openMonth)) {
      data = { status: RequestStatus.CANCELLED, stage: null, cancelledById: actor.id, cancelledAt: new Date() };
    } else if (enrolment.status === RequestStatus.APPROVED && !enrolment.endDate) {
      data = { status: RequestStatus.CLOSED, endDate: monthEnd(openMonth), cancelledById: actor.id, cancelledAt: new Date() };
    } else {
      throw new ConflictException('This has already ended');
    }
    const { count } = await this.prisma.benefitEnrolment.updateMany({ where: { id, status: enrolment.status }, data });
    if (count === 0) throw new ConflictException('This changed a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, 'benefit.end', 'BenefitEnrolment', id, { status: data.status as string });
    const updated = await this.prisma.benefitEnrolment.findUniqueOrThrow({ where: { id }, include: { plan: true } });
    return this.enrolmentView(actor, updated, employee, openMonth);
  }

  // ---------- gift vouchers ----------

  /** People the signed-in person may nominate: a manager's own team, or anyone for HR */
  async nominees(actor: AuthUser, q?: string) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    const search: Prisma.EmployeeWhereInput = q
      ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { employeeNo: { contains: q, mode: 'insensitive' } }] }
      : {};
    let where: Prisma.EmployeeWhereInput;
    if (HR_LIKE.includes(actor.role)) where = search;
    else if (actor.role === Role.MANAGER && me) where = { ...search, managerId: me.id };
    else return [];
    const rows = await this.prisma.employee.findMany({
      where: { ...where, deletedAt: null, exitDate: null, userId: { not: actor.id } },
      select: { id: true, firstName: true, lastName: true, employeeNo: true, jobTitle: true, company: { select: { currency: true, name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, name: fullName(r), employeeNo: r.employeeNo, jobTitle: r.jobTitle, currency: r.company.currency, company: r.company.name }));
  }

  async nominate(actor: AuthUser, dto: NominateDto) {
    const nominee = await findPerson(this.prisma, dto.employeeId);
    const me = await actorInfo(this.prisma, actor);
    const hr = HR_LIKE.includes(actor.role);
    const isManager = !!me.employeeId && nominee.managerId === me.employeeId;
    if (!hr && !isManager) throw new ForbiddenException('Managers nominate their own team; HR can nominate anyone');
    if (nominee.userId === actor.id) throw new ForbiddenException('You cannot nominate yourself');
    const manager = activeManager(nominee);
    const all: ApprovalStage[] = manager ? [ApprovalStage.MANAGER, ApprovalStage.HR] : [ApprovalStage.HR];
    const settled = [...(isManager ? [ApprovalStage.MANAGER] : []), ...(hr ? [ApprovalStage.HR] : [])];
    const steps = settleOwnSteps(all, settled, actor, me.name);
    const done = steps.stage === null;
    const voucher = await this.prisma.giftVoucher.create({
      data: {
        employeeId: nominee.id,
        occasion: dto.occasion,
        value: dto.value.toFixed(2),
        currency: nominee.company.currency,
        partner: dto.partner || null,
        reason: dto.reason || null,
        status: done ? RequestStatus.APPROVED : RequestStatus.PENDING,
        stages: steps.stages,
        stage: steps.stage,
        approverId: manager?.id ?? null,
        decisions: steps.decisions as unknown as Prisma.InputJsonValue,
        taxMonth: done ? await openPayMonth(this.prisma, nominee.companyId) : null,
        createdById: actor.id,
      },
    });
    await this.audit.record(actor.id, 'voucher.nominate', 'GiftVoucher', voucher.id, { employeeId: nominee.id, occasion: dto.occasion, value: dto.value });
    if (done) await this.voucherIssued(voucher, nominee);
    else await this.notify.stage(voucher.stage!, voucher.approverId, `Gift voucher nomination for ${fullName(nominee)}`, `${me.name} nominated ${fullName(nominee)} for a ${OCCASION_LABEL[dto.occasion].toLowerCase()} gift voucher of ${fmt(toMinor(dto.value), voucher.currency)}.`);
    return { ...this.voucherView(voucher), nominee: fullName(nominee), canCancel: voucher.status === RequestStatus.PENDING };
  }

  async cancelVoucher(actor: AuthUser, id: string) {
    const voucher = await this.prisma.giftVoucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException('Voucher not found');
    if (voucher.createdById !== actor.id && !HR_LIKE.includes(actor.role)) throw new ForbiddenException('Only whoever nominated this, or HR, can cancel it');
    const { count } = await this.prisma.giftVoucher.updateMany({
      where: { id, status: RequestStatus.PENDING },
      data: { status: RequestStatus.CANCELLED, stage: null, cancelledById: actor.id, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('Only a nomination still waiting for approval can be cancelled');
    await this.audit.record(actor.id, 'voucher.cancel', 'GiftVoucher', id);
    return this.voucherView(await this.prisma.giftVoucher.findUniqueOrThrow({ where: { id } }));
  }

  private async voucherIssued(voucher: GiftVoucher, nominee: { firstName: string; user: { email: string; isActive: boolean } | null }) {
    await this.notify.employee(
      nominee.user,
      'You have a gift voucher',
      `Hello ${nominee.firstName},\n\nYou were given a ${OCCASION_LABEL[voucher.occasion].toLowerCase()} gift voucher worth ${fmt(toMinor(voucher.value), voucher.currency)}${voucher.partner ? ` for ${voucher.partner}` : ''}.\nHR will send it to you. Its value appears on your ${ymLabel(voucher.taxMonth!)} payslip as a benefit.`,
    );
  }

  // ---------- approvals ----------

  async decide(actor: AuthUser, entity: 'enrolment' | 'voucher', id: string, approve: boolean, note?: string) {
    const me = await actorInfo(this.prisma, actor);
    if (entity === 'enrolment') {
      const e = await this.prisma.benefitEnrolment.findUnique({ where: { id }, include: { plan: true } });
      if (!e) throw new NotFoundException('Enrolment not found');
      const employee = await findPerson(this.prisma, e.employeeId);
      const step = nextAfterDecision(actor, me.name, e, employee, me.employeeId, approve, note);
      const data: Prisma.BenefitEnrolmentUpdateManyMutationInput = {
        decisions: step.decisions,
        stage: step.stage,
        ...(step.declined ? { status: RequestStatus.DECLINED } : step.finished ? { status: RequestStatus.APPROVED } : {}),
      };
      const { count } = await this.prisma.benefitEnrolment.updateMany({ where: { id, status: RequestStatus.PENDING, stage: e.stage }, data });
      if (count === 0) throw new ConflictException('Someone else decided this a moment ago. Refresh to see it.');
      await this.audit.record(actor.id, approve ? 'benefit.approve' : 'benefit.decline', 'BenefitEnrolment', id, { stage: e.stage, note: note ?? null });
      const what = `${KIND_LABEL[e.kind].toLowerCase()} (${e.plan.name}) from ${ymLabel(ymOf(e.startDate))}`;
      if (step.stage) await this.notify.stage(step.stage, null, `${KIND_LABEL[e.kind]} enrolment waiting for ${STAGE_LABEL[step.stage]}: ${fullName(employee)}`, `${STAGE_LABEL[e.stage!]} approved ${fullName(employee)}'s ${what}.`);
      else await this.notify.employee(employee.user, `Your ${KIND_LABEL[e.kind].toLowerCase()} was ${approve ? 'approved' : 'declined'}`, `Hello ${employee.firstName},\n\nYour ${what} was ${approve ? 'approved' : 'declined'}.${note ? `\nNote: ${note}` : ''}`);
      return { id, status: step.declined ? RequestStatus.DECLINED : step.finished ? RequestStatus.APPROVED : RequestStatus.PENDING };
    }

    const v = await this.prisma.giftVoucher.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Voucher not found');
    const nominee = await findPerson(this.prisma, v.employeeId);
    if (v.createdById === actor.id) throw new ForbiddenException('You nominated this voucher, so someone else must approve it');
    const step = nextAfterDecision(actor, me.name, v, nominee, me.employeeId, approve, note);
    const data: Prisma.GiftVoucherUpdateManyMutationInput = {
      decisions: step.decisions,
      stage: step.stage,
      ...(step.declined ? { status: RequestStatus.DECLINED } : {}),
      ...(step.finished ? { status: RequestStatus.APPROVED, taxMonth: await openPayMonth(this.prisma, nominee.companyId) } : {}),
    };
    const { count } = await this.prisma.giftVoucher.updateMany({ where: { id, status: RequestStatus.PENDING, stage: v.stage }, data });
    if (count === 0) throw new ConflictException('Someone else decided this a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, approve ? 'voucher.approve' : 'voucher.decline', 'GiftVoucher', id, { stage: v.stage, note: note ?? null });
    const updated = await this.prisma.giftVoucher.findUniqueOrThrow({ where: { id } });
    if (step.stage) {
      await this.notify.stage(step.stage, null, `Gift voucher waiting for ${STAGE_LABEL[step.stage]}: ${fullName(nominee)}`, `${STAGE_LABEL[v.stage!]} approved a ${OCCASION_LABEL[v.occasion].toLowerCase()} gift voucher of ${fmt(toMinor(v.value), v.currency)} for ${fullName(nominee)}.`);
    } else if (step.finished) {
      await this.voucherIssued(updated, nominee);
    }
    // Tell whoever nominated how it went
    if (!step.stage && v.createdById) {
      const nominator = await this.prisma.user.findUnique({ where: { id: v.createdById }, select: { email: true, isActive: true } });
      await this.notify.employee(nominator, `Gift voucher for ${fullName(nominee)} ${approve ? 'approved' : 'declined'}`, `Your nomination of ${fullName(nominee)} for a ${OCCASION_LABEL[v.occasion].toLowerCase()} gift voucher was ${approve ? 'approved' : 'declined'}.${note ? `\nNote: ${note}` : ''}`);
    }
    return { id, status: updated.status };
  }

  async pendingFor(actor: AuthUser, myEmployeeId: string | null) {
    const stages: ApprovalStage[] =
      actor.role === Role.ADMIN ? [ApprovalStage.HR, ApprovalStage.PAYROLL] : actor.role === Role.HR ? [ApprovalStage.HR] : actor.role === Role.PAYROLL ? [ApprovalStage.PAYROLL] : [];
    const employeeSelect = { select: { id: true, firstName: true, lastName: true, employeeNo: true, userId: true, company: { select: { name: true, currency: true } } } } as const;
    const voucherOr: Prisma.GiftVoucherWhereInput[] = [];
    if (myEmployeeId) voucherOr.push({ stage: ApprovalStage.MANAGER, approverId: myEmployeeId });
    if (actor.role === Role.ADMIN) voucherOr.push({ stage: ApprovalStage.MANAGER });
    if (stages.length) voucherOr.push({ stage: { in: stages } });
    const [enrolments, vouchers] = await Promise.all([
      stages.length
        ? this.prisma.benefitEnrolment.findMany({
            where: { status: RequestStatus.PENDING, stage: { in: stages }, employee: { userId: { not: actor.id } } },
            include: { plan: true, employee: employeeSelect },
            orderBy: { createdAt: 'asc' },
            take: 500,
          })
        : [],
      voucherOr.length
        ? this.prisma.giftVoucher.findMany({
            where: { status: RequestStatus.PENDING, OR: voucherOr, createdById: { not: actor.id }, employee: { userId: { not: actor.id } } },
            include: { employee: employeeSelect },
            orderBy: { createdAt: 'asc' },
            take: 500,
          })
        : [],
    ]);
    const notMine = (r: { decisions: Prisma.JsonValue }) => !decisionsOf(r).some((d) => d.byId === actor.id && d.approved);
    const person = (e: { id: string; firstName: string; lastName: string; employeeNo: string; company: { name: string } }) => ({ id: e.id, name: fullName(e), employeeNo: e.employeeNo, company: e.company.name });
    return [
      ...enrolments.filter(notMine).map((e) => ({
        entity: 'enrolment' as const,
        id: e.id,
        title: `${KIND_LABEL[e.kind]}: ${e.plan.name}`,
        employee: person(e.employee),
        amount: null,
        currency: e.employee.company.currency,
        details: [
          `From ${ymLabel(ymOf(e.startDate))}${e.plan.provider ? `, ${e.plan.provider}` : ''}`,
          e.plan.paidAsCash
            ? `Paid as a cash allowance of ${fmt(toMinor(e.plan.companyShare), e.employee.company.currency)} a month`
            : `Company pays ${fmt(toMinor(e.plan.companyShare), e.employee.company.currency)} a month${toMinor(e.plan.employeeShare) > 0 ? `, employee pays ${fmt(toMinor(e.plan.employeeShare), e.employee.company.currency)} by payroll deduction` : ''}`,
          ...(e.dietaryNeeds ? [`Dietary needs: ${e.dietaryNeeds}`] : []),
          ...(e.branch ? [`Branch: ${e.branch}`] : []),
          ...(e.emergencyContact ? [`Emergency contact: ${e.emergencyContact}`] : []),
        ],
        stage: e.stage!,
        stageLabel: STAGE_LABEL[e.stage!],
        stages: e.stages.map((s) => STAGE_LABEL[s]),
        decisions: decisionsOf(e),
        createdAt: e.createdAt.toISOString(),
      })),
      ...vouchers.filter(notMine).map((v) => ({
        entity: 'voucher' as const,
        id: v.id,
        title: `Gift voucher: ${OCCASION_LABEL[v.occasion]}`,
        employee: person(v.employee),
        amount: Number(v.value).toFixed(2),
        currency: v.currency,
        details: [...(v.reason ? [v.reason] : []), ...(v.partner ? [`Partner: ${v.partner}`] : [])],
        stage: v.stage!,
        stageLabel: STAGE_LABEL[v.stage!],
        stages: v.stages.map((s) => STAGE_LABEL[s]),
        decisions: decisionsOf(v),
        createdAt: v.createdAt.toISOString(),
      })),
    ];
  }

  // ---------- overview for HR, payroll and finance ----------

  async overview(actor: AuthUser, q: OverviewQuery) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { companyId: true } });
    const companyId = q.companyId ?? me?.companyId ?? (await this.prisma.company.findFirst({ where: { countryCode: 'KE' } }))?.id;
    if (!companyId) throw new BadRequestException('Choose a company');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const year = q.year ?? new Date().getUTCFullYear();
    const openMonth = await openPayMonth(this.prisma, companyId);
    const employeeSelect = { select: { id: true, firstName: true, lastName: true, employeeNo: true } } as const;
    const [enrolments, vouchers] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({
        where: { employee: { companyId }, OR: [{ status: { in: LIVE } }, { status: RequestStatus.CLOSED, endDate: { gte: monthStart(openMonth) } }] },
        include: { plan: true, employee: employeeSelect },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.prisma.giftVoucher.findMany({
        where: { employee: { companyId }, createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        include: { employee: employeeSelect },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
    ]);
    const running = enrolments.filter((e) => e.status !== RequestStatus.PENDING);
    return {
      company: { id: company.id, name: company.name, currency: company.currency },
      year,
      monthlyCompanyCost: toMajor(running.reduce((s, e) => s + toMinor(e.plan.companyShare), 0)),
      monthlyEmployeeShare: toMajor(running.reduce((s, e) => s + toMinor(e.plan.employeeShare), 0)),
      vouchersIssuedValue: toMajor(vouchers.filter((v) => v.status === RequestStatus.APPROVED).reduce((s, v) => s + toMinor(v.value), 0)),
      enrolments: enrolments.map((e) => ({ ...this.enrolmentView(actor, e, { userId: null }, openMonth), employee: { id: e.employee.id, name: fullName(e.employee), employeeNo: e.employee.employeeNo } })),
      vouchers: vouchers.map((v) => ({ ...this.voucherView(v), nominee: fullName(v.employee), employeeId: v.employee.id })),
    };
  }

  // ---------- payroll ----------

  /** Meal and gym benefits running for the whole month, and vouchers issued for it */
  async payrollItems(employeeIds: string[], year: number, month: number) {
    const period = ym(year, month);
    const [enrolments, vouchers] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: { in: [RequestStatus.APPROVED, RequestStatus.CLOSED] },
          startDate: { lte: monthStart(period) },
          OR: [{ endDate: null }, { endDate: { gte: monthEnd(period) } }],
        },
        include: { plan: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.giftVoucher.findMany({ where: { employeeId: { in: employeeIds }, status: RequestStatus.APPROVED, taxMonth: period }, orderBy: { createdAt: 'asc' } }),
    ]);
    const result = new Map<string, { cashAllowances: PayItem[]; benefitsInKind: PayItem[]; voluntary: PayItem[] }>();
    const entry = (id: string) => {
      const e = result.get(id) ?? { cashAllowances: [], benefitsInKind: [], voluntary: [] };
      result.set(id, e);
      return e;
    };
    for (const e of enrolments) {
      const into = entry(e.employeeId);
      const kind = e.kind === BenefitKind.MEAL ? 'Meal' : 'Gym';
      const company = toMinor(e.plan.companyShare);
      const own = toMinor(e.plan.employeeShare);
      if (e.plan.paidAsCash && company > 0) into.cashAllowances.push({ code: `${e.kind}_CASH`, label: e.plan.name, amount: company });
      else if (company > 0) into.benefitsInKind.push({ code: e.kind, label: `${kind}: ${e.plan.name}`, amount: company });
      if (own > 0) into.voluntary.push({ code: `${e.kind}_SHARE`, label: `${kind}: ${e.plan.name} (your share)`, amount: own });
    }
    for (const v of vouchers) entry(v.employeeId).benefitsInKind.push({ code: 'VOUCHER', label: `Gift voucher: ${OCCASION_LABEL[v.occasion]}`, amount: toMinor(v.value) });
    return result;
  }

  // ---------- views ----------

  private planView(p: BenefitPlan, currency: string) {
    return {
      id: p.id,
      companyId: p.companyId,
      kind: p.kind,
      kindLabel: KIND_LABEL[p.kind],
      name: p.name,
      provider: p.provider,
      description: p.description,
      companyShare: Number(p.companyShare).toFixed(2),
      employeeShare: Number(p.employeeShare).toFixed(2),
      paidAsCash: p.paidAsCash,
      workLocations: p.workLocations,
      active: p.active,
      currency,
    };
  }

  private enrolmentView(actor: AuthUser, e: EnrolmentWithPlan, employee: { userId: string | null }, openMonth: number) {
    const own = employee.userId === actor.id;
    const live = e.status === RequestStatus.PENDING || (e.status === RequestStatus.APPROVED && !e.endDate);
    return {
      id: e.id,
      kind: e.kind,
      kindLabel: KIND_LABEL[e.kind],
      plan: { id: e.plan.id, name: e.plan.name, provider: e.plan.provider, companyShare: Number(e.plan.companyShare).toFixed(2), employeeShare: Number(e.plan.employeeShare).toFixed(2), paidAsCash: e.plan.paidAsCash },
      startDate: e.startDate,
      endDate: e.endDate,
      startLabel: ymLabel(ymOf(e.startDate)),
      endLabel: e.endDate ? ymLabel(ymOf(e.endDate)) : null,
      dietaryNeeds: e.dietaryNeeds,
      branch: e.branch,
      emergencyContact: e.emergencyContact,
      status: e.status,
      stage: e.stage,
      stageLabel: e.stage ? STAGE_LABEL[e.stage] : null,
      stages: e.stages.map((s) => STAGE_LABEL[s]),
      decisions: decisionsOf(e),
      canEnd: live && (own || HR_LIKE.includes(actor.role)),
      endsAtLabel: e.status === RequestStatus.APPROVED && ymOf(e.startDate) <= openMonth ? ymLabel(openMonth) : null,
    };
  }

  private voucherView(v: GiftVoucher) {
    return {
      id: v.id,
      occasion: v.occasion,
      occasionLabel: OCCASION_LABEL[v.occasion],
      value: Number(v.value).toFixed(2),
      currency: v.currency,
      partner: v.partner,
      reason: v.reason,
      status: v.status,
      stage: v.stage,
      stageLabel: v.stage ? STAGE_LABEL[v.stage] : null,
      taxMonthLabel: v.taxMonth ? ymLabel(v.taxMonth) : null,
      decisions: decisionsOf(v),
      createdAt: v.createdAt,
    };
  }
}
