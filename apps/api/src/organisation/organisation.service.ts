import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators';
import { rulesFor } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';

/** What anyone in the company may see about a colleague on the organisation chart: no pay, IDs or contact details. */
const NODE = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  department: true,
  grade: true,
  workLocation: true,
  photoKey: true,
  companyId: true,
  company: { select: { code: true, countryCode: true, name: true } },
  _count: { select: { reports: { where: { status: 'ACTIVE', deletedAt: null } } } },
} satisfies Prisma.EmployeeSelect;

type NodeRow = Prisma.EmployeeGetPayload<{ select: typeof NODE }>;
const toNode = ({ photoKey, _count, ...e }: NodeRow) => ({ ...e, hasPhoto: !!photoKey, reportCount: _count.reports });

const SEES_ALL: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL];

@Injectable()
export class OrganisationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Legal entities with headcount and payroll rules. Counts only, so every role may see it. */
  async entities() {
    const [companies, counts, depts] = await Promise.all([
      this.prisma.company.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.employee.groupBy({ by: ['companyId'], where: { status: 'ACTIVE', deletedAt: null }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['companyId', 'department'], where: { status: 'ACTIVE', deletedAt: null } }),
    ]);
    return companies.map((c) => {
      const pack = rulesFor(c.countryCode);
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        country: c.country,
        countryCode: c.countryCode,
        currency: c.currency,
        headcount: counts.find((x) => x.companyId === c.id)?._count._all ?? 0,
        departments: depts.filter((d) => d.companyId === c.id).length,
        payrollRules: pack ? { version: pack.version, verified: pack.verified } : null,
      };
    });
  }

  /** Departments of a company with headcount and the department head (most senior person with no manager). */
  async departments(actor: AuthUser, companyId?: string) {
    const scopeCompany = await this.scope(actor, companyId);
    const where: Prisma.EmployeeWhereInput = { status: 'ACTIVE', deletedAt: null, ...(scopeCompany ? { companyId: scopeCompany } : {}) };
    const [counts, heads] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['department'], where, _count: { _all: true } }),
      this.prisma.employee.findMany({
        where: { ...where, managerId: null, reports: { some: { status: 'ACTIVE', deletedAt: null } } },
        select: NODE,
        orderBy: [{ grade: 'desc' }, { hireDate: 'asc' }],
      }),
    ]);
    return counts
      .map((c) => ({
        department: c.department,
        headcount: c._count._all,
        heads: heads.filter((h) => h.department === c.department).map(toNode),
      }))
      .sort((a, b) => b.headcount - a.headcount);
  }

  /**
   * One level of the chart: the person, the managers above them and their direct reports.
   * Anyone may browse their own company; HR, payroll and admins may browse every company.
   */
  async chart(actor: AuthUser, employeeId?: string) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true, companyId: true } });
    const id = employeeId || me?.id;
    if (!id) return { chain: [], root: null, reports: [] };
    const root = await this.prisma.employee.findFirst({ where: { id, deletedAt: null }, select: { ...NODE, managerId: true } });
    if (!root) throw new NotFoundException('Employee not found');
    if (!SEES_ALL.includes(actor.role) && root.companyId !== me?.companyId) {
      throw new ForbiddenException('You can only see the organisation chart of your own company');
    }
    const chain: ReturnType<typeof toNode>[] = [];
    let next = root.managerId;
    const seen = new Set([root.id]);
    while (next && !seen.has(next) && chain.length < 12) {
      seen.add(next);
      const m = await this.prisma.employee.findUnique({ where: { id: next }, select: { ...NODE, managerId: true } });
      if (!m) break;
      const { managerId, ...rest } = m;
      chain.unshift(toNode(rest));
      next = managerId;
    }
    const reports = await this.prisma.employee.findMany({
      where: { managerId: root.id, status: 'ACTIVE', deletedAt: null },
      select: NODE,
      orderBy: [{ grade: 'desc' }, { lastName: 'asc' }],
      take: 200,
    });
    const { managerId: _m, ...rootNode } = root;
    return { chain, root: toNode(rootNode), reports: reports.map(toNode) };
  }

  /** Which company a request may look at: their own unless HR, payroll or admin. */
  private async scope(actor: AuthUser, companyId?: string) {
    if (SEES_ALL.includes(actor.role)) return companyId;
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { companyId: true } });
    if (!me) throw new ForbiddenException('No employee record');
    if (companyId && companyId !== me.companyId) throw new ForbiddenException('You can only see your own company');
    return me.companyId;
  }
}
