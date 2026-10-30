/**
 * Ageing of customer and supplier balances. Amounts are bigint units (see common/money) signed so that
 * positive means owed: for a customer, what they owe us (debit); for a supplier, what we owe them (credit).
 */

export const BUCKETS = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const;
export type Bucket = (typeof BUCKETS)[number];
export type Buckets = Record<Bucket, bigint>;

export interface AgeingItem {
  txDate: Date;
  dueDate: Date;
  amount: bigint;
  auditNo: string;
  reference: string | null;
  description: string | null;
}

export interface OpenItem extends AgeingItem {
  /** What is left of the item after payments and credits */
  open: bigint;
  daysOverdue: number;
  bucket: Bucket;
}

const DAY = 86_400_000;

export function bucketFor(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
  return 'over90';
}

export const emptyBuckets = (): Buckets => ({ current: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n });

/**
 * Payments and credits clear the oldest amounts due first (by due date, then document date), the usual
 * rule when receipts are not matched to invoices. What is left is aged by days past its due date as at
 * `asAt`. Credits left over after every item is cleared are an unallocated credit, shown as Current.
 */
export function ageItems(items: AgeingItem[], asAt: Date) {
  const owed = items.filter((i) => i.amount > 0n).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.txDate.getTime() - b.txDate.getTime());
  let credit = items.filter((i) => i.amount < 0n).reduce((sum, i) => sum - i.amount, 0n);

  const open: OpenItem[] = [];
  for (const item of owed) {
    const used = credit < item.amount ? credit : item.amount;
    credit -= used;
    const left = item.amount - used;
    if (left === 0n) continue;
    const daysOverdue = Math.floor((asAt.getTime() - item.dueDate.getTime()) / DAY);
    open.push({ ...item, open: left, daysOverdue, bucket: bucketFor(daysOverdue) });
  }

  const buckets = emptyBuckets();
  for (const o of open) buckets[o.bucket] += o.open;
  buckets.current -= credit;
  const balance = BUCKETS.reduce((sum, b) => sum + buckets[b], 0n);
  return { open, unallocatedCredit: credit, buckets, balance };
}
