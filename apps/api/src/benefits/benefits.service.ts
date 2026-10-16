import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStage, BenefitEnrolment, BenefitKind, BenefitPlan, GiftVoucher, Prisma, RequestStatus, VoucherOccasion } from '@prisma/client';
import { can } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { assertEntity, entityIds } from '../access/scope';
import { ApprovalNotifier } from '../approvals/notify.service';
import { openPayMonth, ym, ymLabel, ymOf } from '../approvals/pay-month';
import { findPerson, fullName, lineManager, MoneyPerson, ownPerson, toMajor, toMinor } from '../approvals/people';
import { decisionsOf, involved, nextAfterDecision, settleOwnSteps, STAGE_LABEL, waitingFor } from '../approvals/stages';
import { AuditService } from '../audit/audit.service';
import { PeopleAccess } from '../people/people-access.service';
import { PayItem } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto, EnrolDto, NominateDto, OverviewQuery, UpdatePlanDto } from './benefits.dto';

const LIVE: RequestStatus[] = [RequestStatus.PENDING, RequestStatus.APPROVED];
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
const monthValue = (month: number) => `${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}`;

type EnrolmentWithPlan = BenefitEnrolment & { plan: BenefitPlan };
const PERSON_ROW = { select: { id: true, userId: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true, name: true } } } } as const;

/**
 * Meal vouchers and gym memberships (POL-17 3.7 and 3.8) and gift vouchers (3.9), carried over
 * from the first build. The company's share is a benefit in kind on the payslip (or cash, for the
 * remote meal allowance); the employee's share is deducted from net pay.
 */
