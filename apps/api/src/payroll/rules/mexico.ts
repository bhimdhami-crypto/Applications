import { add, benefitLines, earnings } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * Mexico monthly payroll rules (draft, to be confirmed by a Mexican payroll expert).
 * - ISR: the SAT monthly table (lower limit, fixed fee, rate on the excess), less the employment
 *   subsidy for pay up to MXN 11,492.66, which can bring ISR to zero but not below.
 * - IMSS is worked out on the daily integrated wage (salario base de cotización): monthly pay
 *   / 30 x 1.0493 for the legal minimum Christmas bonus and holiday premium, capped at 25 UMA,
 *   over 30.4 days.
 *   Employee 2.375% plus 0.40% on the part above 3 UMA.
 *   Employer: fixed fee of 20.40% of the UMA, 1.10% above 3 UMA, 7.04% for sickness, disability,
 *   work risk (class I), childcare and retirement, plus the 2026 severance-and-old-age rate,
 *   which rises with pay.
 * - INFONAVIT housing fund: 5% employer. State payroll tax: 3% employer (varies by state).
 * - Benefits in kind are exempt up to one UMA a month (pantry vouchers); the rest is taxed.
 * - UMA 2026: MXN 117.31 a day.
 */
const MXN = 100;
const UMA = 117.31 * MXN;
const DAYS = 30.4;
const INTEGRATION = 1.0493;

/** SAT monthly ISR table: [lower limit, fixed fee, rate on the excess] */
const ISR: Array<[number, number, number]> = [
  [0.01, 0, 0.0192],
  [746.05, 14.32, 0.064],
  [6_332.06, 371.83, 0.1088],
  [11_128.02, 893.63, 0.16],
  [12_935.83, 1_182.88, 0.1792],
  [15_487.72, 1_640.18, 0.2136],
  [31_236.5, 5_004.12, 0.2352],
  [49_233.01, 9_236.89, 0.3],
  [93_993.91, 22_665.17, 0.32],
  [125_325.21, 32_691.18, 0.34],
  [375_975.62, 117_912.32, 0.35],
];
const SUBSIDY = { upTo: 11_492.66 * MXN, amount: 0.1502 * UMA * DAYS };
/** Employer severance and old-age rate (cesantía y vejez) in 2026, by daily wage in UMA */
const CEAV: Array<[number, number]> = [
  [1, 0.0315], [1.5, 0.03676], [2, 0.04851], [2.5, 0.05556], [3, 0.06026], [3.5, 0.06361], [4, 0.06613], [Number.POSITIVE_INFINITY, 0.07513],
];

export function mexicoIsr(taxable: number): number {
  const pesos = taxable / MXN;
  const row = [...ISR].reverse().find(([lower]) => pesos >= lower);
  if (!row) return 0;
  const [lower, fee, rate] = row;
  const isr = cents((fee + (pesos - lower) * rate) * MXN);
  return Math.max(0, isr - (taxable <= SUBSIDY.upTo ? cents(SUBSIDY.amount) : 0));
}

export function mexicoImss(gross: number) {
  const sbc = Math.min((gross / 30) * INTEGRATION, 25 * UMA);
  const excess = Math.max(0, sbc - 3 * UMA);
  const employee = (sbc * 0.02375 + excess * 0.004) * DAYS;
  const ceav = CEAV.find(([upTo]) => sbc <= upTo * UMA)![1];
  const employer = (UMA * 0.204 + excess * 0.011 + sbc * (0.0704355 + ceav)) * DAYS;
  return { sbc, employee: cents(employee), employer: cents(employer), infonavit: cents(sbc * 0.05 * DAYS) };
}

export const mexicoRules: RulesPack = {
  countryCode: 'MX',
  version: 'MX-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const taxedInKind = Math.max(0, inKind - cents(UMA * DAYS));
    const imss = mexicoImss(gross);
    const out: PayLine[] = [...lines];
    add(out, { code: 'ISR', label: 'ISR (income tax)', kind: 'DEDUCTION', amount: mexicoIsr(gross + taxedInKind) });
    add(out, { code: 'IMSS', label: 'IMSS social security', kind: 'DEDUCTION', amount: imss.employee });
    add(out, { code: 'IMSS_ER', label: 'IMSS employer', kind: 'EMPLOYER', amount: imss.employer });
    add(out, { code: 'INFONAVIT_ER', label: 'INFONAVIT housing fund (5%)', kind: 'EMPLOYER', amount: imss.infonavit });
    add(out, { code: 'ISN_ER', label: 'State payroll tax (3%)', kind: 'EMPLOYER', amount: gross * 0.03 });
    out.push(...benefitLines(input, taxedInKind > 0));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
