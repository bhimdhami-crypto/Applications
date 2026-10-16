import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Kenya monthly payroll rules (draft, to be confirmed by a Kenyan payroll expert).
 * - PAYE bands per month: 24,000 at 10%, next 8,333 at 25%, next 467,667 at 30%,
 *   next 300,000 at 32.5%, above 800,000 at 35%; personal relief KES 2,400.
 * - NSSF: 6% employee and 6% employer on pensionable pay up to the upper earnings
 *   limit of KES 72,000 (Tier I up to 8,000, Tier II above it).
 * - SHIF: 2.75% of gross pay, minimum KES 300.
 * - Affordable Housing Levy: 1.5% employee and 1.5% employer on gross pay.
 * - NSSF, SHIF and the Housing Levy are deducted before PAYE is worked out.
 * - NITA: KES 50 per employee per month, paid by the employer.
 * - Benefits in kind (meal cards, gym subsidy, gift vouchers) are tax-free while their total
 *   for the month is KES 5,000 or less; above that the whole value is added to taxable pay.
 * - Fringe benefit tax: the employer pays 30% of the interest saved on staff loans below
 *   the market rate KRA publishes each quarter (KE_MARKET_RATE, update it every quarter).
 * - Deductions may not leave the employee less than a third of gross pay (Employment Act s.19).
 */
const KES = 100; // minor units per shilling

const PAYE_BANDS: Array<[number, number]> = [
  [24_000 * KES, 0.1],
  [8_333 * KES, 0.25],
  [467_667 * KES, 0.3],
  [300_000 * KES, 0.325],
  [Number.POSITIVE_INFINITY, 0.35],
];
const PERSONAL_RELIEF = 2_400 * KES;
const NSSF_RATE = 0.06;
const NSSF_LOWER_LIMIT = 8_000 * KES;
const NSSF_UPPER_LIMIT = 72_000 * KES;
const SHIF_RATE = 0.0275;
const SHIF_MINIMUM = 300 * KES;
const AHL_RATE = 0.015;
const NITA_LEVY = 50 * KES;
const BENEFIT_TAX_FREE = 5_000 * KES;
/** KRA market interest rate for fringe benefit tax, percent a year (placeholder until confirmed) */
export const KE_MARKET_RATE = 13;
const FBT_RATE = 0.3;

export function kenyaPaye(taxable: number): number {
  let remaining = taxable;
  let tax = 0;
  for (const [width, rate] of PAYE_BANDS) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, width);
    tax += slice * rate;
    remaining -= slice;
  }
  return Math.max(0, cents(tax) - PERSONAL_RELIEF);
}

export function kenyaNssf(gross: number): number {
  const pensionable = Math.min(gross, NSSF_UPPER_LIMIT);
  const tier1 = Math.min(pensionable, NSSF_LOWER_LIMIT) * NSSF_RATE;
  const tier2 = Math.max(0, pensionable - NSSF_LOWER_LIMIT) * NSSF_RATE;
  return cents(tier1) + cents(tier2);
}

export const kenyaRules: RulesPack = {
  countryCode: 'KE',
  version: 'KE-2026.2-draft',
  verified: false,
  calculate({ basic, allowances, leaveDeduction, cashAllowances = [], benefitsInKind = [], voluntary = [], staffLoans = [] }: PayInput) {
    const unpaid = Math.min(leaveDeduction?.amount ?? 0, basic);
    const extraCash = cashAllowances.reduce((s, a) => s + a.amount, 0);
    const gross = basic + allowances + extraCash - unpaid;
    const nssf = kenyaNssf(gross);
    const shif = Math.max(cents(gross * SHIF_RATE), SHIF_MINIMUM);
    const ahl = cents(gross * AHL_RATE);
    const inKind = benefitsInKind.reduce((s, b) => s + b.amount, 0);
    const taxedInKind = inKind > BENEFIT_TAX_FREE ? inKind : 0;
    const taxable = gross - nssf - shif - ahl + taxedInKind;
    const paye = kenyaPaye(taxable);
    const fbt = staffLoans.reduce((s, l) => s + Math.max(0, KE_MARKET_RATE - l.yearlyRate) / 1200 * l.outstanding * FBT_RATE, 0);

    const lines: PayLine[] = [
      { code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amount: basic },
    ];
    if (allowances > 0) lines.push({ code: 'ALLOW', label: 'Allowances', kind: 'EARNING', amount: allowances });
    for (const a of cashAllowances) lines.push({ code: a.code, label: a.label, kind: 'EARNING', amount: a.amount });
    // Unpaid days reduce taxable pay, so they come off the earnings rather than after tax
    if (unpaid > 0) lines.push({ code: 'LEAVE_UNPAID', label: leaveDeduction!.label, kind: 'EARNING', amount: -unpaid });
    lines.push(
      { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: paye },
      { code: 'NSSF', label: 'NSSF pension', kind: 'DEDUCTION', amount: nssf },
      { code: 'SHIF', label: 'SHIF health insurance', kind: 'DEDUCTION', amount: shif },
      { code: 'AHL', label: 'Affordable Housing Levy', kind: 'DEDUCTION', amount: ahl },
      { code: 'NSSF_ER', label: 'NSSF employer', kind: 'EMPLOYER', amount: nssf },
      { code: 'AHL_ER', label: 'Housing Levy employer', kind: 'EMPLOYER', amount: ahl },
      { code: 'NITA_ER', label: 'NITA training levy', kind: 'EMPLOYER', amount: NITA_LEVY },
    );
    if (fbt > 0) lines.push({ code: 'FBT_ER', label: 'Fringe benefit tax on staff loans', kind: 'EMPLOYER', amount: cents(fbt) });
    for (const b of benefitsInKind) {
      lines.push({ code: b.code, label: taxedInKind ? `${b.label} (taxed)` : b.label, kind: 'BENEFIT', amount: b.amount });
    }
    return summarise(applyVoluntary(lines, voluntary, 1 / 3));
  },
};
