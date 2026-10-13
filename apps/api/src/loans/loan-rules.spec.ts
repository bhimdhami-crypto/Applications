import { addMonths, instalmentFor, monthsBetween, projection, schedule, ymLabel } from './loan-rules';

describe('loan rules', () => {
  it('splits an interest-free loan into equal instalments, rounded up', () => {
    expect(instalmentFor(100_000_00, 3, 0)).toBe(33_333_34);
    const rows = schedule(100_000_00, 3, 0, 202611);
    expect(rows.map((r) => r.payment)).toEqual([33_333_34, 33_333_34, 33_333_32]);
    expect(rows.at(-1)!.balance).toBe(0);
  });

  it('charges interest on the reducing balance', () => {
    // KES 150,000 over 12 months at 5% a year
    const pay = instalmentFor(150_000_00, 12, 5);
    expect(pay).toBe(12_841_13);
    const rows = schedule(150_000_00, 12, 5, 202610);
    expect(rows).toHaveLength(12);
    expect(rows[0].interest).toBe(625_00);
    expect(rows.at(-1)!.balance).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(150_000_00);
  });

  it('projects what is left at the fixed instalment', () => {
    const rows = projection(50_000_00, 20_000_00, 0, 202612);
    expect(rows.map((r) => [ymLabel(r.month), r.payment])).toEqual([
      ['December 2026', 20_000_00],
      ['January 2027', 20_000_00],
      ['February 2027', 10_000_00],
    ]);
  });

  it('counts months across year ends', () => {
    expect(addMonths(202611, 3)).toBe(202702);
    expect(addMonths(202601, -1)).toBe(202512);
    expect(monthsBetween(new Date('2026-04-15'), new Date('2026-10-14'))).toBe(5);
    expect(monthsBetween(new Date('2026-04-15'), new Date('2026-10-15'))).toBe(6);
  });
});
