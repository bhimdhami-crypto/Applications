import { add, benefitLines, Band, earnings, monthly, progressive } from './common';
import { PayInput, PayLine, RulesPack, applyVoluntary, cents, summarise } from './types';

/**
 * New Zealand monthly payroll rules (draft, to be confirmed by a New Zealand payroll expert).
 * - PAYE (tax code M): monthly pay is annualised and taxed 10.5% to $15,600, 17.5% to $53,500,
 *   30% to $78,100, 33% to $180,000 and 39% above, then divided by 12.
 * - ACC earners' levy: 1.75% of pay up to $156,641 a year.
 * - KiwiSaver: 3.5% employee and 3.5% employer from April 2026 (3% before). Employer
 *   superannuation contribution tax (ESCT) is withheld from the employer share at a rate set
 *   by the employee's yearly pay plus employer contributions.
 * - Benefits in kind are not taxed through PAYE; the employer pays fringe benefit tax at the
 *   single rate of 63.93% of their value.
 */
const NZD = 100;
const TAX_BANDS: Band[] = [
  [15_600 * NZD, 0.105],
  [53_500 * NZD, 0.175],
  [78_100 * NZD, 0.3],
  [180_000 * NZD, 0.33],
  [Number.POSITIVE_INFINITY, 0.39],
];
const ACC = { rate: 0.0175, cap: 156_641 * NZD };
/** ESCT rate by yearly pay plus employer contributions: [up to, rate] */
const ESCT: Array<[number, number]> = [
  [18_720 * NZD, 0.105], [64_200 * NZD, 0.175], [93_720 * NZD, 0.3], [216_000 * NZD, 0.33], [Number.POSITIVE_INFINITY, 0.39],
];
const FBT_RATE = 0.6393;

export const newZealandYearlyTax = (yearly: number) => progressive(yearly, TAX_BANDS);

export function kiwiSaverRate(period?: { year: number; month: number }) {
  if (!period) return 0.035;
  return period.year * 100 + period.month >= 202604 ? 0.035 : 0.03;
}

export const newZealandRules: RulesPack = {
  countryCode: 'NZ',
  version: 'NZ-2026.1-draft',
  verified: false,
  calculate(input: PayInput) {
    const { lines, gross, inKind } = earnings(input);
    const rate = kiwiSaverRate(input.period);
    const kiwiSaver = cents(gross * rate);
    const esctRate = ESCT.find(([upTo]) => (gross + kiwiSaver) * 12 <= upTo)![1];
    const esct = cents(kiwiSaver * esctRate);
    const pct = `${Math.round(rate * 1000) / 10}%`;
    const out: PayLine[] = [...lines];
    add(out, { code: 'PAYE', label: 'PAYE (income tax)', kind: 'DEDUCTION', amount: monthly(newZealandYearlyTax(gross * 12)) });
    add(out, { code: 'ACC', label: "ACC earners' levy", kind: 'DEDUCTION', amount: Math.min(gross, ACC.cap / 12) * ACC.rate });
    add(out, { code: 'KIWISAVER', label: `KiwiSaver (${pct})`, kind: 'DEDUCTION', amount: kiwiSaver });
    add(out, { code: 'KIWISAVER_ER', label: `KiwiSaver employer (${pct}, after ESCT)`, kind: 'EMPLOYER', amount: kiwiSaver - esct });
    add(out, { code: 'ESCT_ER', label: 'ESCT on employer KiwiSaver', kind: 'EMPLOYER', amount: esct });
    add(out, { code: 'FBT_ER', label: 'Fringe benefit tax (63.93%)', kind: 'EMPLOYER', amount: inKind * FBT_RATE });
    out.push(...benefitLines(input, false));
    return summarise(applyVoluntary(out, input.voluntary, 1 / 3));
  },
};
