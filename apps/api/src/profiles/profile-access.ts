import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators';

/**
 * How much of one employee's record the signed-in user may see:
 * - FULL: admin, HR and payroll see everything, including IDs, pay and HR-only documents
 * - SELF: the employee sees their own record and documents, except HR-only ones
 * - MANAGER: a manager sees their direct reports' work details and photo only
 */
export type ProfileAccess = 'FULL' | 'SELF' | 'MANAGER';

const FULL_ROLES: Role[] = [Role.ADMIN, Role.HR, Role.PAYROLL];
const EDIT_ROLES: Role[] = [Role.ADMIN, Role.HR];

export function profileAccess(
  actor: AuthUser,
  employee: { userId: string | null; managerId: string | null },
  actorEmployeeId: string | null,
): ProfileAccess {
  if (FULL_ROLES.includes(actor.role)) return 'FULL';
  if (employee.userId === actor.id) return 'SELF';
  if (actor.role === Role.MANAGER && actorEmployeeId && employee.managerId === actorEmployeeId) return 'MANAGER';
  throw new ForbiddenException('You cannot see this employee');
}

/** HR and admins edit anyone; employees edit their own contact details, next of kin, photo and uploads. */
export function canEditPersonal(actor: AuthUser, access: ProfileAccess) {
  return access === 'SELF' || EDIT_ROLES.includes(actor.role);
}

export function isHrEditor(actor: AuthUser) {
  return EDIT_ROLES.includes(actor.role);
}
