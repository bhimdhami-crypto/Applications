import { LoanKind, LoanProduct } from '@prisma/client';
import { addMonths } from '../approvals/pay-month';

export { addMonths, ym, ymLabel, ymOf } from '../approvals/pay-month';

/**
 * Staff advances, loans and IOUs (POL-22, draft v0.1). Rates and limits are a draft for
 * Finance to confirm. A loan keeps the rate it was approved at, so a change only affects new loans.
 */
export const LOAN_RULES_VERSION = 'LOANS-2026.1-draft';

/** UNVERIFIED DRAFT: shown next to every quote; nothing here is a certified calculation */
export const LOAN_RULE_PACK = {
  version: LOAN_RULES_VERSION,
  status: 'UNVERIFIED' as const,
  summary: 'Draft company rules for advances, loans and IOUs carried over from the first build. Finance has not confirmed the rates and limits.',
};

/** 3.1 An advance is at most half of net pay, once in any 3 months, recovered from the next salary */
export const ADVANCE_MAX_SHARE = 0.5;
export const ADVANCE_EVERY_MONTHS = 3;
/** 3.2 Loans: up to 3 times monthly gross pay over up to 36 months; housing may go higher with Country Head approval */
export const LOAN_MAX_TIMES_GROSS = 3;
export const HOUSING_MAX_TIMES_GROSS = 10;
export const LOAN_MAX_MONTHS = 36;
/** Loans are for permanent staff who have finished probation (taken as 6 months from joining) */
export const PROBATION_MONTHS = 6;
/** 3.5 IOUs are settled with receipts within 14 days */
export const IOU_SETTLE_DAYS = 14;
/** 3.4 Take-home pay may not fall below a third of gross pay */
export const MIN_TAKE_HOME_SHARE = 1 / 3;

export const LOAN_PRODUCTS: Record<LoanProduct, { label: string; yearlyRate: number; note: string }> = {
  PERSONAL: { label: 'Personal', yearlyRate: 5, note: '5% a year on the reducing balance' },
  EDUCATION: { label: 'Education', yearlyRate: 0, note: 'Interest-free' },
  EMERGENCY: { label: 'Emergency', yearlyRate: 0, note: 'Interest-free' },
  HOUSING: { label: 'Housing', yearlyRate: 4, note: '4% a year; above 3 times gross pay needs Country Head approval' },
  VEHICLE: { label: 'Vehicle', yearlyRate: 5, note: '5% a year on the reducing balance' },
};

export const KIND_LABEL: Record<LoanKind, string> = { ADVANCE: 'Salary advance', LOAN: 'Staff loan', IOU: 'IOU' };

export const loanTitle = (l: { kind: LoanKind; product: LoanProduct | null }) =>
  l.kind === LoanKind.LOAN && l.product ? `${LOAN_PRODUCTS[l.product].label} loan` : KIND_LABEL[l.kind];

/** Monthly instalment in minor units on a reducing balance, rounded up to the cent */
export function instalmentFor(principal: number, months: number, yearlyRate: number) {
  if (months <= 1) return Math.ceil(principal * (1 + yearlyRate / 1200));
  const r = yearlyRate / 1200;
  if (r === 0) return Math.ceil(principal / months);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -months)));
}

export interface ScheduleRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/** Planned deductions month by month, in minor units */
export function schedule(principal: number, months: number, yearlyRate: number, firstMonth: number): ScheduleRow[] {
  return projection(principal, instalmentFor(principal, months, yearlyRate), yearlyRate, firstMonth);
}

/** Deductions still to come on a balance at a fixed instalment, in minor units */
export function projection(balance: number, instalment: number, yearlyRate: number, firstMonth: number): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (let i = 0; balance > 0 && i < 120; i++) {
    const interest = Math.round((balance * yearlyRate) / 1200);
    const payment = Math.min(instalment, balance + interest);
    if (payment <= interest) break;
    balance -= payment - interest;
    rows.push({ month: addMonths(firstMonth, i), payment, interest, principal: payment - interest, balance });
  }
  return rows;
}

/** Whole months between two dates (b after a) */
export function monthsBetween(a: Date, b: Date) {
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}
