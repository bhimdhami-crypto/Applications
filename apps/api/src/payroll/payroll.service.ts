import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PayrollRun, PayrollStatus, Prisma, PrismaClient, RequestStatus } from '@prisma/client';
import { can } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { ApprovalNotifier } from '../approvals/notify.service';
import { ymLabel } from '../approvals/pay-month';
import { fullName, toMinor } from '../approvals/people';
import { AuditService } from '../audit/audit.service';
import { BenefitsService } from '../benefits/benefits.service';
import { fromIso, toIso, workingDays } from '../leave/calendar';
import { LeaveService } from '../leave/leave.service';
import { LoansService } from '../loans/loans.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeSlip, leaveLabel, monthBounds, partMonth } from './compute';
import { CreateRunDto, PeriodDto } from './payroll.dto';
import { rulesFor } from './rules';

const major = (minor: number) => (minor / 100).toFixed(2);
const ENTITY = { id: true, code: true, name: true, groupId: true, countryCode: true, functionalCurrency: true, weekendDays: true } as const;
type Entity = Prisma.LegalEntityGetPayload<{ select: typeof ENTITY }>;
const STATUS_WORD: Record<PayrollStatus, string> = { DRAFT: 'a draft', SUBMITTED: 'waiting for approval', APPROVED: 'approved', FINALIZED: 'final' };
/** Payslip line codes that repay a loan, an advance or an IOU */
const LOAN_CODES = new Set(['LOAN', 'ADVANCE', 'IOU']);

interface StoredLine {
  code: string;
  label: string;
  kind: string;
  amount: number;
  ref?: string;
  interest?: number;
}
export interface SlipEmployee {
  employeeNumber: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  hireDate: string;
}

