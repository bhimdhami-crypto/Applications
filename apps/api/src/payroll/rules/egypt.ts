import { add, benefitLines, Band, earnings, monthly, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Egypt monthly payroll rules (draft, to be confirmed by an Egyptian payroll expert).
 * - Social insurance (Law 148/2019): 11% employee and 18.75% employer on the insurable wage,
 *   which is gross pay kept between EGP 2,700 and 16,700 a month (2026 limits).
 * - Income tax (Law 30/2023): yearly pay after social insurance, less the EGP 20,000 personal
 *   exemption, is taxed 0% to 27.5%. Higher earners lose the lower bands step by step:
 *   above 600,000 the 0% band goes, above 700,000 the 10% band, and so on, until above
 *   1,200,000 everything up to 1,200,000 is taxed at 25%.
 * - Martyrs' Families Fund: 0.05% of gross pay from the employee.
 * - Benefits in kind are taxed as salary.
 */
const EGP = 100;
const k = (n: number) => n * 1_000 * EGP;
const INF = Number.POSITIVE_INFINITY;
const INSURABLE = { min: 2_700 * EGP, max: 16_700 * EGP };
const EXEMPTION = 20_000 * EGP;

/** Band tables by taxable yearly income: [income above, bands] */
const TABLES: Array<[number, Band[]]> = [
  [k(1_200), [[k(1_200), 0.25], [INF, 0.275]]],
  [k(900), [[k(400), 0.225], [INF, 0.25]]],
  [k(800), [[k(200), 0.2], [k(400), 0.225], [INF, 0.25]]],
  [k(700), [[k(70), 0.15], [k(200), 0.2], [k(400), 0.225], [INF, 0.25]]],
  [k(600), [[k(55), 0.1], [k(70), 0.15], [k(200), 0.2], [k(400), 0.225], [INF, 0.25]]],
  [0, [[k(40), 0], [k(55), 0.1], [k(70), 0.15], [k(200), 0.2], [k(400), 0.225], [k(1_200), 0.25], [INF, 0.275]]],
];

export function egyptYearlyTax(taxable: number): number {
  const bands = TABLES.find(([above]) => taxable > above)?.[1] ?? TABLES[TABLES.length - 1][1];
  return progressive(taxable, bands);
}

export const egyptRules: RulesPack = {
  countryCode: 'EG',
  version: 'EG-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const insurable = Math.min(Math.max(gross, INSURABLE.min), INSURABLE.max);
    const si = cents(insurable * 0.11);
    const taxable = Math.max(0, (gross - si + inKind) * 12 - EXEMPTION);
    const out: PayLine[] = [...lines];
    add(out, { code: 'TAX', label: 'Salary tax', kind: 'DEDUCTION', amount: monthly(egyptYearlyTax(taxable)) });
    add(out, { code: 'SI', label: 'Social insurance (11%)', kind: 'DEDUCTION', amount: si });
    add(out, { code: 'MARTYRS', label: "Martyrs' Families Fund (0.05%)", kind: 'DEDUCTION', amount: gross * 0.0005 });
    add(out, { code: 'SI_ER', label: 'Social insurance employer (18.75%)', kind: 'EMPLOYER', amount: insurable * 0.1875 });
    out.push(...benefitLines(input, inKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
