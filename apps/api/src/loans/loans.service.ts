import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStage, EmploymentType, Loan, LoanKind, LoanProduct, LoanRepayment, Prisma, RequestStatus, Role } from '@prisma/client';
import { ApprovalNotifier } from '../approvals/notify.service';
import { openPayMonth } from '../approvals/pay-month';
import { actorInfo, findPerson, fullName, ownPerson, Person, toMajor, toMinor } from '../approvals/people';
import { activeManager, decisionsOf, nextAfterDecision, STAGE_LABEL } from '../approvals/stages';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { toIso } from '../leave/calendar';
import { PayItem, rulesFor } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService, UploadedFileLike } from '../profiles/profiles.service';
import {
  addMonths,
  ADVANCE_EVERY_MONTHS,
  ADVANCE_MAX_SHARE,
  HOUSING_MAX_TIMES_GROSS,
  instalmentFor,
  IOU_SETTLE_DAYS,
  KIND_LABEL,
  LOAN_MAX_MONTHS,
  LOAN_MAX_TIMES_GROSS,
  LOAN_PRODUCTS,
  LOAN_RULES_VERSION,
  loanTitle,
  MIN_TAKE_HOME_SHARE,
  monthsBetween,
  PROBATION_MONTHS,
  projection,
  schedule,
  ym,
  ymLabel,
  ymOf,
} from './loan-rules';
import { CashRepaymentDto, CreateLoanDto, LoanBookQuery, LoanQuoteQuery, SettleIouDto } from './loans.dto';