/**
 * Month-end payroll carried over from the first build, with maker and checker: Payroll prepares a
 * company's month from its draft country pack, someone else approves it, and finalising publishes the
 * payslips and records loan repayments. Packs not signed off by a local expert are marked unverified
 * on every run and payslip, so no figure is presented as a certified calculation.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifier: ApprovalNotifier,
    private readonly leave: LeaveService,
    private readonly loans: LoansService,
    private readonly benefits: BenefitsService,
  ) {}

  // ---------- runs ----------

  /** Companies the caller sees payroll for, with their pack, and their runs for a year */
  async overview(auth: AuthContext, year = new Date().getUTCFullYear()) {
    const ids = entityIds(auth, 'payroll.read');
    const [entities, features, runs] = await Promise.all([
      this.prisma.legalEntity.findMany({ where: { id: { in: ids } }, select: ENTITY, orderBy: { code: 'asc' } }),
      this.prisma.entityFeature.findMany({ where: { legalEntityId: { in: ids }, module: 'payroll' } }),
      this.prisma.payrollRun.findMany({ where: { legalEntityId: { in: ids }, year }, orderBy: [{ month: 'desc' }] }),
    ]);
    const on = new Map(features.map((f) => [f.legalEntityId, f.enabled]));
    return {
      year,
      companies: entities.map((e) => {
        const pack = rulesFor(e.countryCode);
        return {
          id: e.id,
          code: e.code,
          name: e.name,
          countryCode: e.countryCode,
          currency: e.functionalCurrency,
          payrollOn: !!on.get(e.id),
          rules: pack ? { version: pack.version, verified: pack.verified } : null,
          canPrepare: can(auth.access, 'payroll.prepare', e.id),
          canApprove: can(auth.access, 'payroll.approve', e.id),
          runs: runs.filter((r) => r.legalEntityId === e.id).map((r) => this.summary(r)),
        };
      }),
    };
  }

  private summary(r: PayrollRun) {
    return {
      id: r.id,
      year: r.year,
      month: r.month,
      period: ymLabel(r.year * 100 + r.month),
      status: r.status,
      currency: r.currency,
      rulesVersion: r.rulesVersion,
      rulesVerified: r.rulesVerified,
      headcount: r.headcount,
      totalGross: r.totalGross,
      totalDeductions: r.totalDeductions,
      totalNet: r.totalNet,
      totalEmployerCost: r.totalEmployerCost,
      exceptions: (r.exceptions as unknown as unknown[]).length,
    };
  }

  private async findRun(auth: AuthContext, id: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id, legalEntity: { groupId: auth.groupId } }, include: { legalEntity: { select: ENTITY } } });
    if (!run || !can(auth.access, 'payroll.read', run.legalEntityId)) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /** A run with every payslip's totals, and what the caller may do with it */
  async get(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    const [slips, people] = await Promise.all([
      this.prisma.payslip.findMany({ where: { runId: id }, select: { id: true, employmentId: true, employee: true, gross: true, deductions: true, net: true, employerCost: true }, orderBy: { employee: 'asc' } }),
      this.prisma.user.findMany({ where: { id: { in: [run.createdById, run.submittedById, run.approvedById, run.finalizedById].filter((x): x is string => !!x) } }, select: { id: true, displayName: true } }),
    ]);
    const who = (userId: string | null) => (userId ? (people.find((p) => p.id === userId)?.displayName ?? 'A former user') : null);
    const preparer = run.submittedById === auth.userId || run.createdById === auth.userId;
    return {
      ...this.summary(run),
      entity: { id: run.legalEntity.id, code: run.legalEntity.code, name: run.legalEntity.name, countryCode: run.legalEntity.countryCode },
      exceptions: run.exceptions,
      calculatedAt: run.calculatedAt,
      returnNote: run.returnNote,
      trail: {
        createdBy: run.createdById ? who(run.createdById) : 'Demo history',
        createdAt: run.createdAt,
        submittedBy: who(run.submittedById),
        submittedAt: run.submittedAt,
        approvedBy: who(run.approvedById),
        approvedAt: run.approvedAt,
        finalizedBy: who(run.finalizedById),
        finalizedAt: run.finalizedAt,
      },
      can: {
        prepare: run.status === PayrollStatus.DRAFT && can(auth.access, 'payroll.prepare', run.legalEntityId),
        approve: run.status === PayrollStatus.SUBMITTED && can(auth.access, 'payroll.approve', run.legalEntityId) && !preparer,
        sendBack: (run.status === PayrollStatus.SUBMITTED || run.status === PayrollStatus.APPROVED) && can(auth.access, 'payroll.approve', run.legalEntityId),
        finalize: run.status === PayrollStatus.APPROVED && can(auth.access, 'payroll.approve', run.legalEntityId),
        preparedByYou: preparer,
      },
      payslips: slips
        .map((s) => ({ id: s.id, employmentId: s.employmentId, ...(s.employee as unknown as SlipEmployee), gross: s.gross, deductions: s.deductions, net: s.net, employerCost: s.employerCost }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** The payroll register as CSV, one row per payslip with every line code as a column */
  async register(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    const slips = await this.prisma.payslip.findMany({ where: { runId: id } });
    const codes = new Map<string, string>();
    for (const s of slips) for (const l of s.lines as unknown as StoredLine[]) if (!codes.has(l.code)) codes.set(l.code, `${l.label.replace(/ \(.*\)$/, '')} (${l.kind.toLowerCase()})`);
    const esc = (v: string | number) => {
      const s = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['Employee number', 'Name', 'Job title', 'Department', ...[...codes.values()], 'Gross', 'Deductions', 'Net', 'Employer cost'];
    const rows = slips
      .map((s) => {
        const e = s.employee as unknown as SlipEmployee;
        const lines = s.lines as unknown as StoredLine[];
        const sum = (code: string) => lines.filter((l) => l.code === code).reduce((t, l) => t + Math.round(l.amount * 100), 0);
        return [e.employeeNumber, e.name, e.jobTitle ?? '', e.department ?? '', ...[...codes.keys()].map((c) => major(sum(c))), String(s.gross), String(s.deductions), String(s.net), String(s.employerCost)];
      })
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const banner = run.rulesVerified ? [] : [[`UNVERIFIED DRAFT RULES (${run.rulesVersion}): not certified for real payment`]];
    await this.audit.record(auth, { action: 'payroll.register.exported', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: { rows: rows.length } });
    return {
      fileName: `payroll-${run.legalEntity.code}-${run.year}-${String(run.month).padStart(2, '0')}.csv`,
      csv: [...banner, head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n',
    };
  }

  private async assertCanRun(entity: Entity) {
    const f = await this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId: entity.id, module: 'payroll' } } });
    if (!f?.enabled) throw new ForbiddenException(`Payroll is switched off for ${entity.name}`);
    const pack = rulesFor(entity.countryCode);
    if (!pack) throw new UnprocessableEntityException(`${entity.name} has no payroll rules in the portal yet, so its payroll cannot be run here`);
    return pack;
  }

  async create(auth: AuthContext, dto: CreateRunDto) {
    if (!auth.entities.some((e) => e.id === dto.entityId) || !can(auth.access, 'payroll.prepare', dto.entityId)) throw new NotFoundException('Company not found');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: dto.entityId }, select: ENTITY });
    const pack = await this.assertCanRun(entity);
    const later = await this.prisma.payrollRun.findFirst({ where: { legalEntityId: entity.id, status: { not: PayrollStatus.DRAFT }, OR: [{ year: { gt: dto.year } }, { year: dto.year, month: { gt: dto.month } }] } });
    if (later) throw new ConflictException(`${entity.name} already has a later payroll (${ymLabel(later.year * 100 + later.month)}) under way or final`);
    let run: PayrollRun;
    try {
      run = await this.prisma.payrollRun.create({
        data: { legalEntityId: entity.id, year: dto.year, month: dto.month, currency: entity.functionalCurrency, rulesVersion: pack.version, rulesVerified: pack.verified, createdById: auth.userId },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException(`${entity.name} already has a payroll for ${ymLabel(dto.year * 100 + dto.month)}`);
      throw err;
    }
    await this.calculate(run.id);
    await this.audit.record(auth, { action: 'payroll.created', targetType: 'payroll_run', targetId: run.id, legalEntityId: entity.id, detail: { year: dto.year, month: dto.month, rules: pack.version } });
    return this.get(auth, run.id);
  }

  /** Drafts the month for every company the caller prepares payroll for, skipping those that cannot run */
  async createAll(auth: AuthContext, dto: PeriodDto) {
    const ids = entityIds(auth, 'payroll.prepare');
    const entities = await this.prisma.legalEntity.findMany({ where: { id: { in: ids } }, select: ENTITY, orderBy: { code: 'asc' } });
    const created: string[] = [];
    const skipped: Array<{ code: string; reason: string }> = [];
    for (const e of entities) {
      try {
        await this.create(auth, { entityId: e.id, year: dto.year, month: dto.month });
        created.push(e.code);
      } catch (err) {
        if (err instanceof ConflictException || err instanceof ForbiddenException || err instanceof UnprocessableEntityException) skipped.push({ code: e.code, reason: err.message });
        else throw err;
      }
    }
    return { period: ymLabel(dto.year * 100 + dto.month), created, skipped };
  }

  private assertPrepare(auth: AuthContext, run: { legalEntityId: string }) {
    if (!can(auth.access, 'payroll.prepare', run.legalEntityId)) throw new ForbiddenException('Only payroll operators can change a payroll');
  }

  private assertApprove(auth: AuthContext, run: { legalEntityId: string }) {
    if (!can(auth.access, 'payroll.approve', run.legalEntityId)) throw new ForbiddenException('Only payroll approvers can do this');
  }

  /** Moves a run from one status to the next, failing when someone else moved it first */
  private async move(run: { id: string; status: PayrollStatus }, from: PayrollStatus[], data: Prisma.PayrollRunUpdateManyMutationInput, tx: Prisma.TransactionClient = this.prisma) {
    const { count } = await tx.payrollRun.updateMany({ where: { id: run.id, status: { in: from } }, data });
    if (count === 0) {
      const now = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      throw new ConflictException(`This payroll is ${STATUS_WORD[now.status]}, so that cannot be done now`);
    }
  }

  async recalculate(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    this.assertPrepare(auth, run);
    if (run.status !== PayrollStatus.DRAFT) throw new ConflictException('Only a draft payroll can be recalculated');
    await this.assertCanRun(run.legalEntity);
    await this.calculate(id);
    await this.audit.record(auth, { action: 'payroll.recalculated', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: {} });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    this.assertPrepare(auth, run);
    const { count } = await this.prisma.payrollRun.deleteMany({ where: { id, status: PayrollStatus.DRAFT } });
    if (!count) throw new ConflictException('Only a draft payroll can be deleted');
    await this.audit.record(auth, { action: 'payroll.deleted', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: { year: run.year, month: run.month } });
    return { deleted: true };
  }

  async submit(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    this.assertPrepare(auth, run);
    if (!run.headcount) throw new BadRequestException('There are no payslips in this payroll');
    await this.move(run, [PayrollStatus.DRAFT], { status: PayrollStatus.SUBMITTED, submittedById: auth.userId, submittedAt: new Date(), returnNote: null });
    await this.audit.record(auth, { action: 'payroll.submitted', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: {} });
    const period = ymLabel(run.year * 100 + run.month);
    for (const to of await this.notifier.holders('payroll.approve', run.legalEntity, auth.userId)) {
      await this.mail.send({
        to,
        subject: `Payroll to approve: ${run.legalEntity.name}, ${period}`,
        text: `${auth.displayName} prepared the ${period} payroll for ${run.legalEntity.name} (${run.headcount} payslips) and sent it for approval.${run.rulesVerified ? '' : `\nIt uses unverified draft rules (${run.rulesVersion}).`}\n\nReview it in the HR portal under Payroll.`,
      });
    }
    return this.get(auth, id);
  }

  /** The checker approves; never the person who prepared or submitted it */
  async approve(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    this.assertApprove(auth, run);
    if (run.submittedById === auth.userId || run.createdById === auth.userId) throw new ForbiddenException('You prepared this payroll, so someone else must approve it');
    await this.move(run, [PayrollStatus.SUBMITTED], { status: PayrollStatus.APPROVED, approvedById: auth.userId, approvedAt: new Date() });
    await this.audit.record(auth, { action: 'payroll.approved', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: { totalNet: String(run.totalNet), headcount: run.headcount } });
    return this.get(auth, id);
  }

  /** Sends a submitted or approved run back to the preparer to change */
  async sendBack(auth: AuthContext, id: string, note: string) {
    const run = await this.findRun(auth, id);
    this.assertApprove(auth, run);
    await this.move(run, [PayrollStatus.SUBMITTED, PayrollStatus.APPROVED], { status: PayrollStatus.DRAFT, returnNote: note, submittedById: null, submittedAt: null, approvedById: null, approvedAt: null });
    await this.audit.record(auth, { action: 'payroll.sent.back', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: { note } });
    const preparer = run.submittedById ?? run.createdById;
    const user = preparer ? await this.prisma.user.findUnique({ where: { id: preparer }, select: { email: true, isActive: true } }) : null;
    if (user?.isActive) {
      const period = ymLabel(run.year * 100 + run.month);
      await this.mail.send({ to: user.email, subject: `Payroll sent back: ${run.legalEntity.name}, ${period}`, text: `${auth.displayName} sent the ${period} payroll for ${run.legalEntity.name} back to you.\nNote: ${note}` });
    }
    return this.get(auth, id);
  }

  /** Locks the run, records loan repayments from its payslips and tells employees their payslip is ready */
  async finalize(auth: AuthContext, id: string) {
    const run = await this.findRun(auth, id);
    this.assertApprove(auth, run);
    const repaid = await this.prisma.$transaction(async (tx) => {
      await this.move(run, [PayrollStatus.APPROVED], { status: PayrollStatus.FINALIZED, finalizedById: auth.userId, finalizedAt: new Date() }, tx);
      const n = await this.recordRepayments(tx, run, auth.userId);
      await this.audit.record(auth, { action: 'payroll.finalized', targetType: 'payroll_run', targetId: id, legalEntityId: run.legalEntityId, detail: { loanRepayments: n } }, tx);
      return n;
    });
    const period = ymLabel(run.year * 100 + run.month);
    const people = await this.prisma.payslip.findMany({ where: { runId: id, employment: { user: { isActive: true } } }, select: { employment: { select: { person: { select: { firstName: true } }, user: { select: { email: true } } } } } });
    for (const p of people) {
      // Amounts stay in the portal, behind sign-in
      await this.mail.send({ to: p.employment.user!.email, subject: `Your payslip for ${period} is ready`, text: `Hello ${p.employment.person.firstName},\n\nYour payslip for ${period} is in the HR portal under Payslips.` });
    }
    return { ...(await this.get(auth, id)), loanRepayments: repaid };
  }

  /** Each loan, advance or IOU line on the run's payslips becomes a repayment; fully repaid loans close */
  private async recordRepayments(tx: Prisma.TransactionClient, run: PayrollRun, userId: string | null) {
    const slips = await tx.payslip.findMany({ where: { runId: run.id }, select: { id: true, lines: true } });
    const touched = new Set<string>();
    let n = 0;
    for (const s of slips) {
      for (const l of s.lines as unknown as StoredLine[]) {
        if (!l.ref || !LOAN_CODES.has(l.code) || l.amount <= 0) continue;
        const amount = Math.round(l.amount * 100);
        const interest = Math.round((l.interest ?? 0) * 100);
        await tx.loanRepayment.create({
          data: {
            loanId: l.ref,
            payslipId: s.id,
            year: run.year,
            month: run.month,
            amount: major(amount),
            principal: major(amount - interest),
            interest: major(interest),
            source: /final dues/.test(l.label) ? 'FINAL_DUES' : 'PAYROLL',
            createdById: userId,
          },
        });
        touched.add(l.ref);
        n++;
      }
    }
    const loans = await tx.loan.findMany({ where: { id: { in: [...touched] } }, include: { repayments: { select: { principal: true } } } });
    for (const l of loans) {
      const left = toMinor(l.recoverable) - l.repayments.reduce((t, r) => t + toMinor(r.principal), 0);
      if (left <= 0 && l.status === RequestStatus.APPROVED) await tx.loan.update({ where: { id: l.id }, data: { status: RequestStatus.CLOSED } });
    }
    return n;
  }

  // ---------- payslips ----------

  /** The caller's own payslips from finalised runs */
  async mine(auth: AuthContext) {
    const slips = await this.prisma.payslip.findMany({
      where: { employment: { userId: auth.userId }, run: { status: PayrollStatus.FINALIZED, legalEntity: { groupId: auth.groupId } } },
      select: { id: true, currency: true, gross: true, deductions: true, net: true, run: { select: { year: true, month: true, rulesVersion: true, rulesVerified: true, legalEntity: { select: { code: true, name: true } } } } },
      orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
    });
    return slips.map((s) => ({
      id: s.id,
      period: ymLabel(s.run.year * 100 + s.run.month),
      year: s.run.year,
      month: s.run.month,
      company: s.run.legalEntity,
      currency: s.currency,
      gross: s.gross,
      deductions: s.deductions,
      net: s.net,
      rulesVersion: s.run.rulesVersion,
      rulesVerified: s.run.rulesVerified,
    }));
  }

  /** One payslip: the employee's own once final, or any in a company the caller reads payroll for */
  async payslip(auth: AuthContext, id: string) {
    const s = await this.prisma.payslip.findFirst({
      where: { id, run: { legalEntity: { groupId: auth.groupId } } },
      include: { employment: { select: { userId: true } }, run: { include: { legalEntity: { select: { code: true, name: true, address: true, taxNumber: true, countryCode: true } } } } },
    });
    if (!s) throw new NotFoundException('Payslip not found');
    const own = s.employment.userId === auth.userId && s.run.status === PayrollStatus.FINALIZED;
    if (!own && !can(auth.access, 'payroll.read', s.legalEntityId)) throw new NotFoundException('Payslip not found');
    if (!own) await this.audit.record(auth, { action: 'payslip.viewed', targetType: 'payslip', targetId: id, legalEntityId: s.legalEntityId, detail: { runId: s.runId } });
    return {
      id: s.id,
      runId: s.runId,
      period: ymLabel(s.run.year * 100 + s.run.month),
      status: s.run.status,
      company: s.run.legalEntity,
      employee: s.employee,
      currency: s.currency,
      gross: s.gross,
      deductions: s.deductions,
      net: s.net,
      employerCost: s.employerCost,
      lines: s.lines,
      annualLeaveLeft: s.annualLeaveLeft,
      rulesVersion: s.run.rulesVersion,
      rulesVerified: s.run.rulesVerified,
      finalizedAt: s.run.finalizedAt,
    };
  }

  private calculate(runId: string) {
    return calculateRun(this.prisma, { leave: this.leave, loans: this.loans, benefits: this.benefits }, runId);
  }
}

