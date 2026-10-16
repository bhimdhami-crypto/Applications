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

describe('Kenya benefits and voluntary deductions', () => {
  const base = { basic: 100_000_00, allowances: 0 };

  it('leaves benefits in kind up to KES 5,000 a month untaxed', () => {
    const plain = kenyaRules.calculate(base);
    const withMeal = kenyaRules.calculate({ ...base, benefitsInKind: [{ code: 'MEAL', label: 'Meal: Canteen wallet', amount: 4_000_00 }] });
    expect(withMeal.net).toBe(plain.net);
    expect(withMeal.gross).toBe(plain.gross);
    expect(withMeal.lines.find((l) => l.kind === 'BENEFIT')!.amount).toBe(4_000_00);
    expect(withMeal.employerCost).toBe(plain.employerCost + 4_000_00);
  });

  it('taxes the whole value once benefits in kind pass KES 5,000', () => {
    const plain = kenyaRules.calculate(base);
    const r = kenyaRules.calculate({
      ...base,
      benefitsInKind: [
        { code: 'MEAL', label: 'Meal', amount: 4_000_00 },
        { code: 'GYM', label: 'Gym', amount: 3_000_00 },
      ],
    });
    // 7,000 more taxable pay at the 30% band
    expect(plain.net - r.net).toBe(2_100_00);
  });

  it('pays a cash allowance as taxable earnings', () => {
    const r = kenyaRules.calculate({ ...base, cashAllowances: [{ code: 'MEAL_CASH', label: 'Remote meal allowance', amount: 3_000_00 }] });
    expect(r.gross).toBe(103_000_00);
  });

  it('takes voluntary deductions after tax, but never below a third of gross pay', () => {
    const plain = kenyaRules.calculate(base);
    const r = kenyaRules.calculate({
      ...base,
      voluntary: [
        { code: 'ADVANCE', label: 'Salary advance recovery', amount: 30_000_00, ref: 'a1' },
        { code: 'LOAN', label: 'Personal loan repayment', amount: 40_000_00, ref: 'l1', interest: 500_00 },
      ],
    });
    expect(r.lines.find((l) => l.code === 'ADVANCE')!.amount).toBe(30_000_00);
    const loan = r.lines.find((l) => l.code === 'LOAN')!;
    expect(loan.label).toContain('(part)');
    expect(r.net).toBe(Math.ceil(100_000_00 / 3));
    expect(loan.amount).toBe(plain.net - 30_000_00 - Math.ceil(100_000_00 / 3));
    expect(loan.interest).toBe(500_00);
  });

  it('charges the employer fringe benefit tax on cheap staff loans', () => {
    const r = kenyaRules.calculate({ ...base, staffLoans: [{ outstanding: 120_000_00, yearlyRate: 5 }] });
    // 30% of (13% - 5%) / 12 of KES 120,000
    expect(r.lines.find((l) => l.code === 'FBT_ER')!.amount).toBe(240_00);
  });
});
