import { add, benefitLines, Band, earnings, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Uganda monthly payroll rules (draft, to be confirmed by a Ugandan payroll expert).
 * - PAYE for residents per month: nil to 235,000; 10% to 335,000; 20% to 410,000; 30% above,
 *   plus a further 10% on income above 10,000,000.
 * - NSSF: 5% employee and 10% employer on gross pay. The employee share is not tax-deductible.
 * - Local Service Tax: a yearly amount set by monthly pay, deducted in four equal parts
 *   from July to October (the first four months of the financial year).
 * - Benefits in kind are taxed as employment income.
 */
const UGX = 100;
const PAYE_BANDS: Band[] = [
  [235_000 * UGX, 0],
  [335_000 * UGX, 0.1],
  [410_000 * UGX, 0.2],
  [Number.POSITIVE_INFINITY, 0.3],
];
const HIGH_INCOME = 10_000_000 * UGX;
/** Yearly Local Service Tax by monthly pay: [pay above, tax] */
const LST: Array<[number, number]> = [
  [1_000_000, 100_000], [900_000, 90_000], [800_000, 80_000], [700_000, 70_000], [600_000, 60_000],
  [500_000, 40_000], [400_000, 30_000], [300_000, 20_000], [200_000, 10_000], [100_000, 5_000],
];

export function ugandaPaye(taxable: number): number {
  return cents(progressive(taxable, PAYE_BANDS) + Math.max(0, taxable - HIGH_INCOME) * 0.1);
}

export function ugandaLst(gross: number, month?: number): number {
  if (!month || month < 7 || month > 10) return 0;
  const yearly = LST.find(([above]) => gross > above * UGX)?.[1] ?? 0;
  return cents((yearly * UGX) / 4);
}

export const ugandaRules: RulesPack = {
  countryCode: 'UG',
  version: 'UG-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const paye = ugandaPaye(gross + inKind);
    const nssf = cents(gross * 0.05);
    const out: PayLine[] = [...lines];
    add(out, { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: paye });
    add(out, { code: 'NSSF', label: 'NSSF (5%)', kind: 'DEDUCTION', amount: nssf });
    add(out, { code: 'LST', label: 'Local Service Tax', kind: 'DEDUCTION', amount: ugandaLst(gross, input.period?.month) });
    add(out, { code: 'NSSF_ER', label: 'NSSF employer (10%)', kind: 'EMPLOYER', amount: gross * 0.1 });
    out.push(...benefitLines(input, inKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