/** Where a run's leave cuts, loan recoveries and benefit lines come from; the demo seed passes its own */
export interface PaySources {
  leave: Pick<LeaveService, 'holidaySet' | 'payCuts' | 'annualLeftMany'>;
  loans: Pick<LoansService, 'payrollItems'>;
  benefits: Pick<BenefitsService, 'payrollItems'>;
}

/** Works out every payslip of a draft run from pay records, leave, loans and benefits in force for the month */
export async function calculateRun(prisma: PrismaClient, sources: PaySources, runId: string) {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { legalEntity: { select: ENTITY } } });
  const entity = run.legalEntity;
  const pack = rulesFor(entity.countryCode)!;
  const { start, end } = monthBounds(run.year, run.month);
  const [from, to] = [fromIso(start), fromIso(end)];
  const staff = await prisma.employment.findMany({
    where: { legalEntityId: entity.id, hireDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
    select: {
      id: true,
      employeeNumber: true,
      hireDate: true,
      endDate: true,
      person: { select: { firstName: true, lastName: true, dateOfBirth: true } },
      compensation: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
      assignments: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { jobTitle: true, department: { select: { name: true } } } },
    },
    orderBy: { employeeNumber: 'asc' },
  });
  const ids = staff.map((e) => e.id);
  const holidays = await sources.leave.holidaySet(entity.countryCode, start, end);
  const holidaySet = new Set(holidays.keys());
  const monthDays = workingDays(start, end, entity.weekendDays, holidaySet).length;
  const [cuts, annualLeft, owed, perks] = await Promise.all([
    sources.leave.payCuts(ids, entity, start, end),
    sources.leave.annualLeftMany(staff.map((e) => ({ id: e.id, hireDate: e.hireDate, person: e.person, legalEntity: { countryCode: entity.countryCode } })), run.year),
    sources.loans.payrollItems(staff, run.year, run.month, to),
    sources.benefits.payrollItems(ids, run.year, run.month),
  ]);

  const exceptions: Array<{ employmentId: string; employeeNumber: string; name: string; reason: string }> = [];
  const totals = { gross: 0, deductions: 0, net: 0, employerCost: 0 };
  const rows: Prisma.PayslipCreateManyInput[] = [];
  for (const e of staff) {
    const name = fullName(e.person);
    const pay = e.compensation[0];
    if (!pay) {
      exceptions.push({ employmentId: e.id, employeeNumber: e.employeeNumber, name, reason: 'No pay record for this month' });
      continue;
    }
    if (pay.currency !== entity.functionalCurrency) {
      exceptions.push({ employmentId: e.id, employeeNumber: e.employeeNumber, name, reason: `Pay record is in ${pay.currency}, not ${entity.functionalCurrency}` });
      continue;
    }
    const basic = toMinor(pay.baseAmount);
    const part = partMonth(start, end, toIso(e.hireDate), e.endDate ? toIso(e.endDate) : null, entity.weekendDays, holidaySet);
    const cut = cuts.get(e.id);
    const lost = Math.min(monthDays, (part?.missed ?? 0) + (cut ? cut.unpaidDays + cut.halfPayDays / 2 : 0));
    const labels = [part?.label, cut ? leaveLabel(cut, monthDays) : null].filter(Boolean).join('; ');
    const slip = computeSlip(pack, {
      basic,
      allowances: Math.round((toMinor(pay.allowances) * (monthDays - (part?.missed ?? 0))) / Math.max(1, monthDays)),
      withheld: lost > 0 && monthDays > 0 ? { amount: Math.round((basic * lost) / monthDays), label: labels } : undefined,
      perks: perks.get(e.id),
      loans: owed.get(e.id),
      year: run.year,
      month: run.month,
      birthDate: e.person.dateOfBirth ? toIso(e.person.dateOfBirth) : undefined,
    });
    totals.gross += slip.minor.gross;
    totals.deductions += slip.minor.deductions;
    totals.net += slip.minor.net;
    totals.employerCost += slip.minor.employerCost;
    const employee: SlipEmployee = { employeeNumber: e.employeeNumber, name, jobTitle: e.assignments[0]?.jobTitle ?? null, department: e.assignments[0]?.department?.name ?? null, hireDate: toIso(e.hireDate) };
    rows.push({
      runId,
      employmentId: e.id,
      legalEntityId: entity.id,
      currency: entity.functionalCurrency,
      gross: slip.gross,
      deductions: slip.deductions,
      net: slip.net,
      employerCost: slip.employerCost,
      lines: slip.lines as unknown as Prisma.InputJsonValue,
      employee: employee as unknown as Prisma.InputJsonValue,
      annualLeaveLeft: annualLeft.get(e.id) ?? null,
    });
  }
  await prisma.$transaction([
    prisma.payslip.deleteMany({ where: { runId } }),
    prisma.payslip.createMany({ data: rows }),
    prisma.payrollRun.update({
      where: { id: runId },
      data: {
        rulesVersion: pack.version,
        rulesVerified: pack.verified,
        headcount: rows.length,
        totalGross: major(totals.gross),
        totalDeductions: major(totals.deductions),
        totalNet: major(totals.net),
        totalEmployerCost: major(totals.employerCost),
        exceptions: exceptions as unknown as Prisma.InputJsonValue,
        calculatedAt: new Date(),
      },
    }),
  ]);
}
