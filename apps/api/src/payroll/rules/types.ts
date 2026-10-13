export type LineKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER';

export interface PayLine {
  code: string;
  label: string;
  kind: LineKind;
  /** Amount in minor units (cents) */
  amount: number;
}

export interface PayInput {
  /** Monthly base pay in minor units */
  basic: number;
  /** Monthly taxable cash allowances in minor units */
  allowances: number;
  /** Pay withheld for unpaid days (unpaid leave, sick leave past its allowance), in minor units */
  leaveDeduction?: { amount: number; label: string };
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
  return { lines, gross, deductions, net: gross - deductions, employerCost: gross + sum('EMPLOYER') };
}

/** Rounds a minor-unit amount to the nearest cent */
export const cents = (value: number) => Math.round(value);
