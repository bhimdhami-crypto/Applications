import { PrismaService } from '../prisma/prisma.service';

/** A payroll month as year * 100 + month, e.g. 202611 */
export const ym = (year: number, month: number) => year * 100 + month;
export const ymOf = (d: Date) => ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
export function addMonths(value: number, n: number) {
  const index = Math.floor(value / 100) * 12 + (value % 100) - 1 + n;
  return ym(Math.floor(index / 12), (index % 12) + 1);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const ymLabel = (value: number) => `${MONTHS[(value % 100) - 1]} ${Math.floor(value / 100)}`;

/**
 * The first payroll month that can still take a new deduction or benefit for a company: the current
 * month, or the month after the latest approved or finalised run when payroll has already moved past it.
 */
export async function openPayMonth(prisma: PrismaService, legalEntityId: string) {
  const locked = await prisma.payrollRun.findFirst({
    where: { legalEntityId, status: { in: ['APPROVED', 'FINALIZED'] } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: { year: true, month: true },
  });
  const now = ymOf(new Date());
  return locked ? Math.max(now, addMonths(ym(locked.year, locked.month), 1)) : now;
}