@Injectable()
export class BenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: ApprovalNotifier,
    private readonly access: PeopleAccess,
  ) {}

  // ---------- plans ----------

  /** The options a company offers. Employees see their own company's active options; HR, Payroll and Finance any company in scope. */
  async plans(auth: AuthContext, entityId?: string) {
    const me = await this.prisma.employment.findFirst({ where: { userId: auth.userId, legalEntity: { groupId: auth.groupId } }, select: { legalEntityId: true, workLocation: true } });
    const target = entityId ?? me?.legalEntityId;
    if (!target) throw new BadRequestException('Choose a company');
    const manages = this.seesBenefits(auth, target);
    if (!manages && target !== me?.legalEntityId) throw new NotFoundException('Company not found');
    const entity = await this.prisma.legalEntity.findFirstOrThrow({ where: { id: target, groupId: auth.groupId }, select: { id: true, name: true, functionalCurrency: true } });
    const plans = await this.prisma.benefitPlan.findMany({
      where: { legalEntityId: target, ...(manages ? {} : { active: true }) },
      orderBy: [{ kind: 'asc' }, { companyShare: 'asc' }],
    });
    return {
      entity: { id: entity.id, name: entity.name, currency: entity.functionalCurrency },
      canEdit: can(auth.access, 'people.manage', target),
      plans: plans.map((p) => ({
        ...this.planView(p, entity.functionalCurrency),
        // HR-F06: canteen and meal card on site, a cash allowance for remote staff
        eligible: !!me && me.legalEntityId === p.legalEntityId && (p.workLocations.length === 0 || p.workLocations.includes(me.workLocation)),
      })),
    };
  }

  async createPlan(auth: AuthContext, dto: CreatePlanDto) {
    assertEntity(auth, 'people.manage', dto.entityId, 'Company');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: dto.entityId } });
    const exists = await this.prisma.benefitPlan.findUnique({ where: { legalEntityId_kind_name: { legalEntityId: dto.entityId, kind: dto.kind, name: dto.name } } });
    if (exists) throw new ConflictException(`${entity.name} already has a ${KIND_LABEL[dto.kind].toLowerCase()} option called ${dto.name}`);
    const paidAsCash = dto.kind === BenefitKind.MEAL && !!dto.paidAsCash;
    const plan = await this.prisma.benefitPlan.create({
      data: {
        legalEntityId: dto.entityId,
        kind: dto.kind,
        name: dto.name,
        provider: dto.provider || null,
        description: dto.description || null,
        companyShare: dto.companyShare.toFixed(2),
        employeeShare: (paidAsCash ? 0 : dto.employeeShare).toFixed(2),
        paidAsCash,
        workLocations: dto.workLocations ?? [],
      },
    });
    await this.audit.record(auth, { action: 'benefit.plan.created', targetType: 'benefit_plan', targetId: plan.id, legalEntityId: dto.entityId, detail: { kind: dto.kind, name: dto.name } });
    return this.planView(plan, entity.functionalCurrency);
  }

  /** Price changes apply from the next payroll calculation */
  async updatePlan(auth: AuthContext, id: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.benefitPlan.findFirst({ where: { id, legalEntityId: { in: auth.entities.map((e) => e.id) } } });
    if (!plan) throw new NotFoundException('Option not found');
    assertEntity(auth, 'people.manage', plan.legalEntityId, 'Option');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: plan.legalEntityId } });
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
    await this.audit.record(auth, { action: 'benefit.plan.updated', targetType: 'benefit_plan', targetId: id, legalEntityId: plan.legalEntityId, detail: { ...dto } as Prisma.InputJsonValue });
    return this.planView(updated, entity.functionalCurrency);
  }

  // ---------- my benefits ----------

  async mine(auth: AuthContext) {
    const me = await ownPerson(this.prisma, auth);
    const [enrolments, received, nominated, openMonth] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({ where: { employmentId: me.id }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.giftVoucher.findMany({ where: { employmentId: me.id, status: RequestStatus.APPROVED }, orderBy: { createdAt: 'desc' } }),
      this.prisma.giftVoucher.findMany({ where: { createdById: auth.userId }, include: { employment: PERSON_ROW }, orderBy: { createdAt: 'desc' }, take: 50 }),
      openPayMonth(this.prisma, me.legalEntityId),
    ]);
    return {
      currency: me.legalEntity.functionalCurrency,
      workLocation: me.workLocation,
      moduleOn: await this.moduleOn(me.legalEntityId),
      firstMonth: monthValue(openMonth),
      firstMonthLabel: ymLabel(openMonth),
      canNominate: can(auth.access, 'people.manage') || can(auth.access, 'team.read'),
      enrolments: enrolments.map((e) => this.enrolmentView(auth, e, me, openMonth)),
      vouchersReceived: received.map((v) => this.voucherView(v)),
      vouchersNominated: nominated.map((v) => ({ ...this.voucherView(v), nominee: fullName(v.employment.person), canCancel: v.status === RequestStatus.PENDING })),
    };
  }

  async enrol(auth: AuthContext, dto: EnrolDto) {
    const me = await ownPerson(this.prisma, auth);
    await this.assertModuleOn(me.legalEntityId, me.legalEntity.name);
    if (me.endDate) throw new BadRequestException('Benefits cannot be started once a leaving date is set');
    const plan = await this.prisma.benefitPlan.findUnique({ where: { id: dto.planId } });
    if (!plan || plan.legalEntityId !== me.legalEntityId || !plan.active) throw new BadRequestException('That option is not offered by your company');
    if (plan.workLocations.length && !plan.workLocations.includes(me.workLocation)) throw new BadRequestException(`${plan.name} is not available for your work location`);
    const openMonth = await openPayMonth(this.prisma, me.legalEntityId);
    const start = parseMonth(dto.startMonth);
    if (start < openMonth) throw new BadRequestException(`The earliest start is ${ymLabel(openMonth)}, because earlier payroll is already closed`);
    const clash = await this.prisma.benefitEnrolment.findFirst({
      where: {
        employmentId: me.id,
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
        employmentId: me.id,
        legalEntityId: me.legalEntityId,
        planId: plan.id,
        kind: plan.kind,
        startDate: monthStart(start),
        dietaryNeeds: plan.kind === BenefitKind.MEAL ? dto.dietaryNeeds || null : null,
        branch: plan.kind === BenefitKind.GYM ? dto.branch || null : null,
        emergencyContact: plan.kind === BenefitKind.GYM ? dto.emergencyContact || null : null,
        status: RequestStatus.PENDING,
        stages: ENROLMENT_STAGES,
        stage: ENROLMENT_STAGES[0],
        createdById: auth.userId,
      },
      include: { plan: true },
    });
    await this.audit.record(auth, { action: 'benefit.enrolment.requested', targetType: 'benefit_enrolment', targetId: enrolment.id, legalEntityId: me.legalEntityId, detail: { plan: plan.name, start: dto.startMonth } });
    const name = fullName(me.person);
    await this.notify.stage(enrolment.stage!, null, me.legalEntity, me.userId, `${KIND_LABEL[plan.kind]} enrolment from ${name}`, `${name} asked to join ${plan.name} from ${ymLabel(start)}.`);
    return this.enrolmentView(auth, enrolment, me, openMonth);
  }

  /** Cancels a request, or ends a running enrolment at the end of the open payroll month */
  async endEnrolment(auth: AuthContext, id: string) {
    const enrolment = await this.findEnrolment(auth, id);
    const employee = await findPerson(this.prisma, auth, enrolment.employmentId);
    if (employee.userId !== auth.userId && !can(auth.access, 'people.manage', enrolment.legalEntityId)) throw new ForbiddenException('Only the member or HR can end this');
    const openMonth = await openPayMonth(this.prisma, enrolment.legalEntityId);
    let data: Prisma.BenefitEnrolmentUpdateManyMutationInput;
    if (enrolment.status === RequestStatus.PENDING || (enrolment.status === RequestStatus.APPROVED && ymOf(enrolment.startDate) > openMonth)) {
      data = { status: RequestStatus.CANCELLED, stage: null, cancelledById: auth.userId, cancelledAt: new Date() };
    } else if (enrolment.status === RequestStatus.APPROVED && !enrolment.endDate) {
      data = { status: RequestStatus.CLOSED, endDate: monthEnd(openMonth), cancelledById: auth.userId, cancelledAt: new Date() };
    } else {
      throw new ConflictException('This has already ended');
    }
    const { count } = await this.prisma.benefitEnrolment.updateMany({ where: { id, status: enrolment.status }, data });
    if (count === 0) throw new ConflictException('This changed a moment ago. Refresh to see it.');
    await this.audit.record(auth, {
      action: data.status === RequestStatus.CANCELLED ? 'benefit.enrolment.cancelled' : 'benefit.enrolment.ended',
      targetType: 'benefit_enrolment',
      targetId: id,
      legalEntityId: enrolment.legalEntityId,
    });
    const updated = await this.prisma.benefitEnrolment.findUniqueOrThrow({ where: { id }, include: { plan: true } });
    return this.enrolmentView(auth, updated, employee, openMonth);
  }

  // ---------- gift vouchers ----------

  /** People the signed-in person may nominate: a manager's direct reports, or anyone in HR's companies */
  async nominees(auth: AuthContext, q?: string) {
    const search: Prisma.EmploymentWhereInput = q
      ? {
          OR: [
            { person: { firstName: { contains: q, mode: 'insensitive' } } },
            { person: { lastName: { contains: q, mode: 'insensitive' } } },
            { employeeNumber: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const hrIn = entityIds(auth, 'people.manage');
    const team = [...(await this.access.team(auth)).entries()].filter(([, depth]) => depth === 1).map(([id]) => id);
    const or: Prisma.EmploymentWhereInput[] = [];
    if (hrIn.length) or.push({ legalEntityId: { in: hrIn } });
    if (team.length) or.push({ id: { in: team } });
    if (!or.length) return [];
    const rows = await this.prisma.employment.findMany({
      where: { AND: [search, { OR: or }], status: 'ACTIVE', endDate: null, legalEntity: { groupId: auth.groupId }, OR: [{ userId: null }, { userId: { not: auth.userId } }] },
      select: { id: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true, name: true, functionalCurrency: true } } },
      orderBy: [{ person: { firstName: 'asc' } }, { person: { lastName: 'asc' } }],
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, name: fullName(r.person), employeeNumber: r.employeeNumber, currency: r.legalEntity.functionalCurrency, entity: { code: r.legalEntity.code, name: r.legalEntity.name } }));
  }

  async nominate(auth: AuthContext, dto: NominateDto) {
    const nominee = await findPerson(this.prisma, auth, dto.employmentId);
    const mine = await this.access.ownEmploymentIds(auth);
    if (nominee.userId === auth.userId || mine.includes(nominee.id)) throw new ForbiddenException('You cannot nominate yourself');
    const manager = await lineManager(this.prisma, nominee.id, nominee.userId);
    const hr = can(auth.access, 'people.manage', nominee.legalEntityId);
    const isManager = !!manager && mine.includes(manager.id);
    if (!hr && !isManager) throw new NotFoundException('Employee not found');
    await this.assertModuleOn(nominee.legalEntityId, nominee.legalEntity.name);
    const all: ApprovalStage[] = manager ? [ApprovalStage.MANAGER, ApprovalStage.HR] : [ApprovalStage.HR];
    // The nominator's own steps count as approved; one person still settles at most one step
    const settled = isManager ? [ApprovalStage.MANAGER] : hr ? [ApprovalStage.HR] : [];
    const steps = settleOwnSteps(all, settled, auth);
    const done = steps.stage === null;
    const voucher = await this.prisma.giftVoucher.create({
      data: {
        employmentId: nominee.id,
        legalEntityId: nominee.legalEntityId,
        occasion: dto.occasion,
        value: dto.value.toFixed(2),
        currency: nominee.legalEntity.functionalCurrency,
        partner: dto.partner || null,
        reason: dto.reason || null,
        status: done ? RequestStatus.APPROVED : RequestStatus.PENDING,
        stages: steps.stages,
        stage: steps.stage,
        approverId: manager?.id ?? null,
        decisions: steps.decisions as unknown as Prisma.InputJsonValue,
        taxMonth: done ? await openPayMonth(this.prisma, nominee.legalEntityId) : null,
        createdById: auth.userId,
      },
    });
    await this.audit.record(auth, {
      action: 'voucher.nominated',
      targetType: 'gift_voucher',
      targetId: voucher.id,
      legalEntityId: nominee.legalEntityId,
      detail: { employmentId: nominee.id, occasion: dto.occasion, value: dto.value },
    });
    const name = fullName(nominee.person);
    if (done) await this.voucherIssued(voucher, nominee);
    else
      await this.notify.stage(
        voucher.stage!,
        voucher.approverId,
        nominee.legalEntity,
        nominee.userId,
        `Gift voucher nomination for ${name}`,
        `${auth.displayName} nominated ${name} for a ${OCCASION_LABEL[dto.occasion].toLowerCase()} gift voucher of ${fmt(toMinor(dto.value), voucher.currency)}.`,
      );
    return { ...this.voucherView(voucher), nominee: name, canCancel: voucher.status === RequestStatus.PENDING };
  }

  async cancelVoucher(auth: AuthContext, id: string) {
    const voucher = await this.findVoucher(auth, id);
    if (voucher.createdById !== auth.userId && !can(auth.access, 'people.manage', voucher.legalEntityId)) throw new ForbiddenException('Only whoever nominated this, or HR, can cancel it');
    const { count } = await this.prisma.giftVoucher.updateMany({
      where: { id, status: RequestStatus.PENDING },
      data: { status: RequestStatus.CANCELLED, stage: null, cancelledById: auth.userId, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('Only a nomination still waiting for approval can be cancelled');
    await this.audit.record(auth, { action: 'voucher.cancelled', targetType: 'gift_voucher', targetId: id, legalEntityId: voucher.legalEntityId });
    return this.voucherView(await this.prisma.giftVoucher.findUniqueOrThrow({ where: { id } }));
  }

  private async voucherIssued(voucher: GiftVoucher, nominee: MoneyPerson) {
    await this.notify.employee(
      nominee.user,
      'You have a gift voucher',
      `Hello ${nominee.person.firstName},\n\nYou were given a ${OCCASION_LABEL[voucher.occasion].toLowerCase()} gift voucher worth ${fmt(toMinor(voucher.value), voucher.currency)}${voucher.partner ? ` for ${voucher.partner}` : ''}.\nHR will send it to you. Its value appears on your ${ymLabel(voucher.taxMonth!)} payslip as a benefit.`,
    );
  }

  // ---------- approvals ----------

  async decide(auth: AuthContext, kind: 'enrolment' | 'voucher', id: string, approve: boolean, note?: string) {
    const mine = await this.access.ownEmploymentIds(auth);
    if (kind === 'enrolment') {
      const e = await this.findEnrolment(auth, id);
      const employee = await findPerson(this.prisma, auth, e.employmentId);
      const step = nextAfterDecision(auth, e, employee, mine, approve, note);
      const data: Prisma.BenefitEnrolmentUpdateManyMutationInput = {
        decisions: step.decisions,
        stage: step.stage,
        ...(step.declined ? { status: RequestStatus.DECLINED } : step.finished ? { status: RequestStatus.APPROVED } : {}),
      };
      const { count } = await this.prisma.benefitEnrolment.updateMany({ where: { id, status: RequestStatus.PENDING, stage: e.stage }, data });
      if (count === 0) throw new ConflictException('Someone else decided this a moment ago. Refresh to see it.');
      await this.audit.record(auth, {
        action: approve ? 'benefit.enrolment.approved' : 'benefit.enrolment.declined',
        targetType: 'benefit_enrolment',
        targetId: id,
        legalEntityId: e.legalEntityId,
        detail: { stage: e.stage, note: note ?? null },
      });
      const name = fullName(employee.person);
      const what = `${KIND_LABEL[e.kind].toLowerCase()} (${e.plan.name}) from ${ymLabel(ymOf(e.startDate))}`;
      if (step.stage) {
        await this.notify.stage(step.stage, null, employee.legalEntity, employee.userId, `${KIND_LABEL[e.kind]} enrolment waiting for ${STAGE_LABEL[step.stage]}: ${name}`, `${STAGE_LABEL[e.stage!]} approved ${name}'s ${what}.`);
      } else {
        await this.notify.employee(
          employee.user,
          `Your ${KIND_LABEL[e.kind].toLowerCase()} was ${approve ? 'approved' : 'declined'}`,
          `Hello ${employee.person.firstName},\n\nYour ${what} was ${approve ? 'approved' : 'declined'}.${note ? `\nNote: ${note}` : ''}`,
        );
      }
      const updated = await this.prisma.benefitEnrolment.findUniqueOrThrow({ where: { id }, include: { plan: true } });
      return { ...this.enrolmentView(auth, updated, employee, await openPayMonth(this.prisma, e.legalEntityId)) };
    }

    const v = await this.findVoucher(auth, id);
    const nominee = await findPerson(this.prisma, auth, v.employmentId);
    if (v.createdById === auth.userId) throw new ForbiddenException('You nominated this voucher, so someone else must approve it');
    const step = nextAfterDecision(auth, v, nominee, mine, approve, note);
    const data: Prisma.GiftVoucherUpdateManyMutationInput = {
      decisions: step.decisions,
      stage: step.stage,
      ...(step.declined ? { status: RequestStatus.DECLINED } : {}),
      ...(step.finished ? { status: RequestStatus.APPROVED, taxMonth: await openPayMonth(this.prisma, v.legalEntityId) } : {}),
    };
    const { count } = await this.prisma.giftVoucher.updateMany({ where: { id, status: RequestStatus.PENDING, stage: v.stage }, data });
    if (count === 0) throw new ConflictException('Someone else decided this a moment ago. Refresh to see it.');
    await this.audit.record(auth, {
      action: approve ? 'voucher.approved' : 'voucher.declined',
      targetType: 'gift_voucher',
      targetId: id,
      legalEntityId: v.legalEntityId,
      detail: { stage: v.stage, note: note ?? null },
    });
    const updated = await this.prisma.giftVoucher.findUniqueOrThrow({ where: { id } });
    const name = fullName(nominee.person);
    const what = `a ${OCCASION_LABEL[v.occasion].toLowerCase()} gift voucher of ${fmt(toMinor(v.value), v.currency)}`;
    if (step.stage) {
      await this.notify.stage(step.stage, updated.approverId, nominee.legalEntity, nominee.userId, `Gift voucher waiting for ${STAGE_LABEL[step.stage]}: ${name}`, `${STAGE_LABEL[v.stage!]} approved ${what} for ${name}.`);
    } else if (step.finished) {
      await this.voucherIssued(updated, nominee);
    }
    // Tell whoever nominated how it went
    if (!step.stage && v.createdById) {
      const nominator = await this.prisma.user.findUnique({ where: { id: v.createdById }, select: { email: true, isActive: true } });
      await this.notify.employee(nominator, `Gift voucher for ${name} ${approve ? 'approved' : 'declined'}`, `Your nomination of ${name} for ${what} was ${approve ? 'approved' : 'declined'}.${note ? `\nNote: ${note}` : ''}`);
    }
    return { ...this.voucherView(updated), nominee: name };
  }

  /** Enrolments and nominations waiting for the signed-in person, for the approvals inbox */
  async pendingFor(auth: AuthContext) {
    const mine = await this.access.ownEmploymentIds(auth);
    const or = waitingFor(auth, mine);
    if (!or.length) return [];
    const where = { status: RequestStatus.PENDING, OR: or, employmentId: { notIn: mine }, employment: { legalEntity: { groupId: auth.groupId } } };
    const [enrolments, vouchers] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({ where, include: { plan: true, employment: PERSON_ROW }, orderBy: { createdAt: 'asc' }, take: 500 }),
      this.prisma.giftVoucher.findMany({ where: { ...where, createdById: { not: auth.userId } }, include: { employment: PERSON_ROW }, orderBy: { createdAt: 'asc' }, take: 500 }),
    ]);
    const notMine = (r: { decisions: Prisma.JsonValue }) => !decisionsOf(r).some((d) => d.byId === auth.userId && d.approved);
    const person = (e: (typeof enrolments)[number]['employment']) => ({ id: e.id, name: fullName(e.person), employeeNumber: e.employeeNumber, entity: e.legalEntity });
    const currencies = new Map(
      (await this.prisma.legalEntity.findMany({ where: { id: { in: [...new Set(enrolments.map((e) => e.legalEntityId))] } }, select: { id: true, functionalCurrency: true } })).map((e) => [e.id, e.functionalCurrency]),
    );
    return [
      ...enrolments.filter(notMine).map((e) => {
        const currency = currencies.get(e.legalEntityId) ?? 'USD';
        return {
          entity: 'enrolment' as const,
          id: e.id,
          title: `${KIND_LABEL[e.kind]}: ${e.plan.name}`,
          employee: person(e.employment),
          amount: null,
          currency,
          details: [
            `From ${ymLabel(ymOf(e.startDate))}${e.plan.provider ? `, ${e.plan.provider}` : ''}`,
            e.plan.paidAsCash
              ? `Paid as a cash allowance of ${fmt(toMinor(e.plan.companyShare), currency)} a month`
              : `Company pays ${fmt(toMinor(e.plan.companyShare), currency)} a month${toMinor(e.plan.employeeShare) > 0 ? `, employee pays ${fmt(toMinor(e.plan.employeeShare), currency)} by payroll deduction` : ''}`,
            ...(e.dietaryNeeds ? [`Dietary needs: ${e.dietaryNeeds}`] : []),
            ...(e.branch ? [`Branch: ${e.branch}`] : []),
            ...(e.emergencyContact ? [`Emergency contact: ${e.emergencyContact}`] : []),
          ],
          stage: e.stage!,
          stageLabel: STAGE_LABEL[e.stage!],
          stages: e.stages.map((s) => STAGE_LABEL[s]),
          decisions: decisionsOf(e),
          receipt: false,
          rulesVersion: null,
          createdAt: e.createdAt.toISOString(),
        };
      }),
      ...vouchers.filter(notMine).map((v) => ({
        entity: 'voucher' as const,
        id: v.id,
        title: `Gift voucher: ${OCCASION_LABEL[v.occasion]}`,
        employee: person(v.employment),
        amount: Number(v.value).toFixed(2),
        currency: v.currency,
        details: [...(v.reason ? [v.reason] : []), ...(v.partner ? [`Partner: ${v.partner}`] : [])],
        stage: v.stage!,
        stageLabel: STAGE_LABEL[v.stage!],
        stages: v.stages.map((s) => STAGE_LABEL[s]),
        decisions: decisionsOf(v),
        receipt: false,
        rulesVersion: null,
        createdAt: v.createdAt.toISOString(),
      })),
    ];
  }

  // ---------- overview for HR, Payroll and Finance ----------

  async overview(auth: AuthContext, q: OverviewQuery) {
    const allowed = auth.entities.map((e) => e.id).filter((id) => this.seesBenefits(auth, id));
    const entityId = q.entityId ?? allowed[0];
    if (!entityId || !allowed.includes(entityId)) throw new NotFoundException('Company not found');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: entityId }, select: { id: true, name: true, functionalCurrency: true } });
    const year = q.year ?? new Date().getUTCFullYear();
    const openMonth = await openPayMonth(this.prisma, entityId);
    const [enrolments, vouchers] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({
        where: { legalEntityId: entityId, OR: [{ status: { in: LIVE } }, { status: RequestStatus.CLOSED, endDate: { gte: monthStart(openMonth) } }] },
        include: { plan: true, employment: PERSON_ROW },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.prisma.giftVoucher.findMany({
        where: { legalEntityId: entityId, createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        include: { employment: PERSON_ROW },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
    ]);
    const running = enrolments.filter((e) => e.status !== RequestStatus.PENDING);
    const row = (e: (typeof enrolments)[number]['employment']) => ({ id: e.id, name: fullName(e.person), employeeNumber: e.employeeNumber });
    return {
      entity: { id: entity.id, name: entity.name, currency: entity.functionalCurrency },
      year,
      monthlyCompanyCost: toMajor(running.reduce((s, e) => s + toMinor(e.plan.companyShare), 0)),
      monthlyEmployeeShare: toMajor(running.reduce((s, e) => s + toMinor(e.plan.employeeShare), 0)),
      vouchersIssuedValue: toMajor(vouchers.filter((v) => v.status === RequestStatus.APPROVED).reduce((s, v) => s + toMinor(v.value), 0)),
      enrolments: enrolments.map((e) => ({ ...this.enrolmentView(auth, e, e.employment, openMonth), employee: row(e.employment) })),
      vouchers: vouchers.map((v) => ({ ...this.voucherView(v), nominee: fullName(v.employment.person), employee: row(v.employment) })),
    };
  }

  // ---------- payroll ----------

  /** Meal and gym benefits running for the whole month, and vouchers issued for it. Used by month-end payroll. */
  async payrollItems(employmentIds: string[], year: number, month: number) {
    const period = ym(year, month);
    const [enrolments, vouchers] = await Promise.all([
      this.prisma.benefitEnrolment.findMany({
        where: {
          employmentId: { in: employmentIds },
          status: { in: [RequestStatus.APPROVED, RequestStatus.CLOSED] },
          startDate: { lte: monthStart(period) },
          OR: [{ endDate: null }, { endDate: { gte: monthEnd(period) } }],
        },
        include: { plan: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.giftVoucher.findMany({ where: { employmentId: { in: employmentIds }, status: RequestStatus.APPROVED, taxMonth: period }, orderBy: { createdAt: 'asc' } }),
    ]);
    const result = new Map<string, { cashAllowances: PayItem[]; benefitsInKind: PayItem[]; voluntary: PayItem[] }>();
    const entry = (id: string) => {
      const e = result.get(id) ?? { cashAllowances: [], benefitsInKind: [], voluntary: [] };
      result.set(id, e);
      return e;
    };
    for (const e of enrolments) {
      const into = entry(e.employmentId);
      const kind = e.kind === BenefitKind.MEAL ? 'Meal' : 'Gym';
      const company = toMinor(e.plan.companyShare);
      const own = toMinor(e.plan.employeeShare);
      if (e.plan.paidAsCash && company > 0) into.cashAllowances.push({ code: `${e.kind}_CASH`, label: e.plan.name, amount: company });
      else if (company > 0) into.benefitsInKind.push({ code: e.kind, label: `${kind}: ${e.plan.name}`, amount: company });
      if (own > 0) into.voluntary.push({ code: `${e.kind}_SHARE`, label: `${kind}: ${e.plan.name} (your share)`, amount: own });
    }
    for (const v of vouchers) entry(v.employmentId).benefitsInKind.push({ code: 'VOUCHER', label: `Gift voucher: ${OCCASION_LABEL[v.occasion]}`, amount: toMinor(v.value) });
    return result;
  }

  // ---------- helpers ----------

  private seesBenefits(auth: AuthContext, legalEntityId: string) {
    return can(auth.access, 'people.manage', legalEntityId) || can(auth.access, 'payroll.read', legalEntityId) || can(auth.access, 'finance.read', legalEntityId);
  }

  private async moduleOn(legalEntityId: string) {
    const f = await this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId, module: 'benefits' } } });
    return !!f?.enabled;
  }

  private async assertModuleOn(legalEntityId: string, name: string) {
    if (!(await this.moduleOn(legalEntityId))) throw new ForbiddenException(`Meal, gym and gift-voucher benefits are switched off for ${name}`);
  }

  /** An enrolment the caller may see: their own, HR, Payroll or Finance for the company, or an approver */
  private async findEnrolment(auth: AuthContext, id: string): Promise<EnrolmentWithPlan> {
    const e = await this.prisma.benefitEnrolment.findFirst({ where: { id, employment: { legalEntity: { groupId: auth.groupId } } }, include: { plan: true, employment: { select: { userId: true } } } });
    if (!e) throw new NotFoundException('Enrolment not found');
    const { employment, ...rest } = e;
    if (employment.userId !== auth.userId && !this.seesBenefits(auth, e.legalEntityId) && !involved(auth, e, await this.access.ownEmploymentIds(auth))) {
      throw new NotFoundException('Enrolment not found');
    }
    return rest;
  }

  /** A voucher the caller may see: the nominee, whoever nominated it, HR, Payroll or Finance for the company, or an approver */
  private async findVoucher(auth: AuthContext, id: string): Promise<GiftVoucher> {
    const v = await this.prisma.giftVoucher.findFirst({ where: { id, employment: { legalEntity: { groupId: auth.groupId } } }, include: { employment: { select: { userId: true } } } });
    if (!v) throw new NotFoundException('Voucher not found');
    const { employment, ...rest } = v;
    if (employment.userId !== auth.userId && v.createdById !== auth.userId && !this.seesBenefits(auth, v.legalEntityId) && !involved(auth, v, await this.access.ownEmploymentIds(auth))) {
      throw new NotFoundException('Voucher not found');
    }
    return rest;
  }

  private planView(p: BenefitPlan, currency: string) {
    return {
      id: p.id,
      entityId: p.legalEntityId,
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

  private enrolmentView(auth: AuthContext, e: EnrolmentWithPlan, employee: { userId: string | null }, openMonth: number) {
    const own = employee.userId === auth.userId;
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
      canEnd: live && (own || can(auth.access, 'people.manage', e.legalEntityId)),
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
