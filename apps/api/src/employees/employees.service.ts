import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto, DeleteEmployeeDto, ListEmployeesQuery, UpdateEmployeeDto } from './employees.dto';

const PUBLIC_FIELDS = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  department: true,
  grade: true,
  city: true,
  workEmail: true,
  workLocation: true,
  hireDate: true,
  exitDate: true,
  status: true,
  companyId: true,
  managerId: true,
  company: { select: { name: true, countryCode: true, currency: true } },
  user: { select: { email: true, role: true, isActive: true } },
} satisfies Prisma.EmployeeSelect;

const PAY_FIELDS = { ...PUBLIC_FIELDS, monthlyBasic: true, monthlyAllowances: true } satisfies Prisma.EmployeeSelect;
const SEES_PAY: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL];

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** One page of employees, newest search first. Managers only see their own team. */
  async list(actor: AuthUser, query: ListEmployeesQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.EmployeeWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    else if (query.includeLeavers !== 'true') where.status = 'ACTIVE';
    if (query.companyId) where.companyId = query.companyId;
    if (query.role) where.user = { role: query.role };
    if (query.q) {
      const terms = query.q.trim().split(/\s+/).slice(0, 4);
      where.AND = terms.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
          { employeeNo: { contains: t, mode: 'insensitive' } },
          { workEmail: { contains: t, mode: 'insensitive' } },
          { jobTitle: { contains: t, mode: 'insensitive' } },
          { department: { contains: t, mode: 'insensitive' } },
        ],
      }));
    }
    if (actor.role === Role.MANAGER) {
      const me = await this.prisma.employee.findUnique({ where: { userId: actor.id } });
      where.managerId = me?.id ?? '__none__';
    } else if (!SEES_PAY.includes(actor.role)) {
      throw new ForbiddenException('Your role cannot list employees');
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        select: { ...(SEES_PAY.includes(actor.role) ? PAY_FIELDS : PUBLIC_FIELDS), photoKey: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { employeeNo: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    // The storage key stays server side; the list only says whether a photo exists
    return { items: items.map(({ photoKey, ...e }) => ({ ...e, hasPhoto: !!photoKey })), total, page, pageSize };
  }

  async me(actor: AuthUser) {
    return this.prisma.employee.findUnique({ where: { userId: actor.id }, select: PAY_FIELDS });
  }

  async create(actor: AuthUser, dto: CreateEmployeeDto) {
    const role = dto.role ?? Role.EMPLOYEE;
    if (actor.role !== Role.ADMIN && !([Role.EMPLOYEE, Role.MANAGER] as Role[]).includes(role)) {
      throw new ForbiddenException('Only an admin can give this role');
    }
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company) throw new BadRequestException('Unknown company');
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('This email already has an account');

    const tempPassword = `Ms-${randomBytes(6).toString('base64url')}`;
    const employeeNo = await this.nextEmployeeNo(company.countryCode);

    const employee = await this.prisma.employee.create({
      data: {
        employeeNo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        jobTitle: dto.jobTitle,
        department: dto.department,
        workLocation: dto.workLocation,
        employmentType: dto.employmentType,
        grade: dto.grade,
        city: dto.city,
        mobilePhone: dto.mobilePhone,
        workEmail: email,
        hireDate: new Date(dto.hireDate),
        monthlyBasic: dto.monthlyBasic,
        monthlyAllowances: dto.monthlyAllowances ?? 0,
        company: { connect: { id: company.id } },
        manager: dto.managerId ? { connect: { id: dto.managerId } } : undefined,
        user: { create: { email, role, passwordHash: await bcrypt.hash(tempPassword, 10) } },
      },
      select: PAY_FIELDS,
    });
    await this.mail.send({
      to: email,
      subject: 'Welcome to the Mindspace HR portal',
      text: `Hello ${dto.firstName},\n\nYour portal account is ready.\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou will also get a sign-in code by email each time you sign in.`,
    });
    await this.audit.record(actor.id, 'employee.create', 'Employee', employee.id, { employeeNo, role });
    return employee;
  }

  async update(actor: AuthUser, id: string, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Employee not found');
    const { dateOfBirth, ...rest } = dto;
    const data: Prisma.EmployeeUncheckedUpdateInput = { ...rest, ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}) };
    const employee = await this.prisma.employee.update({ where: { id }, data, select: PAY_FIELDS });
    await this.audit.record(actor.id, 'employee.update', 'Employee', id, { ...dto } as Prisma.InputJsonValue);
    return employee;
  }

  /**
   * Deletes an employee from the active workforce. The record, payslips and
   * documents are kept (soft delete) because tax law requires them for years,
   * and the login is switched off at once.
   */
  async remove(actor: AuthUser, id: string, dto: DeleteEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.userId === actor.id) throw new BadRequestException('You cannot delete your own record');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: 'TERMINATED', exitDate: dto.exitDate ? new Date(dto.exitDate) : now, deletedAt: now },
      }),
      ...(existing.userId ? [this.prisma.user.update({ where: { id: existing.userId }, data: { isActive: false } })] : []),
    ]);
    await this.audit.record(actor.id, 'employee.delete', 'Employee', id, { reason: dto.reason ?? null });
    return { id, deleted: true };
  }

  /** Next free number in the MSA-<country>-000123 series (test accounts use MSA-KE-T00001 and are skipped). */
  private async nextEmployeeNo(countryCode: string) {
    const prefix = `MSA-${countryCode}-`;
    const rows = await this.prisma.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("employeeNo" FROM 8) AS INTEGER)) AS max
      FROM "Employee" WHERE "employeeNo" ~ ${'^' + prefix + '[0-9]{6}$'}`;
    return `${prefix}${String((rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
  }
}
