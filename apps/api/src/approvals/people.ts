import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** What loans, vouchers and enrolments need to know about an employee */
export const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeNo: true,
  userId: true,
  managerId: true,
  hireDate: true,
  exitDate: true,
  status: true,
  employmentType: true,
  workLocation: true,
  monthlyBasic: true,
  monthlyAllowances: true,
  companyId: true,
  company: { select: { id: true, name: true, countryCode: true, currency: true } },
  user: { select: { email: true, isActive: true } },
  manager: { select: { id: true, firstName: true, userId: true, user: { select: { email: true, isActive: true } } } },
} satisfies Prisma.EmployeeSelect;
export type Person = Prisma.EmployeeGetPayload<{ select: typeof PERSON_SELECT }>;

export const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
export const toMinor = (d: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(d ?? 0) * 100);
export const toMajor = (minor: number) => (minor / 100).toFixed(2);

export async function findPerson(prisma: PrismaService, id: string): Promise<Person> {
  const p = await prisma.employee.findFirst({ where: { id, deletedAt: null }, select: PERSON_SELECT });
  if (!p) throw new NotFoundException('Employee not found');
  return p;
}

export async function ownPerson(prisma: PrismaService, actor: AuthUser): Promise<Person> {
  const p = await prisma.employee.findFirst({ where: { userId: actor.id, deletedAt: null }, select: PERSON_SELECT });
  if (!p) throw new ForbiddenException('Your login is not linked to an employee record');
  return p;
}

/** The signed-in person's employee id and the name shown on their decisions */
export async function actorInfo(prisma: PrismaService, actor: AuthUser) {
  const me = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true, firstName: true, lastName: true } });
  return { employeeId: me?.id ?? null, name: me ? fullName(me) : actor.email };
}
