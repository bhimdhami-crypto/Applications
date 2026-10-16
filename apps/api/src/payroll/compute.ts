import { addDays, IsoDate, workingDays } from '../leave/calendar';
import { PayItem, PayLine, RulesPack } from './rules';

export const toMajorNumber = (minor: number) => Math.round(minor) / 100;
const major = (minor: number) => (minor / 100).toFixed(2);

/** Inputs for one employee's month, in minor units */
export interface SlipInput {
  basic: number;
  allowances: number;
  /** Pay withheld for unpaid days and part months */
  withheld?: { amount: number; label: string };
  perks?: { cashAllowances: PayItem[]; benefitsInKind: PayItem[]; voluntary: PayItem[] };
  loans?: { voluntary: PayItem[]; staffLoans: Array<{ outstanding: number; yearlyRate: number }> };
  year: number;
  month: number;
  birthDate?: string;
}

/**
 * Runs one employee's month through the country pack and returns payslip figures in major units.
 * Loans, advances and IOUs are taken before benefit shares, as the first build did.
 */
export function computeSlip(pack: RulesPack, i: SlipInput) {
  const r = pack.calculate({
    basic: i.basic,
    allowances: i.allowances,
    leaveDeduction: i.withheld,
    cashAllowances: i.perks?.cashAllowances,
    benefitsInKind: i.perks?.benefitsInKind,
    voluntary: [...(i.loans?.voluntary ?? []), ...(i.perks?.voluntary ?? [])],
    staffLoans: i.loans?.staffLoans,
    period: { year: i.year, month: i.month },
    birthDate: i.birthDate,
  });
  return {
    minor: r,
    gross: major(r.gross),
    deductions: major(r.deductions),
    net: major(r.net),
    employerCost: major(r.employerCost),
    lines: r.lines.map((l: PayLine) => ({ ...l, amount: toMajorNumber(l.amount), ...(l.interest !== undefined ? { interest: toMajorNumber(l.interest) } : {}) })),
  };
}

/**
 * Working days not employed in the month, for someone who joined or left part-way through.
 * A company rule of the first build (pay follows working days), not a statutory one.
 */
export function partMonth(start: IsoDate, end: IsoDate, hireDate: IsoDate, endDate: IsoDate | null, weekend: readonly number[], holidays: Set<IsoDate>) {
  const all = workingDays(start, end, weekend, holidays);
  const from = hireDate > start ? hireDate : start;
  const to = endDate && endDate < end ? endDate : end;
  const worked = from > to ? 0 : workingDays(from, to, weekend, holidays).length;
  const missed = all.length - worked;
  if (missed <= 0) return null;
  const label = hireDate > start ? `Joined ${hireDate}` : `Left ${endDate}`;
  return { missed, of: all.length, label: `${label}: ${worked} of ${all.length} working days` };
}

/** Unpaid leave and half-pay sick days as a label, e.g. "Leave: 2 unpaid days of 22" */
export function leaveLabel(cut: { unpaidDays: number; halfPayDays: number }, monthDays: number) {
  const parts = [];
  if (cut.unpaidDays) parts.push(`${cut.unpaidDays} unpaid day${cut.unpaidDays === 1 ? '' : 's'}`);
  if (cut.halfPayDays) parts.push(`${cut.halfPayDays} half-pay sick day${cut.halfPayDays === 1 ? '' : 's'}`);
  return `Leave: ${parts.join(', ')} of ${monthDays}`;
}

export const monthBounds = (year: number, month: number) => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start, end: addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`, -1) };
};
