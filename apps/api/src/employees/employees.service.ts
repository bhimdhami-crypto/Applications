import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto, DeleteEmployeeDto, UpdateEmployeeDto } from './employees.dto';

const PUBLIC_FIELDS = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  department: true,
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

  async list(actor: AuthUser, includeLeavers = false) {
    const where: Prisma.EmployeeWhereInput = { deletedAt: null, ...(includeLeavers ? {} : { status: 'ACTIVE' }) };
    if (actor.role === Role.MANAGER) {
      const me = await this.prisma.employee.findUnique({ where: { userId: actor.id } });
      where.managerId = me?.id ?? '__none__';
    } else if (!SEES_PAY.includes(actor.role)) {
      throw new ForbiddenException('Your role cannot list employees');
    }
    return this.prisma.employee.findMany({
      where,
      select: SEES_PAY.includes(actor.role) ? PAY_FIELDS : PUBLIC_FIELDS,
      orderBy: [{ companyId: 'asc' }, { lastName: 'asc' }],
    });
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
    const count = await this.prisma.employee.count({ where: { company: { countryCode: company.countryCode } } });
    const employeeNo = `MSA-${company.countryCode}-${String(count + 1).padStart(6, '0')}`;

    const employee = await this.prisma.employee.create({
      data: {
        employeeNo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        jobTitle: dto.jobTitle,
        department: dto.department,
        workLocation: dto.workLocation,
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
    const employee = await this.prisma.employee.update({ where: { id }, data: dto, select: PAY_FIELDS });
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
}
