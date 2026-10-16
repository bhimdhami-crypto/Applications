import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../access/auth-context';
import { inForce } from '../people/people-access.service';
import { PrismaService } from '../prisma/prisma.service';

/** What loans, vouchers and enrolments need to know about an employee */
export const MONEY_PERSON = {
  id: true,
  employeeNumber: true,
  userId: true,
  hireDate: true,
  endDate: true,
  status: true,
  employmentType: true,
  workLocation: true,
  legalEntityId: true,
  person: { select: { firstName: true, lastName: true, dateOfBirth: true } },
  legalEntity: { select: { id: true, code: true, name: true, countryCode: true, functionalCurrency: true, groupId: true } },
  user: { select: { email: true, isActive: true } },
} satisfies Prisma.EmploymentSelect;
export type MoneyPerson = Prisma.EmploymentGetPayload<{ select: typeof MONEY_PERSON }>;

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
/** Amounts are worked in hundredths of the currency unit, as the payroll rule packs do */
export const toMinor = (d: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(d ?? 0) * 100);
export const toMajor = (minor: number) => (minor / 100).toFixed(2);

export async function findPerson(prisma: PrismaService, auth: AuthContext, id: string): Promise<MoneyPerson> {
  const p = await prisma.employment.findFirst({ where: { id, legalEntity: { groupId: auth.groupId } }, select: MONEY_PERSON });
  if (!p) throw new NotFoundException('Employee not found');
  return p;
}

export async function ownPerson(prisma: PrismaService, auth: AuthContext): Promise<MoneyPerson> {
  const p = await prisma.employment.findFirst({ where: { userId: auth.userId, legalEntity: { groupId: auth.groupId } }, select: MONEY_PERSON });
  if (!p) throw new ForbiddenException('Your sign-in is not linked to an employee record');
  return p;
}

/** Monthly pay in force today, in minor units (null when there is no pay record) */
export async function currentPay(prisma: PrismaService, employmentId: string) {
  const c = await prisma.compensation.findFirst({ where: { employmentId, ...inForce() }, select: { baseAmount: true, allowances: true, currency: true } });
  return c ? { basic: toMinor(c.baseAmount), allowances: toMinor(c.allowances), currency: c.currency } : null;
}

/** The line manager in force today, when they have an active portal account to approve with */
export async function lineManager(prisma: PrismaService, employmentId: string, employeeUserId: string | null) {
  const a = await prisma.assignment.findFirst({
    where: { employmentId, ...inForce() },
    select: { manager: { select: { id: true, status: true, userId: true, person: { select: { firstName: true } }, user: { select: { email: true, isActive: true } } } } },
  });
  const m = a?.manager;
  if (!m || m.status !== 'ACTIVE' || !m.user?.isActive || !m.userId || m.userId === employeeUserId) return null;
  return { id: m.id, firstName: m.person.firstName, email: m.user.email };
}
