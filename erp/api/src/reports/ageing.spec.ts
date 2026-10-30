import { ageItems, bucketFor } from './ageing';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const item = (txDate: string, dueDate: string, amount: bigint, auditNo = 'GL1') => ({
  txDate: d(txDate),
  dueDate: d(dueDate),
  amount,
  auditNo,
  reference: null,
  description: null,
});

describe('ageing', () => {
  it('puts amounts in buckets by days past due', () => {
    expect(bucketFor(-5)).toBe('current');
    expect(bucketFor(0)).toBe('current');
    expect(bucketFor(1)).toBe('days1to30');
    expect(bucketFor(30)).toBe('days1to30');
    expect(bucketFor(31)).toBe('days31to60');
    expect(bucketFor(90)).toBe('days61to90');
    expect(bucketFor(91)).toBe('over90');
  });

  it('clears the oldest invoices first with payments', () => {
    const r = ageItems(
      [
        item('2026-01-10', '2026-02-09', 100n, 'A'),
        item('2026-03-01', '2026-03-31', 200n, 'B'),
        item('2026-03-20', '2026-03-20', -150n, 'PAY'),
      ],
      d('2026-04-15'),
    );
    expect(r.open.map((o) => [o.auditNo, o.open, o.bucket])).toEqual([['B', 150n, 'days1to30']]);
    expect(r.balance).toBe(150n);
    expect(r.unallocatedCredit).toBe(0n);
  });

  it('ages each open invoice from its own due date', () => {
    const r = ageItems([item('2025-12-01', '2025-12-31', 500n), item('2026-04-01', '2026-05-01', 300n)], d('2026-04-15'));
    expect(r.buckets.over90).toBe(500n);
    expect(r.buckets.current).toBe(300n);
    expect(r.balance).toBe(800n);
  });

  it('shows an overpayment as a credit in Current', () => {
    const r = ageItems([item('2026-01-01', '2026-01-31', 100n), item('2026-02-01', '2026-02-01', -250n)], d('2026-04-15'));
    expect(r.open).toHaveLength(0);
    expect(r.unallocatedCredit).toBe(150n);
    expect(r.buckets.current).toBe(-150n);
    expect(r.balance).toBe(-150n);
  });
});
