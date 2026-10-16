import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStage, Loan, LoanKind, LoanProduct, LoanRepayment, Prisma, RequestStatus } from '@prisma/client';
import { can } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { ApprovalNotifier } from '../approvals/notify.service';
import { openPayMonth } from '../approvals/pay-month';
import { currentPay, findPerson, fullName, lineManager, MoneyPerson, ownPerson, toMajor, toMinor } from '../approvals/people';
import { decisionsOf, involved, nextAfterDecision, STAGE_LABEL, waitingFor } from '../approvals/stages';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage.service';
import { toIso } from '../leave/calendar';
import { DocumentsService, UploadedFileLike } from '../people/documents.service';
import { PeopleAccess } from '../people/people-access.service';
import { PayItem, rulesFor } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADVANCE_EVERY_MONTHS,
  ADVANCE_MAX_SHARE,
  HOUSING_MAX_TIMES_GROSS,
  instalmentFor,
  IOU_SETTLE_DAYS,
  KIND_LABEL,
  LOAN_MAX_MONTHS,
  LOAN_MAX_TIMES_GROSS,
  LOAN_PRODUCTS,
  LOAN_RULE_PACK,
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
 * Salary advances, staff loans and IOUs (POL-22), carried over from the first build: requests and
 * their approval steps, the deductions each payroll run will make, and repayments.
 * POL-22 3.8: details are seen by the employee, Payroll and Finance for the company, and the approvers.
 */
