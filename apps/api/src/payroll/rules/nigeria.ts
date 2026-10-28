import { add, benefitLines, Band, earnings, monthly, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Nigeria monthly payroll rules (draft, to be confirmed by a Nigerian payroll expert).
 * - PAYE under the Nigeria Tax Act 2025 (from January 2026): yearly income after pension and
 *   NHF is taxed nil to 800,000; 15% to 3,000,000; 18% to 12,000,000; 21% to 25,000,000;
 *   23% to 50,000,000; 25% above. The old consolidated relief allowance no longer applies.
 *   Rent relief is not claimed here because the portal does not hold rent paid.
 * - Pension: 8% employee and 10% employer on gross monthly emoluments.
 * - National Housing Fund: 2.5% of basic pay from the employee.
 * - NSITF 1% and ITF 1% of gross pay, paid by the employer.
 * - Benefits in kind are taxed as employment income.
 */
const NGN = 100;
const m = (n: number) => n * 1_000_000 * NGN;
const TAX_BANDS: Band[] = [
  [800_000 * NGN, 0],
  [m(3), 0.15],
  [m(12), 0.18],
  [m(25), 0.21],
  [m(50), 0.23],
  [Number.POSITIVE_INFINITY, 0.25],
];

export const nigeriaYearlyTax = (taxable: number) => progressive(taxable, TAX_BANDS);

export const nigeriaRules: RulesPack = {
  countryCode: 'NG',
  version: 'NG-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, basic, inKind } = earnings(input);
    const pension = cents(gross * 0.08);
    const nhf = cents(basic * 0.025);
    const paye = monthly(nigeriaYearlyTax((gross - pension - nhf + inKind) * 12));
    const out: PayLine[] = [...lines];
    add(out, { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: paye });
    add(out, { code: 'PENSION', label: 'Pension (8%)', kind: 'DEDUCTION', amount: pension });
    add(out, { code: 'NHF', label: 'National Housing Fund (2.5%)', kind: 'DEDUCTION', amount: nhf });
    add(out, { code: 'PENSION_ER', label: 'Pension employer (10%)', kind: 'EMPLOYER', amount: gross * 0.1 });
    add(out, { code: 'NSITF_ER', label: 'NSITF (1%)', kind: 'EMPLOYER', amount: gross * 0.01 });
    add(out, { code: 'ITF_ER', label: 'Industrial Training Fund (1%)', kind: 'EMPLOYER', amount: gross * 0.01 });
    out.push(...benefitLines(input, inKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
