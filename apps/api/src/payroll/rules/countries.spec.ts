import { egyptRules } from './egypt';
import { rulesFor } from './index';
import { mexicoRules } from './mexico';
import { newZealandRules } from './new-zealand';
import { nigeriaRules } from './nigeria';
import { southAfricaRules } from './south-africa';
import { tanzaniaRules } from './tanzania';
import { PayInput, PayResult } from './types';
import { ugandaRules } from './uganda';

const units = (n: number) => Math.round(n * 100);
const pay = (n: number, extra: Partial<PayInput> = {}): PayInput => ({ basic: units(n), allowances: 0, ...extra });
const line = (r: PayResult, code: string) => r.lines.find((l) => l.code === code)?.amount;
const OCT = { year: 2026, month: 10 };

describe('payroll rules for every country', () => {
  it('has a draft pack for all eight countries and none for the US parent', () => {
    for (const c of ['KE', 'UG', 'TZ', 'ZA', 'EG', 'NG', 'MX', 'NZ']) expect(rulesFor(c)?.verified).toBe(false);
    expect(rulesFor('US')).toBeUndefined();
  });

  it('Uganda: PAYE bands, NSSF and Local Service Tax from July to October', () => {
    // 10% of 100,000 + 20% of 75,000 + 30% of 590,000; LST 90,000 a year in four parts
    const r = ugandaRules.calculate(pay(1_000_000, { period: { year: 2026, month: 8 } }));
    expect(line(r, 'PAYE')).toBe(units(202_000));
    expect(line(r, 'NSSF')).toBe(units(50_000));
    expect(line(r, 'LST')).toBe(units(22_500));
    expect(line(r, 'NSSF_ER')).toBe(units(100_000));
    expect(line(ugandaRules.calculate(pay(1_000_000, { period: { year: 2026, month: 11 } })), 'LST')).toBeUndefined();
    // Above 10 million a further 10%: 25,000 + 30% of 14,590,000 + 10% of 5,000,000
    expect(line(ugandaRules.calculate(pay(15_000_000)), 'PAYE')).toBe(units(4_902_000));
  });

  it('Tanzania: NSSF comes off before PAYE', () => {
    // taxable 1,080,000: 128,000 + 30% of 80,000
    const r = tanzaniaRules.calculate(pay(1_200_000));
    expect(line(r, 'NSSF')).toBe(units(120_000));
    expect(line(r, 'PAYE')).toBe(units(152_000));
    expect(line(r, 'SDL_ER')).toBe(units(42_000));
    expect(r.net).toBe(units(928_000));
  });

  it('South Africa: annualised PAYE with age rebates and capped UIF', () => {
    // 360,000 a year: 42,678 + 26% of 122,900 - 17,235 rebate = 57,397, a twelfth a month
    const young = southAfricaRules.calculate(pay(30_000, { birthDate: '1990-01-01', period: OCT }));
    expect(line(young, 'PAYE')).toBe(units(4_783.08));
    expect(line(young, 'UIF')).toBe(units(177.12));
    // 72 at the end of February 2027: the secondary rebate applies too
    const older = southAfricaRules.calculate(pay(30_000, { birthDate: '1955-01-01', period: OCT }));
    expect(line(older, 'PAYE')).toBe(units(3_996.08));
  });

  it('Egypt: social insurance cap, personal exemption and the loss of lower bands', () => {
    // Insurable wage capped at 16,700. Taxable 217,956 - 20,000 = 197,956 a year
    const r = egyptRules.calculate(pay(20_000));
    expect(line(r, 'SI')).toBe(units(1_837));
    expect(line(r, 'TAX')).toBe(units(2_445.1));
    expect(line(r, 'MARTYRS')).toBe(units(10));
    // 677,956 a year is above 600,000, so the 0% band is lost
    expect(line(egyptRules.calculate(pay(60_000)), 'TAX')).toBe(units(12_353.25));
  });

  it('Nigeria: 2026 bands after pension and NHF', () => {
    // (1,000,000 - 80,000 - 25,000) x 12 = 10,740,000: 15% of 2,200,000 + 18% of 7,740,000
    const r = nigeriaRules.calculate(pay(1_000_000));
    expect(line(r, 'PENSION')).toBe(units(80_000));
    expect(line(r, 'NHF')).toBe(units(25_000));
    expect(line(r, 'PAYE')).toBe(units(143_600));
    expect(line(r, 'PENSION_ER')).toBe(units(100_000));
  });

  it('Mexico: ISR table, employment subsidy and IMSS', () => {
    // 1,640.18 + 21.36% of (30,000 - 15,487.72)
    const r = mexicoRules.calculate(pay(30_000));
    expect(line(r, 'ISR')).toBe(units(4_740));
    expect(line(r, 'IMSS')).toBeGreaterThan(0);
    expect(line(r, 'INFONAVIT_ER')).toBeGreaterThan(0);
    // Low pay: the subsidy cuts ISR, never below zero
    const low = mexicoRules.calculate(pay(8_000));
    expect(line(low, 'ISR')!).toBeLessThan(units(500));
  });

  it('New Zealand: PAYE, ACC, KiwiSaver at 3.5% from April 2026 and ESCT', () => {
    // 96,000 a year: 1,638 + 6,632.50 + 7,380 + 5,907 = 21,557.50
    const r = newZealandRules.calculate(pay(8_000, { period: OCT }));
    expect(line(r, 'PAYE')).toBe(units(1_796.46));
    expect(line(r, 'ACC')).toBe(units(140));
    expect(line(r, 'KIWISAVER')).toBe(units(280));
    // ESCT at 33%: yearly pay plus employer contributions is 99,360
    expect(line(r, 'ESCT_ER')).toBe(units(92.4));
    expect(line(newZealandRules.calculate(pay(8_000, { period: { year: 2026, month: 3 } })), 'KIWISAVER')).toBe(units(240));
  });

  it('keeps take-home pay above a third of gross in every country', () => {
    for (const c of ['UG', 'TZ', 'ZA', 'EG', 'NG', 'MX', 'NZ']) {
      const r = rulesFor(c)!.calculate(pay(50_000, { voluntary: [{ code: 'LOAN', label: 'Staff loan', amount: units(1_000_000) }] }));
      expect(r.net).toBeGreaterThanOrEqual(Math.ceil(r.gross / 3));
      expect(line(r, 'LOAN')).toBeGreaterThan(0);
    }
  });

  it('shows benefits in kind and takes unpaid leave off gross', () => {
    const r = southAfricaRules.calculate(pay(30_000, {
      period: OCT,
      leaveDeduction: { amount: units(1_000), label: 'Leave: 1 unpaid day of 22' },
      benefitsInKind: [{ code: 'MEAL', label: 'Meal card', amount: units(500) }],
    }));
    expect(r.gross).toBe(units(29_000));
    expect(r.lines.find((l) => l.code === 'MEAL')?.label).toBe('Meal card (taxed)');
    // New Zealand: the employer pays FBT instead of the employee paying PAYE on it
    const nz = newZealandRules.calculate(pay(8_000, { benefitsInKind: [{ code: 'GYM', label: 'Gym', amount: units(100) }] }));
    expect(line(nz, 'FBT_ER')).toBe(units(63.93));
    expect(line(nz, 'PAYE')).toBe(units(1_796.46));
  });
});
