import { kenyaNssf, kenyaPaye, kenyaRules } from './kenya';

const KES = (n: number) => Math.round(n * 100);
const line = (r: ReturnType<typeof kenyaRules.calculate>, code: string) => r.lines.find((l) => l.code === code)?.amount;

describe('Kenya payroll rules', () => {
  it('works out a KES 50,000 salary', () => {
    const r = kenyaRules.calculate({ basic: KES(50_000), allowances: 0 });
    expect(line(r, 'NSSF')).toBe(KES(3_000));
    expect(line(r, 'SHIF')).toBe(KES(1_375));
    expect(line(r, 'AHL')).toBe(KES(750));
    // taxable 44,875: 2,400 + 2,083.25 + 3,762.60 - 2,400 relief
    expect(line(r, 'PAYE')).toBe(KES(5_845.85));
    expect(r.net).toBe(KES(39_029.15));
    expect(r.employerCost).toBe(KES(53_800));
  });

  it('charges no PAYE below the relief threshold', () => {
    const r = kenyaRules.calculate({ basic: KES(20_000), allowances: 0 });
    expect(line(r, 'NSSF')).toBe(KES(1_200));
    expect(line(r, 'SHIF')).toBe(KES(550));
    expect(line(r, 'PAYE')).toBe(0);
    expect(r.net).toBe(KES(17_950));
  });

  it('caps NSSF at the upper earnings limit and adds allowances to gross', () => {
    const r = kenyaRules.calculate({ basic: KES(130_000), allowances: KES(20_000) });
    expect(r.gross).toBe(KES(150_000));
    expect(line(r, 'NSSF')).toBe(KES(4_320));
    expect(line(r, 'PAYE')).toBe(KES(34_174.85));
    expect(r.net).toBe(KES(105_130.15));
  });

  it('applies the SHIF minimum of KES 300', () => {
    const r = kenyaRules.calculate({ basic: KES(8_000), allowances: 0 });
    expect(line(r, 'SHIF')).toBe(KES(300));
  });

  it('taxes the top bands', () => {
    // taxable 1,000,000: 2,400 + 2,083.25 + 140,300.10 + 97,500 + 70,000 - 2,400
    expect(kenyaPaye(KES(1_000_000))).toBe(KES(309_883.35));
    expect(kenyaNssf(KES(5_000))).toBe(KES(300));
  });
});
