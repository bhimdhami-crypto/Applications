import { LoanKind, PayrollStatus, PrismaClient } from '@prisma/client';
import { toMinor } from '../src/approvals/people';
import { BenefitsService } from '../src/benefits/benefits.service';
import { LeaveService } from '../src/leave/leave.service';
import { loanTitle } from '../src/loans/loan-rules';
import { PayItem, rulesFor } from '../src/payroll/rules';
import { calculateRun, PaySources } from '../src/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** The month of payroll history the demo starts with, matching the loan repayments already recorded for it */
const YEAR = 2026;
const MONTH = 9;
const CODE: Record<LoanKind, string> = { ADVANCE: 'ADVANCE', IOU: 'IOU', LOAN: 'LOAN' };

/**
 * A finalised September 2026 payroll for every company that has draft country rules and payroll
 * switched on, worked out by the same calculation the portal uses. Loan lines repeat the September
 * repayments the loans seed already recorded, and are linked to their payslips. Skipped when runs exist.
 */
export async function generatePayroll(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  if (await prisma.payrollRun.count({ where: { legalEntity: { groupId } } })) {
    log('  Payroll runs already present, skipped.');
    return;
  }
  const db = prisma as unknown as PrismaService;
  // Only the methods that read the database are used, so the services' other helpers are not needed
  const leave = new LeaveService(db, null!, null!, null!, null!);
  const benefits = new BenefitsService(db, null!, null!, null!);
  const entities = await prisma.legalEntity.findMany({ where: { groupId, features: { some: { module: 'payroll', enabled: true } } }, select: { id: true, code: true, countryCode: true, functionalCurrency: true }, orderBy: { code: 'asc' } });
  let runs = 0;
  let slips = 0;
  for (const e of entities) {
    const pack = rulesFor(e.countryCode);
    if (!pack) continue;
    const repaid = await prisma.loanRepayment.findMany({
      where: { year: YEAR, month: MONTH, source: 'PAYROLL', loan: { employment: { legalEntityId: e.id } } },
      include: { loan: { include: { repayments: { select: { year: true, month: true, principal: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const sources: PaySources = {
      leave,
      benefits,
      loans: {
        payrollItems: async () => {
          const out = new Map<string, { voluntary: PayItem[]; staffLoans: Array<{ outstanding: number; yearlyRate: number }> }>();
          for (const r of repaid) {
            const entry = out.get(r.loan.employmentId) ?? { voluntary: [], staffLoans: [] };
            const label = r.loan.kind === LoanKind.ADVANCE ? 'Salary advance recovery' : r.loan.kind === LoanKind.IOU ? 'IOU balance recovery' : `${loanTitle(r.loan)} repayment`;
            entry.voluntary.push({ code: CODE[r.loan.kind], label, amount: toMinor(r.amount), ref: r.loanId, interest: toMinor(r.interest) });
            if (r.loan.kind === LoanKind.LOAN) {
              const before = r.loan.repayments.filter((p) => p.year * 100 + p.month < YEAR * 100 + MONTH).reduce((t, p) => t + toMinor(p.principal), 0);
              entry.staffLoans.push({ outstanding: toMinor(r.loan.recoverable) - before, yearlyRate: Number(r.loan.interestRate) });
            }
            out.set(r.loan.employmentId, entry);
          }
          return out;
        },
      },
    };
    const run = await prisma.payrollRun.create({ data: { legalEntityId: e.id, year: YEAR, month: MONTH, currency: e.functionalCurrency, rulesVersion: pack.version, rulesVerified: pack.verified } });
    await calculateRun(prisma, sources, run.id);
    // Each repayment points at the payslip it came off
    const payslips = await prisma.payslip.findMany({ where: { runId: run.id }, select: { id: true, employmentId: true } });
    const slipOf = new Map(payslips.map((p) => [p.employmentId, p.id]));
    for (const r of repaid) {
      const payslipId = slipOf.get(r.loan.employmentId);
      if (payslipId) await prisma.loanRepayment.update({ where: { id: r.id }, data: { payslipId } });
    }
    const done = new Date(Date.UTC(YEAR, MONTH - 1, 25, 12));
    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: PayrollStatus.FINALIZED, submittedAt: done, approvedAt: done, finalizedAt: done } });
    runs++;
    slips += payslips.length;
  }
  log(`  Payroll: ${runs} finalised runs for ${YEAR}-${String(MONTH).padStart(2, '0')} with ${slips} payslips, all on unverified draft rules.`);
}
