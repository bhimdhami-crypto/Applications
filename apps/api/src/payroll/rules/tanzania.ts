import { add, benefitLines, Band, earnings, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Tanzania (mainland) monthly payroll rules (draft, to be confirmed by a Tanzanian payroll expert).
 * - PAYE per month: nil to 270,000; 8% to 520,000; 20% to 760,000; 25% to 1,000,000; 30% above.
 * - NSSF: 10% employee and 10% employer on gross pay; the employee share is deducted before PAYE.
 * - Skills Development Levy: 3.5% of gross pay, paid by the employer.
 * - Workers Compensation Fund: 0.5% of gross pay, paid by the employer.
 * - Benefits in kind are taxed as employment income.
 */
const TZS = 100;
const PAYE_BANDS: Band[] = [
  [270_000 * TZS, 0],
  [520_000 * TZS, 0.08],
  [760_000 * TZS, 0.2],
  [1_000_000 * TZS, 0.25],
  [Number.POSITIVE_INFINITY, 0.3],
];

export const tanzaniaPaye = (taxable: number) => cents(progressive(taxable, PAYE_BANDS));

export const tanzaniaRules: RulesPack = {
  countryCode: 'TZ',
  version: 'TZ-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const nssf = cents(gross * 0.1);
    const paye = tanzaniaPaye(gross - nssf + inKind);
    const out: PayLine[] = [...lines];
    add(out, { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: paye });
    add(out, { code: 'NSSF', label: 'NSSF (10%)', kind: 'DEDUCTION', amount: nssf });
    add(out, { code: 'NSSF_ER', label: 'NSSF employer (10%)', kind: 'EMPLOYER', amount: nssf });
    add(out, { code: 'SDL_ER', label: 'Skills Development Levy (3.5%)', kind: 'EMPLOYER', amount: gross * 0.035 });
    add(out, { code: 'WCF_ER', label: 'Workers Compensation Fund (0.5%)', kind: 'EMPLOYER', amount: gross * 0.005 });
    out.push(...benefitLines(input, inKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
