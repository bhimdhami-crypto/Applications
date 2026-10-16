import { PayInput, PayLine, cents } from './types';

/** A tax band: income up to `upTo` (cumulative, minor units) is taxed at `rate` */
export type Band = [upTo: number, rate: number];

/** Tax on `amount` over cumulative bands, e.g. [[100, 0], [500, 0.1], [Infinity, 0.2]] */
export function progressive(amount: number, bands: Band[]): number {
  let tax = 0;
  let floor = 0;
  for (const [upTo, rate] of bands) {
    if (amount <= floor) break;
    tax += (Math.min(amount, upTo) - floor) * rate;
    floor = upTo;
  }
  return tax;
}

/**
 * The earning lines every country shares: basic, allowances, cash benefits and unpaid leave.
 * Unpaid days come off the earnings, so they also reduce taxable pay.
 */
export function earnings({ basic, allowances, leaveDeduction, cashAllowances = [], benefitsInKind = [] }: PayInput) {
  const unpaid = Math.min(leaveDeduction?.amount ?? 0, basic);
  const lines: PayLine[] = [{ code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amount: basic }];
  if (allowances > 0) lines.push({ code: 'ALLOW', label: 'Allowances', kind: 'EARNING', amount: allowances });
  for (const a of cashAllowances) lines.push({ code: a.code, label: a.label, kind: 'EARNING', amount: a.amount });
  if (unpaid > 0) lines.push({ code: 'LEAVE_UNPAID', label: leaveDeduction!.label, kind: 'EARNING', amount: -unpaid });
  const gross = basic + allowances + cashAllowances.reduce((s, a) => s + a.amount, 0) - unpaid;
  const inKind = benefitsInKind.reduce((s, b) => s + b.amount, 0);
  return { lines, gross, basic: basic - unpaid, inKind };
}

/** Benefit-in-kind lines (meal cards, gym, vouchers), shown on the payslip but not paid in cash */
export function benefitLines({ benefitsInKind = [] }: PayInput, taxed: boolean): PayLine[] {
  return benefitsInKind.map((b) => ({ code: b.code, label: taxed ? `${b.label} (taxed)` : b.label, kind: 'BENEFIT' as const, amount: b.amount }));
}

/** Monthly share of a yearly tax, rounded to the cent */
export const monthly = (yearly: number) => cents(Math.max(0, yearly) / 12);

/** Age in whole years on a date (both ISO yyyy-mm-dd) */
export function ageOn(birthDate: string | undefined, on: string): number | undefined {
  if (!birthDate) return undefined;
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Pushes a line only when its amount is not zero */
export function add(lines: PayLine[], line: PayLine) {
  if (line.amount !== 0) lines.push({ ...line, amount: cents(line.amount) });
}
