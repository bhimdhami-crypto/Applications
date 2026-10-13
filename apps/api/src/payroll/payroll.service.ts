import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PayrollStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { toIso, workingDays } from '../leave/calendar';
import { LeaveService } from '../leave/leave.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { rulesFor } from './rules';

const toMinor = (d: Prisma.Decimal | number) => Math.round(Number(d) * 100);
const toMajor = (minor: number) => (minor / 100).toFixed(2);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodName = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const SEES_ALL_PAYSLIPS: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL];

/**
 * Monthly payroll: a run is created as DRAFT (calculated from each country's rules),
 * then APPROVED and FINALIZED by an admin. Employees see payslips once finalized.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly leave: LeaveService,
  ) {}

  listRuns() {
    return this.prisma.payrollRun.findMany({
      include: { company: { select: { name: true, currency: true, countryCode: true } }, _count: { select: { payslips: true } } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
  }

  async getRun(id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        company: true,
        payslips: { include: { employee: { select: { employeeNo: true, firstName: true, lastName: true, jobTitle: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return { ...run, rulesVerified: rulesFor(run.company.countryCode)?.verified ?? false };
  }

  async createRun(actorId: string | null, companyId: string, year: number, month: number) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Unknown company');
    const pack = rulesFor(company.countryCode);
    if (!pack) {
      throw new UnprocessableEntityException(`Payroll rules for ${company.country} are not built yet`);
    }
    const exists = await this.prisma.payrollRun.findUnique({
      where: { companyId_periodYear_periodMonth: { companyId, periodYear: year, periodMonth: month } },
    });
    if (exists) throw new ConflictException(`${company.name} already has a payroll run for ${periodName(year, month)}`);

    const run = await this.prisma.payrollRun.create({
      data: { companyId, periodYear: year, periodMonth: month, rulesPack: pack.countryCode, rulesVersion: pack.version, createdById: actorId },
    });
    await this.calculate(run.id);
    await this.audit.record(actorId, 'payroll.create', 'PayrollRun', run.id, { company: company.code, year, month });
    return this.getRun(run.id);
  }

  async recalculate(actorId: string, id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollStatus.DRAFT) throw new ConflictException('Only a draft run can be recalculated');
    await this.calculate(id);
    await this.audit.record(actorId, 'payroll.recalculate', 'PayrollRun', id);
    return this.getRun(id);
  }

  async approve(actorId: string, id: string) {
    await this.transition(id, PayrollStatus.DRAFT, PayrollStatus.APPROVED, { approvedById: actorId, approvedAt: new Date() });
    await this.audit.record(actorId, 'payroll.approve', 'PayrollRun', id);
    return this.getRun(id);
  }

  /** Locks the run and tells each employee their payslip is ready. */
  async finalize(actorId: string, id: string) {
    await this.transition(id, PayrollStatus.APPROVED, PayrollStatus.FINALIZED, { finalizedById: actorId, finalizedAt: new Date() });
    await this.audit.record(actorId, 'payroll.finalize', 'PayrollRun', id);
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id },
      include: { payslips: { include: { employee: { include: { user: true } } } } },
    });
    for (const slip of run.payslips) {
      const user = slip.employee.user;
      if (!user?.isActive) continue;
      await this.mail.send({
        to: user.email,
        subject: `Your payslip for ${periodName(run.periodYear, run.periodMonth)} is ready`,
        text: `Hello ${slip.employee.firstName},\n\nYour payslip for ${periodName(run.periodYear, run.periodMonth)} is in the HR portal.\nNet pay: ${slip.currency} ${Number(slip.net).toFixed(2)}`,
      });
    }
    return this.getRun(id);
  }

  myPayslips(actor: AuthUser) {
    return this.prisma.payslip.findMany({
      where: { employee: { userId: actor.id }, run: { status: PayrollStatus.FINALIZED } },
      include: { run: { select: { periodYear: true, periodMonth: true, company: { select: { name: true } } } } },
      orderBy: [{ run: { periodYear: 'desc' } }, { run: { periodMonth: 'desc' } }],
    });
  }

  async getPayslip(actor: AuthUser, id: string) {
    const slip = await this.prisma.payslip.findUnique({
      where: { id },
      include: { run: { include: { company: true } }, employee: { select: { userId: true, employeeNo: true, firstName: true, lastName: true, jobTitle: true, department: true } } },
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    const own = slip.employee.userId === actor.id && slip.run.status === PayrollStatus.FINALIZED;
    if (!own && !SEES_ALL_PAYSLIPS.includes(actor.role)) throw new ForbiddenException('You can only see your own payslips');
    return slip;
  }

  /**
   * Month-end job: creates the draft run for every company whose country has rules,
   * then emails the admins to review, approve and finalize it.
   */
  async createMonthEndDrafts(today = new Date()) {
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 1;
    const companies = await this.prisma.company.findMany();
    const created: string[] = [];
    for (const company of companies) {
      if (!rulesFor(company.countryCode)) continue;
      const exists = await this.prisma.payrollRun.findUnique({
        where: { companyId_periodYear_periodMonth: { companyId: company.id, periodYear: year, periodMonth: month } },
      });
      if (exists) continue;
      await this.createRun(null, company.id, year, month);
      created.push(company.name);
    }
    if (created.length) {
      const admins = await this.prisma.user.findMany({ where: { role: Role.ADMIN, isActive: true } });
      for (const admin of admins) {
        await this.mail.send({
          to: admin.email,
          subject: `Payroll for ${periodName(year, month)} is ready to review`,
          text: `Draft payroll runs were created for: ${created.join(', ')}.\nReview, approve and finalize them in the HR portal before payday.`,
        });
      }
      this.logger.log(`Created month-end drafts for ${created.join(', ')}`);
    }
    return created;
  }

  private async transition(id: string, from: PayrollStatus, to: PayrollStatus, data: Prisma.PayrollRunUpdateInput) {
    const { count } = await this.prisma.payrollRun.updateMany({ where: { id, status: from }, data: { ...data, status: to } as Prisma.PayrollRunUpdateManyMutationInput });
    if (count === 0) {
      const run = await this.prisma.payrollRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found');
      throw new ConflictException(`The run is ${run.status.toLowerCase()}, it must be ${from.toLowerCase()} first`);
    }
  }

  /** Recomputes every payslip of a draft run from current salaries. */
  private async calculate(runId: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { company: true } });
    const pack = rulesFor(run.company.countryCode)!;
    const periodStart = new Date(Date.UTC(run.periodYear, run.periodMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: run.companyId,
        hireDate: { lte: periodEnd },
        OR: [{ exitDate: null }, { exitDate: { gte: periodStart } }],
      },
    });

    // Unpaid and reduced-pay leave days, and the annual leave balance printed on each payslip
    const country = run.company.countryCode;
    const [start, end] = [toIso(periodStart), toIso(periodEnd)];
    const holidays = await this.leave.holidaySet(country, start, end);
    const monthWorkingDays = workingDays(start, end, country, new Set(holidays.keys())).length;
    const cuts = await this.leave.payCuts(employees.map((e) => e.id), country, start, end);
    const annualLeft = await this.leave.annualLeftMany(employees.map((e) => ({ ...e, company: { countryCode: country } })), run.periodYear);

    let gross = 0, deductions = 0, net = 0, employerCost = 0;
    const slips = employees.map((e) => {
      const basic = toMinor(e.monthlyBasic);
      const cut = cuts.get(e.id);
      const lostDays = cut ? cut.unpaidDays + cut.halfPayDays / 2 : 0;
      const leaveDeduction = cut && monthWorkingDays > 0
        ? { amount: Math.round((basic * lostDays) / monthWorkingDays), label: leaveLabel(cut, monthWorkingDays) }
        : undefined;
      const r = pack.calculate({ basic, allowances: toMinor(e.monthlyAllowances), leaveDeduction });
      gross += r.gross; deductions += r.deductions; net += r.net; employerCost += r.employerCost;
      return {
        runId,
        employeeId: e.id,
        currency: run.company.currency,
        gross: toMajor(r.gross),
        deductions: toMajor(r.deductions),
        net: toMajor(r.net),
        employerCost: toMajor(r.employerCost),
        lines: r.lines.map((l) => ({ ...l, amount: Number(toMajor(l.amount)) })),
        annualLeaveLeft: annualLeft.get(e.id) ?? null,
      };
    });

    await this.prisma.$transaction([
      this.prisma.payslip.deleteMany({ where: { runId } }),
      this.prisma.payslip.createMany({ data: slips }),
      this.prisma.payrollRun.update({
        where: { id: runId },
        data: { rulesVersion: pack.version, totalGross: toMajor(gross), totalDeductions: toMajor(deductions), totalNet: toMajor(net), totalEmployerCost: toMajor(employerCost) },
      }),
    ]);
  }
}

function leaveLabel(cut: { unpaidDays: number; halfPayDays: number }, monthDays: number) {
  const parts = [];
  if (cut.unpaidDays) parts.push(`${cut.unpaidDays} unpaid day${cut.unpaidDays === 1 ? '' : 's'}`);
  if (cut.halfPayDays) parts.push(`${cut.halfPayDays} half-pay sick day${cut.halfPayDays === 1 ? '' : 's'}`);
  return `Leave: ${parts.join(', ')} of ${monthDays}`;
}
