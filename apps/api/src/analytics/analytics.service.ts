import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

const TENURE_BANDS: [string, number, number][] = [
  ['Under 1 year', 0, 1],
  ['1–2 years', 1, 3],
  ['3–5 years', 3, 6],
  ['6–9 years', 6, 10],
  ['10+ years', 10, Infinity],
];
const AGE_BANDS: [string, number, number][] = [
  ['Under 25', 0, 25],
  ['25–34', 25, 35],
  ['35–44', 35, 45],
  ['45–54', 45, 55],
  ['55+', 55, Infinity],
];

function band(bands: [string, number, number][], years: number) {
  return bands.find(([, lo, hi]) => years >= lo && years < hi)?.[0] ?? bands[bands.length - 1][0];
}

function countBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || 'Not recorded';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/** Aggregate workforce figures. Only counts and sums leave this service, never names or pay of individuals. */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async workforce(companyId?: string) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yearAgo = new Date(today.getTime() - YEAR);
    const scope: Prisma.EmployeeWhereInput = { deletedAt: null, ...(companyId ? { companyId } : {}) };

    const [companies, active, hires, exits, onLeave, pendingDocs, expiredDocs, runs, openings] = await Promise.all([
      this.prisma.company.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.employee.findMany({
        where: { ...scope, status: 'ACTIVE' },
        select: { companyId: true, department: true, workLocation: true, employmentType: true, gender: true, hireDate: true, dateOfBirth: true, grade: true, managerId: true },
      }),
      this.prisma.employee.findMany({ where: { ...scope, hireDate: { gte: yearAgo } }, select: { hireDate: true, companyId: true } }),
      this.prisma.employee.findMany({ where: { ...scope, status: 'TERMINATED', exitDate: { gte: yearAgo } }, select: { exitDate: true, companyId: true, exitReason: true } }),
      this.prisma.leaveRequest.count({
        where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today }, employee: scope },
      }),
      this.prisma.employeeDocument.count({ where: { status: 'PENDING', employee: { ...scope, status: 'ACTIVE' } } }),
      this.prisma.employeeDocument.count({
        where: { employee: { ...scope, status: 'ACTIVE' }, OR: [{ status: 'EXPIRED' }, { expiryDate: { lt: today }, status: { in: ['VERIFIED', 'CLEARED'] } }] },
      }),
      this.prisma.payrollRun.findMany({
        where: companyId ? { companyId } : {},
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        select: {
          id: true, companyId: true, periodYear: true, periodMonth: true, status: true, totalGross: true, totalNet: true, totalEmployerCost: true,
          _count: { select: { payslips: true } },
        },
      }),
      this.prisma.jobOpening.findMany({
        where: { status: 'OPEN', ...(companyId ? { companyId } : {}) },
        select: { positions: true, _count: { select: { candidates: { where: { stage: 'HIRED' } } } } },
      }),
    ]);

    const headcount = active.length;
    // Attrition: leavers in the last 12 months over the average of headcount now and a year ago
    const headcountYearAgo = headcount - hires.length + exits.length;
    const avgHeadcount = (headcount + Math.max(headcountYearAgo, 0)) / 2 || 1;
    const tenureYears = active.map((e) => (today.getTime() - e.hireDate.getTime()) / YEAR);
    const ages = active.filter((e) => e.dateOfBirth).map((e) => (today.getTime() - e.dateOfBirth!.getTime()) / YEAR);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

    // Hires and leavers per month for the last 12 months, oldest first
    const months: { key: string; label: string; hires: number; exits: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      months.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), hires: 0, exits: 0 });
    }
    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const byKey = new Map(months.map((m) => [m.key, m]));
    for (const h of hires) {
      const m = byKey.get(monthKey(h.hireDate));
      if (m) m.hires += 1;
    }
    for (const x of exits) {
      const m = x.exitDate ? byKey.get(monthKey(x.exitDate)) : undefined;
      if (m) m.exits += 1;
    }

    const latestRun = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latestRun.has(r.companyId)) latestRun.set(r.companyId, r);
    const lastFinal = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (r.status === 'FINALIZED' && !lastFinal.has(r.companyId)) lastFinal.set(r.companyId, r);

    const byCompany = companies
      .filter((c) => !companyId || c.id === companyId)
      .map((c) => {
        const run = latestRun.get(c.id);
        const fin = lastFinal.get(c.id);
        return {
          companyId: c.id,
          code: c.code,
          name: c.name,
          country: c.country,
          countryCode: c.countryCode,
          currency: c.currency,
          headcount: active.filter((e) => e.companyId === c.id).length,
          hires12m: hires.filter((h) => h.companyId === c.id).length,
          exits12m: exits.filter((x) => x.companyId === c.id).length,
          latestRun: run ? { id: run.id, periodYear: run.periodYear, periodMonth: run.periodMonth, status: run.status, totalNet: run.totalNet.toString(), payslips: run._count.payslips } : null,
          lastPayroll: fin
            ? { periodYear: fin.periodYear, periodMonth: fin.periodMonth, totalGross: fin.totalGross.toString(), totalNet: fin.totalNet.toString(), employerCost: fin.totalEmployerCost.toString(), payslips: fin._count.payslips }
            : null,
        };
      });

    return {
      asOf: today.toISOString().slice(0, 10),
      totals: {
        headcount,
        hires12m: hires.length,
        exits12m: exits.length,
        attritionRate: Math.round((exits.length / avgHeadcount) * 1000) / 10,
        avgTenureYears: Math.round(avg(tenureYears) * 10) / 10,
        avgAge: Math.round(avg(ages) * 10) / 10,
        remoteShare: headcount ? Math.round((active.filter((e) => e.workLocation === 'FULLY_REMOTE').length / headcount) * 1000) / 10 : 0,
        managers: new Set(active.map((e) => e.managerId).filter(Boolean)).size,
        onLeaveToday: onLeave,
        documentsToVerify: pendingDocs,
        documentsExpired: expiredDocs,
        openPositions: openings.reduce((s, o) => s + Math.max(o.positions - o._count.candidates, 0), 0),
      },
      byCompany,
      byDepartment: countBy(active, (e) => e.department),
      byLocation: countBy(active, (e) => ({ ON_SITE: 'On site', HYBRID: 'Hybrid', FULLY_REMOTE: 'Fully remote' })[e.workLocation]),
      byContract: countBy(active, (e) => ({ PERMANENT: 'Permanent', FIXED_TERM: 'Fixed-term', INTERN: 'Intern' })[e.employmentType]),
      byGender: countBy(active, (e) => e.gender),
      byGrade: countBy(active, (e) => e.grade).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })),
      tenure: TENURE_BANDS.map(([label]) => ({ label, value: tenureYears.filter((y) => band(TENURE_BANDS, y) === label).length })),
      age: AGE_BANDS.map(([label]) => ({ label, value: ages.filter((y) => band(AGE_BANDS, y) === label).length })),
      exitReasons: countBy(exits, (x) => x.exitReason?.split(' - ')[0]).slice(0, 6),
      monthly: months.map(({ label, hires: h, exits: x }) => ({ label, hires: h, exits: x })),
    };
  }
}
