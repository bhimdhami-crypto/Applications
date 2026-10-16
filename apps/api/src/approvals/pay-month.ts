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
 * The first payroll month that can still take a new deduction or benefit for a company.
 * Until month-end payroll is carried over this is always the current month; the payroll slice
 * moves it on once a month's run is approved.
 */
export async function openPayMonth(_prisma: PrismaService, _legalEntityId: string) {
  return ymOf(new Date());
}
