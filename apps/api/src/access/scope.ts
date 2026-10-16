import { NotFoundException } from '@nestjs/common';
import { can, Permission } from '@gpp/shared';
import { AuthContext } from './auth-context';

/**
 * Prisma filter on `legalEntityId` for the companies where the caller holds `permission`.
 * Undefined means group-wide (the caller's group is filtered separately).
 */
export function entityFilter(auth: AuthContext, permission: Permission): { in: string[] } | undefined {
  const scope = auth.access.get(permission);
  if (!scope) return { in: [] };
  if (scope.group) return undefined;
  return { in: [...scope.entityIds] };
}

/** Ids of the companies where the caller holds `permission` */
export function entityIds(auth: AuthContext, permission: Permission): string[] {
  const scope = auth.access.get(permission);
  if (!scope) return [];
  return scope.group ? auth.entities.map((e) => e.id) : [...scope.entityIds];
}

/**
 * Throws Not found when the company is outside the caller's scope for `permission`.
 * Not found rather than Forbidden, so other companies' records are not revealed.
 */
export function assertEntity(auth: AuthContext, permission: Permission, legalEntityId: string, what = 'Record') {
  if (!auth.entities.some((e) => e.id === legalEntityId) || !can(auth.access, permission, legalEntityId)) {
    throw new NotFoundException(`${what} not found`);
  }
}
