/** BENEFIT: value received in kind (meal card, gym, voucher). Taxed, but not paid in cash. */
export type LineKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER' | 'BENEFIT';

export interface PayLine {
  code: string;
  label: string;
  kind: LineKind;
  /** Amount in minor units (cents) */
  amount: number;
  /** The loan, advance or IOU a deduction repays */
  ref?: string;
  /** Interest included in a loan deduction, in minor units */
  interest?: number;
  /** An after-tax deduction the employee agreed to (loan, advance, benefit share), not a statutory one */
  voluntary?: boolean;
}

export interface PayItem {
  code: string;
  label: string;
  /** Minor units */
  amount: number;
  ref?: string;
  interest?: number;
}

export interface PayInput {
  /** Monthly base pay in minor units */
  basic: number;
  /** Monthly taxable cash allowances in minor units */
  allowances: number;
  /** Pay withheld for unpaid days (unpaid leave, sick leave past its allowance), in minor units */
  leaveDeduction?: { amount: number; label: string };
  /** Other taxable cash paid with the salary, e.g. a remote meal allowance */
  cashAllowances?: PayItem[];
  /** Taxable value of benefits in kind: company share of meal and gym plans, gift vouchers */
  benefitsInKind?: PayItem[];
  /**
   * Deductions after tax, most important first: advances, IOUs, loan instalments, gym shares.
   * Each is cut back so take-home pay stays above the country's minimum share of gross pay.
   */
  voluntary?: PayItem[];
  /** Staff loans below the market rate, for countries that tax that benefit */
  staffLoans?: Array<{ outstanding: number; yearlyRate: number }>;
  /** The month being paid; some countries change rates mid-year or deduct levies in set months */
  period?: { year: number; month: number };
  /** ISO date of birth, for age-based tax rebates */
  birthDate?: string;
}

export interface PayResult {
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
}

/** A country's payroll rules. One pack per country, versioned by effective date. */
export interface RulesPack {
  countryCode: string;
  version: string;
  /** False until a local payroll expert has signed off the rates */
  verified: boolean;
  calculate(input: PayInput): PayResult;
}

export function summarise(lines: PayLine[]): PayResult {
  const sum = (kind: LineKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const gross = sum('EARNING');
  const deductions = sum('DEDUCTION');
  return { lines, gross, deductions, net: gross - deductions, employerCost: gross + sum('EMPLOYER') + sum('BENEFIT') };
}

/**
 * POL-22 section 3.4: all deductions together may not leave the employee with less than
 * minShare of gross pay. Voluntary deductions are taken in order until that floor is reached;
 * what cannot be taken is left for later months (a loan simply runs longer).
 */
export function applyVoluntary(lines: PayLine[], voluntary: PayItem[] = [], minShare = 1 / 3): PayLine[] {
  const gross = lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0);
  const statutory = lines.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amount, 0);
  let room = Math.max(0, gross - statutory - Math.ceil(gross * minShare));
  const out = [...lines];
  for (const item of voluntary) {
    const take = Math.min(item.amount, room);
    if (take <= 0) continue;
    room -= take;
    // Interest is paid before principal when only part of an instalment fits
    const interest = item.interest === undefined ? undefined : Math.min(item.interest, take);
    out.push({ code: item.code, label: take < item.amount ? `${item.label} (part)` : item.label, kind: 'DEDUCTION', amount: take, ref: item.ref, interest, voluntary: true });
  }
  return out;
}

/** Rounds a minor-unit amount to the nearest cent */
export const cents = (value: number) => Math.round(value);