@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: ApprovalNotifier,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
    private readonly access: PeopleAccess,
  ) {}

  // ---------- limits and quotes ----------

  openMonth(legalEntityId: string) {
    return openPayMonth(this.prisma, legalEntityId);
  }

  /** Estimated monthly pay from the country's draft payroll rules, and what is already deducted each month */
  private async payPicture(e: MoneyPerson) {
    const pack = rulesFor(e.legalEntity.countryCode);
    const [loans, benefits, pay] = await Promise.all([
      // Advances and IOUs are one-off; only loan instalments recur every month
      this.prisma.loan.findMany({ where: { employmentId: e.id, status: { in: LIVE }, kind: LoanKind.LOAN }, include: { repayments: true } }),
      // The employee's own share of running meal and gym benefits
      this.prisma.benefitEnrolment.findMany({ where: { employmentId: e.id, status: { in: LIVE }, endDate: null }, select: { plan: { select: { employeeShare: true } } } }),
      currentPay(this.prisma, e.id),
    ]);
    const commitments =
      loans.filter((l) => l.status === RequestStatus.PENDING || outstandingOf(l) > 0).reduce((s, l) => s + toMinor(l.instalment), 0) +
      benefits.reduce((s, b) => s + toMinor(b.plan.employeeShare), 0);
    if (!pack || !pay) return { pack: pack ?? null, pay, gross: null, net: null, commitments };
    const r = pack.calculate({ basic: pay.basic, allowances: pay.allowances });
    return { pack, pay, gross: r.gross, net: r.net, commitments };
  }

  /** What a request would cost each month and whether the policy allows it */
  async check(e: MoneyPerson, q: { kind: LoanKind; product?: LoanProduct; amount: number; months?: number; neededOn?: string; settleBy?: string }): Promise<Quote> {
    const problems: string[] = [];
    const amount = Math.round(q.amount * 100);
    const cur = e.legalEntity.functionalCurrency;
    const pay = await this.payPicture(e);
    const firstMonth = await this.openMonth(e.legalEntityId);
    const months = q.kind === LoanKind.LOAN ? q.months ?? 12 : 1;
    const yearlyRate = q.kind === LoanKind.LOAN && q.product ? LOAN_PRODUCTS[q.product].yearlyRate : 0;
    const instalment = instalmentFor(amount, months, yearlyRate);
    const plan = schedule(amount, months, yearlyRate, firstMonth);
    const manager = await lineManager(this.prisma, e.id, e.userId);
    const stages: ApprovalStage[] = manager ? [ApprovalStage.MANAGER] : [];

    if (e.status !== 'ACTIVE') problems.push('This employment has ended');
    else if (e.endDate && q.kind !== LoanKind.IOU) problems.push('Advances and loans are not available once a leaving date is set');
    if (q.kind !== LoanKind.IOU && !pay.pack) {
      problems.push(`Payroll rules for ${e.legalEntity.name} are not in the portal yet, so it cannot recover a ${KIND_LABEL[q.kind].toLowerCase()}`);
    } else if (q.kind !== LoanKind.IOU && !pay.pay) {
      problems.push('There is no pay record for you yet, so HR needs to add one first');
    }

    if (q.kind === LoanKind.ADVANCE) {
      stages.push(ApprovalStage.PAYROLL, ApprovalStage.FINANCE);
      if (pay.net !== null && amount > Math.floor(pay.net * ADVANCE_MAX_SHARE)) {
        problems.push(`An advance can be at most half of your net pay, which is ${fmt(Math.floor(pay.net * ADVANCE_MAX_SHARE), cur)}`);
      }
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - ADVANCE_EVERY_MONTHS);
      const recent = await this.prisma.loan.findFirst({
        where: { employmentId: e.id, kind: LoanKind.ADVANCE, status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED, RequestStatus.CLOSED] }, createdAt: { gte: since } },
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
      if (e.employmentType !== 'PERMANENT') problems.push('Staff loans are for permanent employees');
      else if (monthsBetween(e.hireDate, new Date()) < PROBATION_MONTHS) problems.push(`Staff loans are available after probation (${PROBATION_MONTHS} months from joining)`);
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

  async options(auth: AuthContext) {
    const e = await ownPerson(this.prisma, auth);
    const pay = await this.payPicture(e);
    const firstMonth = await this.openMonth(e.legalEntityId);
    const loanBlock =
      e.employmentType !== 'PERMANENT'
        ? 'Staff loans are for permanent employees'
        : monthsBetween(e.hireDate, new Date()) < PROBATION_MONTHS
          ? `Staff loans are available after probation (${PROBATION_MONTHS} months from joining)`
          : null;
    return {
      rulePack: LOAN_RULE_PACK,
      payrollPack: pay.pack ? { version: pay.pack.version, verified: pay.pack.verified } : null,
      currency: e.legalEntity.functionalCurrency,
      hasPayroll: !!pay.pack && !!pay.pay,
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

  async quote(auth: AuthContext, q: LoanQuoteQuery) {
    const e = await ownPerson(this.prisma, auth);
    return this.presentQuote(await this.check(e, q));
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

  async create(auth: AuthContext, dto: CreateLoanDto) {
    const e = await ownPerson(this.prisma, auth);
    await this.assertModuleOn(e.legalEntityId, e.legalEntity.name);
    const q = await this.check(e, dto);
    if (q.problems.length) throw new BadRequestException(q.problems.join('. '));
    const manager = await lineManager(this.prisma, e.id, e.userId);
    const neededOn = dto.kind === LoanKind.IOU ? (dto.neededOn ?? today()).slice(0, 10) : null;
    const loan = await this.prisma.loan.create({
      data: {
        employmentId: e.id,
        legalEntityId: e.legalEntityId,
        kind: dto.kind,
        product: dto.kind === LoanKind.LOAN ? dto.product : null,
        amount: dto.amount.toFixed(2),
        currency: e.legalEntity.functionalCurrency,
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
        rulesVersion: LOAN_RULES_VERSION,
        createdById: auth.userId,
      },
      include: { repayments: true },
    });
    await this.audit.record(auth, {
      action: 'loan.requested',
      targetType: 'loan',
      targetId: loan.id,
      legalEntityId: e.legalEntityId,
      detail: { kind: loan.kind, product: loan.product, amount: dto.amount, months: q.months, rulesVersion: LOAN_RULES_VERSION },
    });
    await this.notify.stage(loan.stage!, loan.approverId, e.legalEntity, e.userId, `${loanTitle(loan)} request from ${fullName(e.person)}`, `${fullName(e.person)} asked for ${this.describe(loan)}.`);
    return this.present(auth, loan, e);
  }

  async cancel(auth: AuthContext, id: string) {
    const loan = await this.find(auth, id);
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    const own = e.userId === auth.userId;
    if (!own && !this.seesBook(auth, loan.legalEntityId)) throw new NotFoundException('Request not found');
    if (loan.status !== RequestStatus.PENDING || !(own || can(auth.access, 'finance.manage', loan.legalEntityId))) {
      throw new ForbiddenException('Only a request still waiting for approval can be cancelled');
    }
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.PENDING },
      data: { status: RequestStatus.CANCELLED, stage: null, cancelledById: auth.userId, cancelledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('This request changed a moment ago. Refresh to see it.');
    await this.audit.record(auth, { action: 'loan.cancelled', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId });
    return this.present(auth, await this.find(auth, id), e);
  }

  async decide(auth: AuthContext, id: string, approve: boolean, note?: string) {
    const loan = await this.find(auth, id);
    if (loan.kind === LoanKind.IOU && loan.status === RequestStatus.APPROVED && loan.stage === ApprovalStage.FINANCE) {
      return this.decideSettlement(auth, loan, approve, note);
    }
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    const mine = await this.access.ownEmploymentIds(auth);
    const step = nextAfterDecision(auth, loan, e, mine, approve, note);
    const data: Prisma.LoanUpdateManyMutationInput = { decisions: step.decisions, stage: step.stage };
    if (step.declined) data.status = RequestStatus.DECLINED;
    if (step.finished) {
      data.status = RequestStatus.APPROVED;
      // An IOU is only recovered through payroll if it is not settled; the others start now
      if (loan.kind !== LoanKind.IOU) {
        data.recoverable = loan.amount;
        data.firstMonth = await this.openMonth(e.legalEntityId);
      }
    }
    const { count } = await this.prisma.loan.updateMany({ where: { id, status: RequestStatus.PENDING, stage: loan.stage }, data });
    if (count === 0) throw new ConflictException('Someone else decided this request a moment ago. Refresh to see it.');
    const updated = await this.find(auth, id);
    await this.audit.record(auth, { action: approve ? 'loan.approved' : 'loan.declined', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId, detail: { stage: loan.stage, note: note ?? null } });

    const what = this.describe(updated);
    const name = fullName(e.person);
    if (step.stage) {
      await this.notify.stage(step.stage, updated.approverId, e.legalEntity, e.userId, `${loanTitle(updated)} waiting for ${STAGE_LABEL[step.stage]}: ${name}`, `${STAGE_LABEL[loan.stage!]} approved ${name}'s request for ${what}.`);
    } else if (step.finished) {
      const how =
        updated.kind === LoanKind.IOU
          ? `Finance will issue the cash. Settle it in the portal with receipts by ${toIso(updated.settleBy!)}.`
          : `${fmt(toMinor(updated.instalment), updated.currency)} will be deducted from your pay ${updated.months > 1 ? `each month from ${ymLabel(updated.firstMonth!)}` : `in ${ymLabel(updated.firstMonth!)}`}.`;
      await this.notify.employee(e.user, `Your ${loanTitle(updated).toLowerCase()} was approved`, `Hello ${e.person.firstName},\n\nYour request for ${what} was approved.\n${how}`);
    } else {
      await this.notify.employee(e.user, `Your ${loanTitle(updated).toLowerCase()} was declined`, `Hello ${e.person.firstName},\n\nYour request for ${what} was declined by ${STAGE_LABEL[loan.stage!]}.${note ? `\nNote: ${note}` : ''}`);
    }
    return this.present(auth, updated, e);
  }

  // ---------- IOU settlement ----------

  async submitSettlement(auth: AuthContext, id: string, dto: SettleIouDto, file?: UploadedFileLike) {
    const loan = await this.find(auth, id);
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    if (e.userId !== auth.userId) throw new ForbiddenException('Only the person who took the IOU can settle it');
    if (loan.kind !== LoanKind.IOU || loan.status !== RequestStatus.APPROVED || loan.settledAt || loan.stage) {
      throw new ConflictException('This IOU is not waiting for settlement');
    }
    if (dto.spent > 0 && !file) throw new BadRequestException('Attach the receipts for what you spent');
    if (dto.spent + dto.cashReturned > Number(loan.amount) + 0.001 && dto.cashReturned > 0) {
      throw new BadRequestException('Amount spent and cash returned add up to more than the IOU');
    }
    let receiptDocumentId = loan.receiptDocumentId;
    if (file) receiptDocumentId = (await this.documents.upload(auth, e.id, { type: 'IOU receipts', issuedDate: today(), hrOnly: 'false' }, file)).id;
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.APPROVED, stage: null, settledAt: null },
      data: { spent: dto.spent.toFixed(2), cashReturned: dto.cashReturned.toFixed(2), receiptDocumentId, settlementSubmittedAt: new Date(), stage: ApprovalStage.FINANCE },
    });
    if (count === 0) throw new ConflictException('This IOU changed a moment ago. Refresh to see it.');
    await this.audit.record(auth, { action: 'loan.iou.settlement.sent', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId, detail: { spent: dto.spent, cashReturned: dto.cashReturned } });
    const updated = await this.find(auth, id);
    await this.notify.stage(
      ApprovalStage.FINANCE,
      null,
      e.legalEntity,
      e.userId,
      `IOU settlement from ${fullName(e.person)}`,
      `${fullName(e.person)} settled an IOU of ${fmt(toMinor(loan.amount), loan.currency)}: spent ${fmt(toMinor(dto.spent), loan.currency)}, returned ${fmt(toMinor(dto.cashReturned), loan.currency)}. Check the receipts and confirm it.`,
    );
    return this.present(auth, updated, e);
  }

  private async decideSettlement(auth: AuthContext, loan: LoanWithRepayments, approve: boolean, note?: string) {
    if (!can(auth.access, 'finance.manage', loan.legalEntityId)) {
      if (!this.seesBook(auth, loan.legalEntityId)) throw new NotFoundException('Request not found');
      throw new ForbiddenException('Only Finance can confirm an IOU settlement');
    }
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    if (e.userId === auth.userId) throw new ForbiddenException('You cannot confirm your own IOU');
    const decisions = [
      ...decisionsOf(loan),
      { stage: ApprovalStage.FINANCE, byId: auth.userId, byName: auth.displayName, at: new Date().toISOString(), approved: approve, note: note || (approve ? 'Settlement confirmed' : 'Settlement sent back') },
    ];
    const balance = Math.max(0, toMinor(loan.amount) - toMinor(loan.spent) - toMinor(loan.cashReturned));
    const data: Prisma.LoanUpdateManyMutationInput = approve
      ? {
          stage: null,
          settledById: auth.userId,
          settledAt: new Date(),
          recoverable: toMajor(balance),
          instalment: toMajor(balance),
          status: balance > 0 ? RequestStatus.APPROVED : RequestStatus.CLOSED,
          firstMonth: balance > 0 ? await this.openMonth(e.legalEntityId) : null,
          decisions: decisions as unknown as Prisma.InputJsonValue,
        }
      : { stage: null, settlementSubmittedAt: null, decisions: decisions as unknown as Prisma.InputJsonValue };
    const { count } = await this.prisma.loan.updateMany({ where: { id: loan.id, status: RequestStatus.APPROVED, stage: ApprovalStage.FINANCE }, data });
    if (count === 0) throw new ConflictException('Someone else confirmed this settlement a moment ago. Refresh to see it.');
    await this.audit.record(auth, {
      action: approve ? 'loan.iou.settlement.confirmed' : 'loan.iou.settlement.returned',
      targetType: 'loan',
      targetId: loan.id,
      legalEntityId: loan.legalEntityId,
      detail: { balance: toMajor(balance), note: note ?? null },
    });
    const updated = await this.find(auth, loan.id);
    const text = approve
      ? balance > 0
        ? `Finance confirmed your IOU settlement. The unspent ${fmt(balance, loan.currency)} will be deducted from your ${ymLabel(updated.firstMonth!)} pay.`
        : 'Finance confirmed your IOU settlement. Nothing more is owed.'
      : `Finance could not accept your IOU settlement${note ? `: ${note}` : ''}. Please correct it and send it again in the portal.`;
    await this.notify.employee(e.user, approve ? 'IOU settled' : 'IOU settlement sent back', `Hello ${e.person.firstName},\n\n${text}`);
    return this.present(auth, updated, e);
  }

  /** POL-22 3.5: an IOU not settled in time is recovered through payroll, after telling the employee */
  async recoverUnsettled(auth: AuthContext, id: string) {
    const loan = await this.find(auth, id);
    this.assertFinance(auth, loan.legalEntityId);
    if (loan.kind !== LoanKind.IOU || loan.status !== RequestStatus.APPROVED || loan.settledAt || loan.stage) throw new ConflictException('Only an unsettled IOU can be recovered this way');
    if (toIso(loan.settleBy!) >= today()) throw new ConflictException(`This IOU is not overdue: it is due by ${toIso(loan.settleBy!)}`);
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    if (e.userId === auth.userId) throw new ForbiddenException('You cannot act on your own IOU');
    const firstMonth = await this.openMonth(e.legalEntityId);
    const decisions = [
      ...decisionsOf(loan),
      { stage: ApprovalStage.FINANCE, byId: auth.userId, byName: auth.displayName, at: new Date().toISOString(), approved: true, note: 'Not settled in time: recovered through payroll' },
    ];
    const { count } = await this.prisma.loan.updateMany({
      where: { id, status: RequestStatus.APPROVED, stage: null, settledAt: null },
      data: { recoverable: loan.amount, instalment: loan.amount, firstMonth, settledById: auth.userId, settledAt: new Date(), decisions: decisions as unknown as Prisma.InputJsonValue },
    });
    if (count === 0) throw new ConflictException('This IOU changed a moment ago. Refresh to see it.');
    await this.audit.record(auth, { action: 'loan.iou.recovered', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId });
    await this.notify.employee(
      e.user,
      'Unsettled IOU will be deducted from your pay',
      `Hello ${e.person.firstName},\n\nYour IOU of ${fmt(toMinor(loan.amount), loan.currency)} was due to be settled with receipts by ${toIso(loan.settleBy!)}.\nAs it was not settled, it will be deducted from your ${ymLabel(firstMonth)} pay. Contact Finance if you have the receipts.`,
    );
    return this.present(auth, await this.find(auth, id), e);
  }

  /** Finance records money paid back in cash or by bank transfer */
  async recordCash(auth: AuthContext, id: string, dto: CashRepaymentDto) {
    const loan = await this.find(auth, id);
    this.assertFinance(auth, loan.legalEntityId);
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    if (e.userId === auth.userId) throw new ForbiddenException('Someone else must record repayments on your own loan');
    if (loan.status !== RequestStatus.APPROVED) throw new ConflictException('Only an active loan can take a repayment');
    const owed = outstandingOf(loan);
    const amount = Math.round(dto.amount * 100);
    if (amount > owed) throw new BadRequestException(`Only ${fmt(owed, loan.currency)} is outstanding`);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.loanRepayment.create({
        data: { loanId: id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, amount: toMajor(amount), principal: toMajor(amount), source: 'CASH', note: dto.note || null, createdById: auth.userId },
      });
      if (amount === owed) await tx.loan.update({ where: { id }, data: { status: RequestStatus.CLOSED } });
      await this.audit.record(auth, { action: 'loan.repaid.cash', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId, detail: { amount: dto.amount, note: dto.note ?? null } }, tx);
    });
    return this.present(auth, await this.find(auth, id), e);
  }

  /** IOU receipts, for the employee, Payroll and Finance for the company */
  async receipt(auth: AuthContext, id: string) {
    const loan = await this.find(auth, id);
    const e = await findPerson(this.prisma, auth, loan.employmentId);
    if (e.userId !== auth.userId && !this.seesBook(auth, loan.legalEntityId)) throw new NotFoundException('Request not found');
    if (!loan.receiptDocumentId) throw new NotFoundException('No receipts were attached');
    const doc = await this.prisma.employeeDocument.findUnique({ where: { id: loan.receiptDocumentId } });
    const data = doc?.storageKey ? await this.storage.get(doc.storageKey) : null;
    if (!doc || !data) throw new NotFoundException('The receipts file is missing');
    await this.audit.record(auth, { action: 'loan.iou.receipts.viewed', targetType: 'loan', targetId: id, legalEntityId: loan.legalEntityId });
    return { data, mime: doc.mimeType ?? 'application/octet-stream', fileName: doc.fileName };
  }

  // ---------- lists ----------

  async list(auth: AuthContext, employmentId?: string) {
    const e = employmentId ? await findPerson(this.prisma, auth, employmentId) : await ownPerson(this.prisma, auth);
    if (e.userId !== auth.userId && !this.seesBook(auth, e.legalEntityId)) throw new NotFoundException('Employee not found');
    const loans = await this.prisma.loan.findMany({ where: { employmentId: e.id }, include: { repayments: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } });
    return {
      rulePack: LOAN_RULE_PACK,
      employee: { id: e.id, name: fullName(e.person), employeeNumber: e.employeeNumber, currency: e.legalEntity.functionalCurrency },
      outstanding: toMajor(loans.filter((l) => l.status === RequestStatus.APPROVED).reduce((s, l) => s + outstandingOf(l), 0)),
      loans: loans.map((l) => this.present(auth, l, e)),
    };
  }

  /** Every loan, advance and IOU in the companies where the caller is Payroll or Finance */
  async book(auth: AuthContext, q: LoanBookQuery) {
    const allowed = [...new Set([...entityIds(auth, 'payroll.read'), ...entityIds(auth, 'finance.read')])];
    if (q.entityId && !allowed.includes(q.entityId)) throw new NotFoundException('Company not found');
    const loans = await this.prisma.loan.findMany({
      where: { legalEntityId: { in: q.entityId ? [q.entityId] : allowed }, kind: q.kind, status: q.status ?? { in: LIVE } },
      include: {
        repayments: true,
        employment: { select: { id: true, userId: true, employeeNumber: true, endDate: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const rows = loans.map((l) => {
      const owed = outstandingOf(l);
      const iouOverdue = l.kind === LoanKind.IOU && l.status === RequestStatus.APPROVED && !l.settledAt && !l.stage && toIso(l.settleBy!) < today();
      return {
        ...this.summary(l),
        employee: { id: l.employment.id, name: fullName(l.employment.person), employeeNumber: l.employment.employeeNumber, entity: l.employment.legalEntity },
        outstanding: toMajor(owed),
        iouOverdue,
        // POL-22 3.7: what final dues could not cover becomes a repayment agreement
        leaverOwes: !!l.employment.endDate && toIso(l.employment.endDate) < today() && owed > 0,
        canAct: can(auth.access, 'finance.manage', l.legalEntityId) && l.employment.userId !== auth.userId,
      };
    });
    const totals: Record<string, string> = {};
    for (const l of loans) totals[l.currency] = toMajor(toMinor(totals[l.currency] ?? 0) + outstandingOf(l));
    return { rulePack: LOAN_RULE_PACK, rows, totals };
  }

  /** Requests waiting for the signed-in person, for the approvals inbox */
  async pendingFor(auth: AuthContext) {
    const mine = await this.access.ownEmploymentIds(auth);
    const or: Prisma.LoanWhereInput[] = waitingFor(auth, mine).map((w) => ({ status: RequestStatus.PENDING, ...w }));
    const finance = entityIds(auth, 'finance.manage');
    if (finance.length) or.push({ kind: LoanKind.IOU, status: RequestStatus.APPROVED, stage: ApprovalStage.FINANCE, legalEntityId: { in: finance } });
    if (or.length === 0) return [];
    const loans = await this.prisma.loan.findMany({
      where: { OR: or, employmentId: { notIn: mine }, employment: { legalEntity: { groupId: auth.groupId } } },
      include: { repayments: true, employment: { select: { id: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return loans
      .filter((l) => l.status === RequestStatus.APPROVED || !decisionsOf(l).some((d) => d.byId === auth.userId && d.approved))
      .map((l) => {
        const settlement = l.status === RequestStatus.APPROVED;
        const details = [l.purpose];
        if (l.kind === LoanKind.LOAN) details.push(`${l.months} months at ${Number(l.interestRate)}% a year, ${fmt(toMinor(l.instalment), l.currency)} a month`);
        if (l.kind === LoanKind.ADVANCE) details.push('Recovered in full from the next salary');
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
          employee: { id: l.employment.id, name: fullName(l.employment.person), employeeNumber: l.employment.employeeNumber, entity: l.employment.legalEntity },
          amount: Number(l.amount).toFixed(2),
          currency: l.currency,
          details,
          stage: l.stage!,
          stageLabel: settlement ? 'Finance (settlement)' : STAGE_LABEL[l.stage!],
          stages: l.stages.map((s) => STAGE_LABEL[s]),
          decisions: decisionsOf(l),
          receipt: settlement && !!l.receiptDocumentId,
          rulesVersion: l.rulesVersion,
          createdAt: (settlement ? l.settlementSubmittedAt ?? l.createdAt : l.createdAt).toISOString(),
        };
      });
  }

  // ---------- payroll ----------

  /**
   * Deductions for one pay period, in the order they are taken: advances, IOUs, then loans.
   * A leaver repays everything outstanding from final dues (POL-22 3.7). Used by month-end payroll.
   */
  async payrollItems(employments: Array<{ id: string; endDate: Date | null }>, year: number, month: number, periodEnd: Date) {
    const period = ym(year, month);
    const loans = await this.prisma.loan.findMany({
      where: { employmentId: { in: employments.map((e) => e.id) }, status: RequestStatus.APPROVED, recoverable: { gt: 0 } },
      include: { repayments: true },
      orderBy: { createdAt: 'asc' },
    });
    const leaving = new Map(employments.map((e) => [e.id, !!e.endDate && e.endDate <= periodEnd]));
    const order: Record<LoanKind, number> = { ADVANCE: 0, IOU: 1, LOAN: 2 };
    loans.sort((a, b) => order[a.kind] - order[b.kind]);
    const result = new Map<string, { voluntary: PayItem[]; staffLoans: Array<{ outstanding: number; yearlyRate: number }> }>();
    for (const l of loans) {
      const owed = outstandingOf(l);
      if (owed <= 0) continue;
      const finalDues = leaving.get(l.employmentId) ?? false;
      if (!finalDues && (l.firstMonth === null || l.firstMonth > period)) continue;
      const entry = result.get(l.employmentId) ?? { voluntary: [], staffLoans: [] };
      const rate = Number(l.interestRate);
      const interest = Math.round((owed * rate) / 1200);
      const due = finalDues ? owed + interest : Math.min(toMinor(l.instalment), owed + interest);
      const code = l.kind === LoanKind.ADVANCE ? 'ADVANCE' : l.kind === LoanKind.IOU ? 'IOU' : 'LOAN';
      const label = l.kind === LoanKind.ADVANCE ? 'Salary advance recovery' : l.kind === LoanKind.IOU ? 'IOU balance recovery' : `${loanTitle(l)} repayment`;
      entry.voluntary.push({ code, label: finalDues ? `${label} (from final dues)` : label, amount: due, ref: l.id, interest });
      if (l.kind === LoanKind.LOAN) entry.staffLoans.push({ outstanding: owed, yearlyRate: rate });
      result.set(l.employmentId, entry);
    }
    return result;
  }

  // ---------- helpers ----------

  private seesBook(auth: AuthContext, legalEntityId: string) {
    return can(auth.access, 'payroll.read', legalEntityId) || can(auth.access, 'finance.read', legalEntityId);
  }

  private assertFinance(auth: AuthContext, legalEntityId: string) {
    if (can(auth.access, 'finance.manage', legalEntityId)) return;
    if (this.seesBook(auth, legalEntityId)) throw new ForbiddenException('Only Finance can do this');
    throw new NotFoundException('Request not found');
  }

  private async assertModuleOn(legalEntityId: string, name: string) {
    const f = await this.prisma.entityFeature.findUnique({ where: { legalEntityId_module: { legalEntityId, module: 'loans' } } });
    if (!f?.enabled) throw new ForbiddenException(`Salary advances and loans are switched off for ${name}`);
  }

  /** A loan in the caller's group that they may see: their own, Payroll or Finance for the company, or an approver */
  private async find(auth: AuthContext, id: string): Promise<LoanWithRepayments> {
    const loan = await this.prisma.loan.findFirst({
      where: { id, employment: { legalEntity: { groupId: auth.groupId } } },
      include: { repayments: { orderBy: { createdAt: 'asc' } }, employment: { select: { userId: true } } },
    });
    if (!loan) throw new NotFoundException('Request not found');
    const { employment, ...rest } = loan;
    if (employment.userId !== auth.userId && !this.seesBook(auth, loan.legalEntityId)) {
      const mine = await this.access.ownEmploymentIds(auth);
      if (!involved(auth, loan, mine)) throw new NotFoundException('Request not found');
    }
    return rest;
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
      rulesVersion: l.rulesVersion,
      createdAt: l.createdAt,
      settleBy: l.settleBy ? toIso(l.settleBy) : null,
      settledAt: l.settledAt,
    };
  }

  private present(auth: AuthContext, l: LoanWithRepayments, e: { userId: string | null }) {
    const owed = outstandingOf(l);
    const own = e.userId === auth.userId;
    const remaining =
      l.status === RequestStatus.APPROVED && owed > 0 && l.firstMonth ? projection(owed, toMinor(l.instalment), Number(l.interestRate), Math.max(l.firstMonth, ymOf(new Date()))) : [];
    return {
      ...this.summary(l),
      guarantor: l.guarantor,
      costCentre: l.costCentre,
      neededOn: l.neededOn ? toIso(l.neededOn) : null,
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
      hasReceipt: !!l.receiptDocumentId,
    };
  }
}

