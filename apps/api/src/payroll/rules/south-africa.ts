import { add, ageOn, benefitLines, Band, earnings, monthly, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * South Africa monthly payroll rules (draft, to be confirmed by a South African payroll expert).
 * - PAYE: monthly pay is annualised, taxed on the SARS yearly tables and divided by 12.
 *   Brackets 18% to 45%; rebates R17,235 (everyone), R9,444 more from age 65, R3,145 more from 75.
 *   These are the 2025/26 tables, kept until the 2026 Budget figures are confirmed.
 * - Age for the rebates is taken at the end of the tax year (end of February).
 * - UIF: 1% employee and 1% employer on pay up to R17,712 a month.
 * - Skills Development Levy: 1% of gross pay, paid by the employer.
 * - Fringe benefits (meal cards, gym, vouchers) are added to taxable pay.
 */
const ZAR = 100;
const TAX_BANDS: Band[] = [
  [237_100 * ZAR, 0.18],
  [370_500 * ZAR, 0.26],
  [512_800 * ZAR, 0.31],
  [673_000 * ZAR, 0.36],
  [857_900 * ZAR, 0.39],
  [1_817_000 * ZAR, 0.41],
  [Number.POSITIVE_INFINITY, 0.45],
];
const REBATE = { primary: 17_235 * ZAR, secondary: 9_444 * ZAR, tertiary: 3_145 * ZAR };
const UIF_CEILING = 17_712 * ZAR;

export function southAfricaYearlyTax(yearly: number, age?: number): number {
  let rebate = REBATE.primary;
  if (age !== undefined && age >= 65) rebate += REBATE.secondary;
  if (age !== undefined && age >= 75) rebate += REBATE.tertiary;
  return Math.max(0, progressive(yearly, TAX_BANDS) - rebate);
}

export const southAfricaRules: RulesPack = {
  countryCode: 'ZA',
  version: 'ZA-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const { year, month } = input.period ?? { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 };
    const taxYearEnd = `${month >= 3 ? year + 1 : year}-02-28`;
    const paye = monthly(southAfricaYearlyTax((gross + inKind) * 12, ageOn(input.birthDate, taxYearEnd)));
    const uif = cents(Math.min(gross, UIF_CEILING) * 0.01);
    const out: PayLine[] = [...lines];
    add(out, { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: paye });
    add(out, { code: 'UIF', label: 'UIF (1%)', kind: 'DEDUCTION', amount: uif });
    add(out, { code: 'UIF_ER', label: 'UIF employer (1%)', kind: 'EMPLOYER', amount: uif });
    add(out, { code: 'SDL_ER', label: 'Skills Development Levy (1%)', kind: 'EMPLOYER', amount: gross * 0.01 });
    out.push(...benefitLines(input, inKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
