import { PayrollStatus } from '@prisma/client';
import { addMonths, ymOf } from '../loans/loan-rules';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The first payroll month that can still take a new deduction or benefit for a company:
 * this month, unless its run is already approved or finalized.
 */
export async function openPayMonth(prisma: PrismaService, companyId: string) {
  let month = ymOf(new Date());
  for (let i = 0; i < 24; i++) {
    const run = await prisma.payrollRun.findUnique({
      where: { companyId_periodYear_periodMonth: { companyId, periodYear: Math.floor(month / 100), periodMonth: month % 100 } },
      select: { status: true },
    });
    if (!run || run.status === PayrollStatus.DRAFT) return month;
    month = addMonths(month, 1);
  }
  return month;
}