/** POL-22 3.8: loan details are for the employee, Payroll, Finance and the approvers only */
const SEES_LOAN_BOOK: Role[] = [Role.ADMIN, Role.PAYROLL, Role.FINANCE];
const LIVE: RequestStatus[] = [RequestStatus.PENDING, RequestStatus.APPROVED];
const today = () => toIso(new Date());
const addDays = (iso: string, n: number) => toIso(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const fmt = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type LoanWithRepayments = Loan & { repayments: LoanRepayment[] };

/** Principal still to recover, in minor units */
export const outstandingOf = (l: LoanWithRepayments) => Math.max(0, toMinor(l.recoverable) - l.repayments.reduce((s, r) => s + toMinor(r.principal), 0));

export interface Quote {
  currency: string;
  instalment: number;
  months: number;
  yearlyRate: number;
  totalInterest: number;
  firstMonth: number;
  firstMonthLabel: string;
  lastMonthLabel: string;
  gross: number | null;
  net: number | null;
  /** Other deductions already agreed each month (loans, advances, gym and meal shares) */
  commitments: number;
  takeHome: number | null;
  takeHomeFloor: number | null;
  stages: ApprovalStage[];
  problems: string[];
}

/**
 * Salary advances, staff loans and IOUs (POL-22): requests and their approval steps,
 * the deductions each payroll run makes, and the repayments recorded when a run is finalized.
 */
@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: ApprovalNotifier,
    private readonly profiles: ProfilesService,
  ) {}

  // ---------- limits and quotes ----------

  openMonth(companyId: string) {
    return openPayMonth(this.prisma, companyId);
  }

  /** Estimated monthly pay from the country's payroll rules, and what is already deducted each month */
  private async payPicture(employee: Person) {
    const pack = rulesFor(employee.company.countryCode);
    const [loans, enrolments] = await Promise.all([
      // Advances and IOUs are one-off; only loan instalments recur every month
      this.prisma.loan.findMany({ where: { employeeId: employee.id, status: { in: LIVE }, kind: LoanKind.LOAN }, include: { repayments: true } }),
      this.prisma.benefitEnrolment.findMany({
        where: { employeeId: employee.id, status: { in: LIVE }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        select: { plan: { select: { employeeShare: true } } },
      }),
    ]);
    const commitments =
      loans.filter((l) => l.status === RequestStatus.PENDING || outstandingOf(l) > 0).reduce((s, l) => s + toMinor(l.instalment), 0) +
      enrolments.reduce((s, e) => s + toMinor(e.plan.employeeShare), 0);
    if (!pack) return { pack: null, gross: null, net: null, commitments };
    const r = pack.calculate({ basic: toMinor(employee.monthlyBasic), allowances: toMinor(employee.monthlyAllowances) });
    return { pack, gross: r.gross, net: r.net, commitments };
  }

  /** What a request would cost each month and whether the policy allows it */
  async check(employee: Person, q: { kind: LoanKind; product?: LoanProduct; amount: number; months?: number; neededOn?: string; settleBy?: string }): Promise<Quote> {
    const problems: string[] = [];
    const amount = Math.round(q.amount * 100);
    const cur = employee.company.currency;
    const pay = await this.payPicture(employee);
    const firstMonth = await this.openMonth(employee.companyId);
    const months = q.kind === LoanKind.LOAN ? q.months ?? 12 : 1;
    const yearlyRate = q.kind === LoanKind.LOAN && q.product ? LOAN_PRODUCTS[q.product].yearlyRate : 0;
    const instalment = instalmentFor(amount, months, yearlyRate);
    const plan = schedule(amount, months, yearlyRate, firstMonth);
    const manager = activeManager(employee);
    const stages: ApprovalStage[] = manager ? [ApprovalStage.MANAGER] : [];

    if (employee.exitDate && q.kind !== LoanKind.IOU) problems.push('Advances and loans are not available once a leaving date is set');
    if (q.kind !== LoanKind.IOU && !pay.pack) {
      problems.push(`Payroll for ${employee.company.name} is not set up in the portal yet, so it cannot recover a ${KIND_LABEL[q.kind].toLowerCase()}`);
    }

    if (q.kind === LoanKind.ADVANCE) {
      stages.push(ApprovalStage.PAYROLL, ApprovalStage.FINANCE);
      if (pay.net !== null && amount > Math.floor(pay.net * ADVANCE_MAX_SHARE)) {
        problems.push(`An advance can be at most half of your net pay, which is ${fmt(Math.floor(pay.net * ADVANCE_MAX_SHARE), cur)}`);
      }
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - ADVANCE_EVERY_MONTHS);
      const recent = await this.prisma.loan.findFirst({
        where: { employeeId: employee.id, kind: LoanKind.ADVANCE, status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED, RequestStatus.CLOSED] }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        const next = new Date(recent.createdAt);
        next.setUTCMonth(next.getUTCMonth() + ADVANCE_EVERY_MONTHS);
        problems.push(`One advance is allowed in any 3 months. You asked for one on ${toIso(recent.createdAt)}, so the next is possible from ${toIso(next)}`);
      }
    } else if (q.kind === LoanKind.LOAN) {
      stages.push(ApprovalStage.HR, ApprovalStage.FINANCE);
      if (!q.product) problems.push('Choose a loan product');
      if (employee.employmentType !== EmploymentType.PERMANENT) problems.push('Staff loans are for permanent employees');
      else if (monthsBetween(employee.hireDate, new Date()) < PROBATION_MONTHS) problems.push(`Staff loans are available after probation (${PROBATION_MONTHS} months from joining)`);
      if (months > LOAN_MAX_MONTHS) problems.push(`Loans are repaid over at most ${LOAN_MAX_MONTHS} months`);
      if (pay.gross !== null) {
        const limit = pay.gross * LOAN_MAX_TIMES_GROSS;
        if (amount > limit) {
          if (q.product === 'HOUSING' && amount <= pay.gross * HOUSING_MAX_TIMES_GROSS) stages.push(ApprovalStage.COUNTRY_HEAD);
          else if (q.product === 'HOUSING') problems.push(`A housing loan can be at most ${HOUSING_MAX_TIMES_GROSS} times monthly gross pay (${fmt(pay.gross * HOUSING_MAX_TIMES_GROSS, cur)})`);
          else problems.push(`A loan can be at most 3 times monthly gross pay (${fmt(limit, cur)}). Only housing loans may go higher.`);
        }
      }
    } else {
      stages.push(ApprovalStage.FINANCE);
      const needed = (q.neededOn ?? today()).slice(0, 10);
      const settleBy = (q.settleBy ?? addDays(needed, IOU_SETTLE_DAYS)).slice(0, 10);
      if (needed < today()) problems.push('The date needed cannot be in the past');
      if (settleBy < needed) problems.push('The settlement date is before the date needed');
      if (settleBy > addDays(needed, IOU_SETTLE_DAYS)) problems.push(`An IOU must be settled with receipts within ${IOU_SETTLE_DAYS} days of the date needed`);
    }

    let takeHome: number | null = null;
    let takeHomeFloor: number | null = null;
    if (q.kind !== LoanKind.IOU && pay.net !== null && pay.gross !== null) {
      takeHome = pay.net - pay.commitments - instalment;
      takeHomeFloor = Math.ceil(pay.gross * MIN_TAKE_HOME_SHARE);
      if (takeHome < takeHomeFloor) {
        problems.push(
          `This would leave take-home pay of ${fmt(takeHome, cur)}, below a third of gross pay (${fmt(takeHomeFloor, cur)}). ${q.kind === LoanKind.LOAN ? 'Borrow less or repay over more months.' : 'Ask for less.'}`,
        );
      }
    }

    return {
      currency: cur,
      instalment,
      months,
      yearlyRate,
      totalInterest: plan.reduce((s, r) => s + r.interest, 0),
      firstMonth,
      firstMonthLabel: ymLabel(firstMonth),
      lastMonthLabel: ymLabel(plan.at(-1)?.month ?? firstMonth),
      gross: pay.gross,
      net: pay.net,
      commitments: pay.commitments,
      takeHome,
      takeHomeFloor,
      stages,
      problems,
    };
  }

  async options(actor: AuthUser) {
    const employee = await ownPerson(this.prisma, actor);
    const pay = await this.payPicture(employee);
    const firstMonth = await this.openMonth(employee.companyId);
    const loanBlock =
      employee.employmentType !== EmploymentType.PERMANENT
        ? 'Staff loans are for permanent employees'
        : monthsBetween(employee.hireDate, new Date()) < PROBATION_MONTHS
          ? `Staff loans are available after probation (${PROBATION_MONTHS} months from joining)`
          : null;
    return {
      rulesVersion: LOAN_RULES_VERSION,
      currency: employee.company.currency,
      hasPayroll: !!pay.pack,
      gross: pay.gross === null ? null : toMajor(pay.gross),
      net: pay.net === null ? null : toMajor(pay.net),
      commitments: toMajor(pay.commitments),
      maxAdvance: pay.net === null ? null : toMajor(Math.floor(pay.net * ADVANCE_MAX_SHARE)),
      maxLoan: pay.gross === null ? null : toMajor(pay.gross * LOAN_MAX_TIMES_GROSS),
      maxHousingLoan: pay.gross === null ? null : toMajor(pay.gross * HOUSING_MAX_TIMES_GROSS),
      maxMonths: LOAN_MAX_MONTHS,
      iouSettleDays: IOU_SETTLE_DAYS,
      loanBlock,
      firstMonthLabel: ymLabel(firstMonth),
      products: Object.entries(LOAN_PRODUCTS).map(([product, p]) => ({ product, ...p })),
    };
  }

  async quote(actor: AuthUser, q: LoanQuoteQuery) {
    const employee = await ownPerson(this.prisma, actor);
    return this.presentQuote(await this.check(employee, q));
  }

  private presentQuote(q: Quote) {
    const m = (v: number | null) => (v === null ? null : toMajor(v));
    return {
      ...q,
      instalment: toMajor(q.instalment),
      totalInterest: toMajor(q.totalInterest),
      gross: m(q.gross),
      net: m(q.net),
      commitments: toMajor(q.commitments),
      takeHome: m(q.takeHome),
      takeHomeFloor: m(q.takeHomeFloor),
      stageLabels: q.stages.map((s) => STAGE_LABEL[s]),
    };
  }

  // ---------- requests ----------

  async create(actor: AuthUser, dto: CreateLoanDto) {
    const employee = await ownPerson(this.prisma, actor);
    const q = await this.check(employee, dto);
    if (q.problems.length) throw new BadRequestException(q.problems.join('. '));
    const manager = activeManager(employee);
    const neededOn = dto.kind === LoanKind.IOU ? (dto.neededOn ?? today()).slice(0, 10) : null;
    const loan = await this.prisma.loan.create({
      data: {
        employeeId: employee.id,
        kind: dto.kind,
        product: dto.kind === LoanKind.LOAN ? dto.product : null,
        amount: dto.amount.toFixed(2),
        currency: employee.company.currency,
        months: q.months,
        interestRate: q.yearlyRate,
        instalment: toMajor(q.instalment),
        purpose: dto.purpose,
        guarantor: dto.kind === LoanKind.LOAN ? dto.guarantor || null : null,
        costCentre: dto.kind === LoanKind.IOU ? dto.costCentre || null : null,
        neededOn: neededOn ? new Date(`${neededOn}T00:00:00Z`) : null,
        settleBy: neededOn ? new Date(`${(dto.settleBy ?? addDays(neededOn, IOU_SETTLE_DAYS)).slice(0, 10)}T00:00:00Z`) : null,
        status: RequestStatus.PENDING,
        stages: q.stages,
        stage: q.stages[0],
        approverId: manager?.id ?? null,
        createdById: actor.id,
      },
    });
    await this.audit.record(actor.id, 'loan.request', 'Loan', loan.id, { kind: loan.kind, product: loan.product, amount: dto.amount, months: q.months });
    await this.notify.stage(loan.stage!, loan.approverId, `${loanTitle(loan)} request from ${fullName(employee)}`, `${fullName(employee)} asked for ${this.describe(loan)}.`);
    return this.present(actor, { ...loan, repayments: [] });
  }

  async cancel(actor: AuthUser, id: string) {
    const loan = await this.find(id);
    const employee = await findPerson(this.prisma, loan.employeeId);
    const own = employee.userId === actor.id;
    if (loan.status !== RequestStatus.PENDING || !(own || actor.role === Role.ADMIN || actor.role === Role.FINANCE)) {
      throw new ForbiddenException('Only a request still waiting for approval can be cancelled');
    }
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.PENDING },
      data: { status: RequestStatus.CANCELLED, stage: null, cancelledById: actor.id, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('This request changed a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, 'loan.cancel', 'Loan', id);
    return this.present(actor, await this.find(id));
  }

  async decide(actor: AuthUser, id: string, approve: boolean, note?: string) {
    const loan = await this.find(id);
    if (loan.kind === LoanKind.IOU && loan.status === RequestStatus.APPROVED && loan.stage === ApprovalStage.FINANCE) {
      return this.decideSettlement(actor, loan, approve, note);
    }
    const employee = await findPerson(this.prisma, loan.employeeId);
    const me = await actorInfo(this.prisma, actor);
    const step = nextAfterDecision(actor, me.name, loan, employee, me.employeeId, approve, note);
    const data: Prisma.LoanUpdateManyMutationInput = { decisions: step.decisions, stage: step.stage };
    if (step.declined) data.status = RequestStatus.DECLINED;
    if (step.finished) {
      data.status = RequestStatus.APPROVED;
      // An IOU is only recovered through payroll if it is not settled; the others start now
      if (loan.kind !== LoanKind.IOU) {
        data.recoverable = loan.amount;
        data.firstMonth = await this.openMonth(employee.companyId);
      }
    }
    const { count } = await this.prisma.loan.updateMany({ where: { id, status: RequestStatus.PENDING, stage: loan.stage }, data });
    if (count === 0) throw new ConflictException('Someone else decided this request a moment ago. Refresh to see it.');
    const updated = await this.find(id);
    await this.audit.record(actor.id, approve ? 'loan.approve' : 'loan.decline', 'Loan', id, { stage: loan.stage, note: note ?? null });

    const what = this.describe(updated);
    if (step.stage) {
      await this.notify.stage(step.stage, updated.approverId, `${loanTitle(updated)} waiting for ${STAGE_LABEL[step.stage]}: ${fullName(employee)}`, `${STAGE_LABEL[loan.stage!]} approved ${fullName(employee)}'s request for ${what}.`);
    } else if (step.finished) {
      const how =
        updated.kind === LoanKind.IOU
          ? `Finance will issue the cash. Settle it in the portal with receipts by ${toIso(updated.settleBy!)}.`
          : `${fmt(toMinor(updated.instalment), updated.currency)} will be deducted from your pay ${updated.months > 1 ? `each month from ${ymLabel(updated.firstMonth!)}` : `in ${ymLabel(updated.firstMonth!)}`}.`;
      await this.notify.employee(employee.user, `Your ${loanTitle(updated).toLowerCase()} was approved`, `Hello ${employee.firstName},\n\nYour request for ${what} was approved.\n${how}`);
    } else {
      await this.notify.employee(employee.user, `Your ${loanTitle(updated).toLowerCase()} was declined`, `Hello ${employee.firstName},\n\nYour request for ${what} was declined by ${STAGE_LABEL[loan.stage!]}.${note ? `\nNote: ${note}` : ''}`);
    }
    return this.present(actor, updated);
  }

  // ---------- IOU settlement ----------

  async submitSettlement(actor: AuthUser, id: string, dto: SettleIouDto, file?: UploadedFileLike) {
    const loan = await this.find(id);
    const employee = await findPerson(this.prisma, loan.employeeId);
    if (employee.userId !== actor.id) throw new ForbiddenException('Only the person who took the IOU can settle it');
    if (loan.kind !== LoanKind.IOU || loan.status !== RequestStatus.APPROVED || loan.settledAt || loan.stage) {
      throw new ConflictException('This IOU is not waiting for settlement');
    }
    if (dto.spent > 0 && !file) throw new BadRequestException('Attach the receipts for what you spent');
    if (dto.spent + dto.cashReturned > Number(loan.amount) + 0.001 && dto.cashReturned > 0) {
      throw new BadRequestException('Amount spent and cash returned add up to more than the IOU');
    }
    let receiptDocumentId = loan.receiptDocumentId;
    if (file) receiptDocumentId = (await this.profiles.uploadDocument(actor, employee.id, { type: 'IOU receipts', issuedDate: today() }, file)).id;
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.APPROVED, stage: null, settledAt: null },
      data: { spent: dto.spent.toFixed(2), cashReturned: dto.cashReturned.toFixed(2), receiptDocumentId, settlementSubmittedAt: new Date(), stage: ApprovalStage.FINANCE },
    });
    if (count === 0) throw new ConflictException('This IOU changed a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, 'iou.settle.submit', 'Loan', id, { spent: dto.spent, cashReturned: dto.cashReturned });
    const updated = await this.find(id);
    await this.notify.stage(ApprovalStage.FINANCE, null, `IOU settlement from ${fullName(employee)}`, `${fullName(employee)} settled an IOU of ${fmt(toMinor(loan.amount), loan.currency)}: spent ${fmt(toMinor(dto.spent), loan.currency)}, returned ${fmt(toMinor(dto.cashReturned), loan.currency)}. Check the receipts and confirm it.`);
    return this.present(actor, updated);
  }

  private async decideSettlement(actor: AuthUser, loan: LoanWithRepayments, approve: boolean, note?: string) {
    if (actor.role !== Role.FINANCE && actor.role !== Role.ADMIN) throw new ForbiddenException('Only Finance can confirm an IOU settlement');
    const employee = await findPerson(this.prisma, loan.employeeId);
    if (employee.userId === actor.id) throw new ForbiddenException('You cannot confirm your own IOU');
    const me = await actorInfo(this.prisma, actor);
    const decisions = [...decisionsOf(loan), { stage: ApprovalStage.FINANCE, byId: actor.id, byName: me.name, at: new Date().toISOString(), approved: approve, note: note || (approve ? 'Settlement confirmed' : 'Settlement sent back') }];
    const balance = Math.max(0, toMinor(loan.amount) - toMinor(loan.spent) - toMinor(loan.cashReturned));
    const data: Prisma.LoanUpdateManyMutationInput = approve
      ? {
          stage: null,
          settledById: actor.id,
          settledAt: new Date(),
          recoverable: toMajor(balance),
          instalment: toMajor(balance),
          status: balance > 0 ? RequestStatus.APPROVED : RequestStatus.CLOSED,
          firstMonth: balance > 0 ? await this.openMonth(employee.companyId) : null,
          decisions: decisions as unknown as Prisma.InputJsonValue,
        }
      : { stage: null, settlementSubmittedAt: null, decisions: decisions as unknown as Prisma.InputJsonValue };
    const { count } = await this.prisma.loan.updateMany({ where: { id: loan.id, status: RequestStatus.APPROVED, stage: ApprovalStage.FINANCE }, data });
    if (count === 0) throw new ConflictException('Someone else confirmed this settlement a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, approve ? 'iou.settle.confirm' : 'iou.settle.reject', 'Loan', loan.id, { balance: toMajor(balance), note: note ?? null });
    const updated = await this.find(loan.id);
    const text = approve
      ? balance > 0
        ? `Finance confirmed your IOU settlement. The unspent ${fmt(balance, loan.currency)} will be deducted from your ${ymLabel(updated.firstMonth!)} pay.`
        : 'Finance confirmed your IOU settlement. Nothing more is owed.'
      : `Finance could not accept your IOU settlement${note ? `: ${note}` : ''}. Please correct it and send it again in the portal.`;
    await this.notify.employee(employee.user, approve ? 'IOU settled' : 'IOU settlement sent back', `Hello ${employee.firstName},\n\n${text}`);
    return this.present(actor, updated);
  }

  /** POL-22 3.5: an IOU not settled in time is recovered through payroll, after telling the employee */
  async recoverUnsettled(actor: AuthUser, id: string) {
    const loan = await this.find(id);
    if (loan.kind !== LoanKind.IOU || loan.status !== RequestStatus.APPROVED || loan.settledAt || loan.stage) throw new ConflictException('Only an unsettled IOU can be recovered this way');
    if (toIso(loan.settleBy!) >= today()) throw new ConflictException(`This IOU is not overdue: it is due by ${toIso(loan.settleBy!)}`);
    const employee = await findPerson(this.prisma, loan.employeeId);
    if (employee.userId === actor.id) throw new ForbiddenException('You cannot act on your own IOU');
    const me = await actorInfo(this.prisma, actor);
    const firstMonth = await this.openMonth(employee.companyId);
    const decisions = [...decisionsOf(loan), { stage: ApprovalStage.FINANCE, byId: actor.id, byName: me.name, at: new Date().toISOString(), approved: true, note: 'Not settled in time: recovered through payroll' }];
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.APPROVED, stage: null, settledAt: null },
      data: { recoverable: loan.amount, instalment: loan.amount, firstMonth, settledById: actor.id, settledAt: new Date(), decisions: decisions as unknown as Prisma.InputJsonValue },
    });
    if (count === 0) throw new ConflictException('This IOU changed a moment ago. Refresh to see it.');
    await this.audit.record(actor.id, 'iou.recover', 'Loan', id);
    await this.notify.employee(
      employee.user,
      'Unsettled IOU will be deducted from your pay',
      `Hello ${employee.firstName},\n\nYour IOU of ${fmt(toMinor(loan.amount), loan.currency)} was due to be settled with receipts by ${toIso(loan.settleBy!)}.\nAs it was not settled, it will be deducted from your ${ymLabel(firstMonth)} pay. Contact Finance if you have the receipts.`,
    );
    return this.present(actor, await this.find(id));
  }

  /** Finance records money paid back in cash or by bank transfer */
  async recordCash(actor: AuthUser, id: string, dto: CashRepaymentDto) {
    const loan = await this.find(id);
    if (loan.status !== RequestStatus.APPROVED) throw new ConflictException('Only an active loan can take a repayment');
    const owed = outstandingOf(loan);
    const amount = Math.round(dto.amount * 100);
    if (amount > owed) throw new BadRequestException(`Only ${fmt(owed, loan.currency)} is outstanding`);
    const now = new Date();
    await this.prisma.loanRepayment.create({
      data: { loanId: id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, amount: toMajor(amount), principal: toMajor(amount), source: 'CASH', note: dto.note || null, createdById: actor.id },
    });
    if (amount === owed) await this.prisma.loan.update({ where: { id }, data: { status: RequestStatus.CLOSED } });
    await this.audit.record(actor.id, 'loan.repay.cash', 'Loan', id, { amount: dto.amount, note: dto.note ?? null });
    return this.present(actor, await this.find(id));
  }

  /** IOU receipts, for the employee, Finance and Payroll */
  async receipt(actor: AuthUser, id: string) {
    const loan = await this.find(id);
    const employee = await findPerson(this.prisma, loan.employeeId);
    if (employee.userId !== actor.id && !SEES_LOAN_BOOK.includes(actor.role)) throw new ForbiddenException('Only Finance can see these receipts');
    if (!loan.receiptDocumentId) throw new NotFoundException('No receipts were attached');
    return this.profiles.documentFileChecked(actor.id, loan.receiptDocumentId);
  }

  // ---------- lists ----------

  async list(actor: AuthUser, employeeId?: string) {
    const employee = employeeId ? await findPerson(this.prisma, employeeId) : await ownPerson(this.prisma, actor);
    if (employee.userId !== actor.id && !SEES_LOAN_BOOK.includes(actor.role)) throw new ForbiddenException('Loan details are private to the employee, Payroll and Finance');
    const loans = await this.prisma.loan.findMany({ where: { employeeId: employee.id }, include: { repayments: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } });
    return {
      employee: { id: employee.id, name: fullName(employee), employeeNo: employee.employeeNo, currency: employee.company.currency },
      outstanding: toMajor(loans.filter((l) => l.status === RequestStatus.APPROVED).reduce((s, l) => s + outstandingOf(l), 0)),
      loans: loans.map((l) => this.present(actor, l, employee)),
    };
  }

  /** Every loan, advance and IOU, for Payroll and Finance */
  async book(q: LoanBookQuery) {
    const loans = await this.prisma.loan.findMany({
      where: {
        kind: q.kind,
        status: q.status ?? { in: LIVE },
        employee: q.companyId ? { companyId: q.companyId } : undefined,
      },
      include: {
        repayments: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, exitDate: true, company: { select: { name: true, currency: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const rows = loans.map((l) => {
      const owed = outstandingOf(l);
      const iouOverdue = l.kind === LoanKind.IOU && l.status === RequestStatus.APPROVED && !l.settledAt && !l.stage && toIso(l.settleBy!) < today();
      return {
        ...this.summary(l),
        employee: { id: l.employee.id, name: fullName(l.employee), employeeNo: l.employee.employeeNo, company: l.employee.company.name },
        outstanding: toMajor(owed),
        iouOverdue,
        // POL-22 3.7: what final dues could not cover becomes a repayment agreement
        leaverOwes: !!l.employee.exitDate && toIso(l.employee.exitDate) < today() && owed > 0,
      };
    });
    const totals: Record<string, string> = {};
    for (const l of loans) totals[l.currency] = toMajor(toMinor(totals[l.currency] ?? 0) + outstandingOf(l));
    return { rows, totals };
  }

  /** Requests waiting for the signed-in person, for the approvals page */
  async pendingFor(actor: AuthUser, myEmployeeId: string | null) {
    const stages = this.myStages(actor);
    const or: Prisma.LoanWhereInput[] = [];
    if (myEmployeeId) or.push({ status: RequestStatus.PENDING, stage: ApprovalStage.MANAGER, approverId: myEmployeeId });
    if (actor.role === Role.ADMIN) or.push({ status: RequestStatus.PENDING, stage: ApprovalStage.MANAGER });
    if (stages.length) or.push({ status: RequestStatus.PENDING, stage: { in: stages } });
    if (stages.includes(ApprovalStage.FINANCE)) or.push({ kind: LoanKind.IOU, status: RequestStatus.APPROVED, stage: ApprovalStage.FINANCE });
    if (or.length === 0) return [];
    const loans = await this.prisma.loan.findMany({
      where: { OR: or, employee: { userId: { not: actor.id } } },
      include: { repayments: true, employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, company: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return loans
      .filter((l) => l.status === RequestStatus.APPROVED || !decisionsOf(l).some((d) => d.byId === actor.id && d.approved))
      .map((l) => {
        const settlement = l.status === RequestStatus.APPROVED;
        const details = [l.purpose];
        if (l.kind === LoanKind.LOAN) details.push(`${l.months} months at ${Number(l.interestRate)}% a year, ${fmt(toMinor(l.instalment), l.currency)} a month`);
        if (l.kind === LoanKind.ADVANCE) details.push(`Recovered in full from the next salary`);
        if (l.guarantor) details.push(`Guarantor: ${l.guarantor}`);
        if (l.kind === LoanKind.IOU && !settlement) details.push(`Needed ${toIso(l.neededOn!)}, to be settled by ${toIso(l.settleBy!)}${l.costCentre ? `, cost centre ${l.costCentre}` : ''}`);
        if (settlement) {
          details.push(`Spent ${fmt(toMinor(l.spent), l.currency)}, cash returned ${fmt(toMinor(l.cashReturned), l.currency)}, balance to recover ${fmt(Math.max(0, toMinor(l.amount) - toMinor(l.spent) - toMinor(l.cashReturned)), l.currency)}`);
          if (!l.receiptDocumentId) details.push('No receipts attached');
        }
        return {
          entity: 'loan' as const,
          id: l.id,
          title: settlement ? 'IOU settlement' : loanTitle(l),
          employee: { id: l.employee.id, name: fullName(l.employee), employeeNo: l.employee.employeeNo, company: l.employee.company.name },
          amount: Number(l.amount).toFixed(2),
          currency: l.currency,
          details,
          stage: l.stage!,
          stageLabel: settlement ? 'Finance (settlement)' : STAGE_LABEL[l.stage!],
          stages: l.stages.map((s) => STAGE_LABEL[s]),
          decisions: decisionsOf(l),
          receipt: settlement && !!l.receiptDocumentId,
          createdAt: (settlement ? l.settlementSubmittedAt ?? l.createdAt : l.createdAt).toISOString(),
        };
      });
  }

  // ---------- payroll ----------

  /**
   * Deductions for one pay period, in the order they are taken: advances, IOUs, then loans.
   * A leaver repays everything outstanding from final dues (POL-22 3.7).
   */
  async payrollItems(employees: Array<{ id: string; exitDate: Date | null }>, year: number, month: number, periodEnd: Date) {
    const period = ym(year, month);
    const loans = await this.prisma.loan.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) }, status: RequestStatus.APPROVED, recoverable: { gt: 0 } },
      include: { repayments: true },
      orderBy: { createdAt: 'asc' },
    });
    const leaving = new Map(employees.map((e) => [e.id, !!e.exitDate && e.exitDate <= periodEnd]));
    const order: Record<LoanKind, number> = { ADVANCE: 0, IOU: 1, LOAN: 2 };
    loans.sort((a, b) => order[a.kind] - order[b.kind]);
    const result = new Map<string, { voluntary: PayItem[]; staffLoans: Array<{ outstanding: number; yearlyRate: number }> }>();
    for (const l of loans) {
      const owed = outstandingOf(l);
      if (owed <= 0) continue;
      const finalDues = leaving.get(l.employeeId) ?? false;
      if (!finalDues && (l.firstMonth === null || l.firstMonth > period)) continue;
      const entry = result.get(l.employeeId) ?? { voluntary: [], staffLoans: [] };
      const rate = Number(l.interestRate);
      const interest = Math.round((owed * rate) / 1200);
      const due = finalDues ? owed + interest : Math.min(toMinor(l.instalment), owed + interest);
      const code = l.kind === LoanKind.ADVANCE ? 'ADVANCE' : l.kind === LoanKind.IOU ? 'IOU' : 'LOAN';
      const label = l.kind === LoanKind.ADVANCE ? 'Salary advance recovery' : l.kind === LoanKind.IOU ? 'IOU balance recovery' : `${loanTitle(l)} repayment`;
      entry.voluntary.push({ code, label: finalDues ? `${label} (from final dues)` : label, amount: due, ref: l.id, interest });
      if (l.kind === LoanKind.LOAN) entry.staffLoans.push({ outstanding: owed, yearlyRate: rate });
      result.set(l.employeeId, entry);
    }
    return result;
  }

  /** Called when a run is finalized: the deductions on its payslips become repayments */
  async recordFromRun(runId: string, actorId: string | null) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: { include: { employee: { select: { exitDate: true } } } } } });
    const periodEnd = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));
    const touched = new Set<string>();
    for (const slip of run.payslips) {
      const lines = (Array.isArray(slip.lines) ? slip.lines : []) as Array<{ kind: string; amount: number; ref?: string; interest?: number }>;
      for (const line of lines) {
        if (line.kind !== 'DEDUCTION' || !line.ref) continue;
        const exists = await this.prisma.loanRepayment.findFirst({ where: { loanId: line.ref, payslipId: slip.id } });
        if (exists) continue;
        const amount = Math.round(line.amount * 100);
        const interest = Math.round((line.interest ?? 0) * 100);
        await this.prisma.loanRepayment.create({
          data: {
            loanId: line.ref,
            payslipId: slip.id,
            year: run.periodYear,
            month: run.periodMonth,
            amount: toMajor(amount),
            interest: toMajor(interest),
            principal: toMajor(amount - interest),
            source: slip.employee.exitDate && slip.employee.exitDate <= periodEnd ? 'FINAL_DUES' : 'PAYROLL',
            createdById: actorId,
          },
        });
        touched.add(line.ref);
      }
    }
    for (const id of touched) {
      const loan = await this.find(id);
      if (loan.status === RequestStatus.APPROVED && outstandingOf(loan) === 0) await this.prisma.loan.update({ where: { id }, data: { status: RequestStatus.CLOSED } });
    }
    return touched.size;
  }

  // ---------- helpers ----------

  private myStages(actor: AuthUser): ApprovalStage[] {
    if (actor.role === Role.ADMIN) return [ApprovalStage.HR, ApprovalStage.PAYROLL, ApprovalStage.FINANCE, ApprovalStage.COUNTRY_HEAD];
    if (actor.role === Role.HR) return [ApprovalStage.HR];
    if (actor.role === Role.PAYROLL) return [ApprovalStage.PAYROLL];
    if (actor.role === Role.FINANCE) return [ApprovalStage.FINANCE];
    return [];
  }

  private async find(id: string): Promise<LoanWithRepayments> {
    const loan = await this.prisma.loan.findUnique({ where: { id }, include: { repayments: { orderBy: { createdAt: 'asc' } } } });
    if (!loan) throw new NotFoundException('Request not found');
    return loan;
  }

  private describe(l: Loan) {
    const amount = fmt(toMinor(l.amount), l.currency);
    if (l.kind === LoanKind.LOAN) return `a ${loanTitle(l).toLowerCase()} of ${amount} over ${l.months} months (${l.purpose})`;
    if (l.kind === LoanKind.ADVANCE) return `a salary advance of ${amount} (${l.purpose})`;
    return `an IOU of ${amount} for ${l.purpose}`;
  }

  private summary(l: Loan) {
    return {
      id: l.id,
      kind: l.kind,
      product: l.product,
      title: loanTitle(l),
      amount: Number(l.amount).toFixed(2),
      currency: l.currency,
      months: l.months,
      interestRate: Number(l.interestRate),
      instalment: Number(l.instalment).toFixed(2),
      firstMonthLabel: l.firstMonth ? ymLabel(l.firstMonth) : null,
      purpose: l.purpose,
      status: l.status,
      stage: l.stage,
      stageLabel: l.stage ? (l.status === RequestStatus.APPROVED ? 'Finance (settlement)' : STAGE_LABEL[l.stage]) : null,
      createdAt: l.createdAt,
      settleBy: l.settleBy,
      settledAt: l.settledAt,
    };
  }

  private present(actor: AuthUser, l: LoanWithRepayments, employee?: { userId: string | null }) {
    const owed = outstandingOf(l);
    const own = employee ? employee.userId === actor.id : l.createdById === actor.id;
    const remaining = l.status === RequestStatus.APPROVED && owed > 0 && l.firstMonth
      ? projection(owed, toMinor(l.instalment), Number(l.interestRate), Math.max(l.firstMonth, ymOf(new Date())))
      : [];
    return {
      ...this.summary(l),
      guarantor: l.guarantor,
      costCentre: l.costCentre,
      neededOn: l.neededOn,
      spent: l.spent === null ? null : Number(l.spent).toFixed(2),
      cashReturned: l.cashReturned === null ? null : Number(l.cashReturned).toFixed(2),
      settlementSubmittedAt: l.settlementSubmittedAt,
      stages: l.stages.map((s) => STAGE_LABEL[s]),
      decisions: decisionsOf(l),
      outstanding: toMajor(owed),
      repaid: toMajor(l.repayments.reduce((s, r) => s + toMinor(r.amount), 0)),
      repayments: l.repayments.map((r) => ({ id: r.id, label: ymLabel(ym(r.year, r.month)), amount: Number(r.amount).toFixed(2), interest: Number(r.interest).toFixed(2), source: r.source, note: r.note })),
      upcoming: remaining.slice(0, 36).map((r) => ({ label: ymLabel(r.month), payment: toMajor(r.payment), balance: toMajor(r.balance) })),
      canCancel: own && l.status === RequestStatus.PENDING,
      canSettle: own && l.kind === LoanKind.IOU && l.status === RequestStatus.APPROVED && !l.settledAt && !l.stage,
    };
  }
}
