/**
 * Roles, permissions and how a user's role assignments resolve to the companies they may touch.
 * The API enforces this on every request; the web and mobile apps use it only to hide what
 * the user cannot use.
 */

export const ROLES = [
  'GROUP_ADMIN',
  'HR_ADMIN',
  'HR',
  'PAYROLL_OPERATOR',
  'PAYROLL_APPROVER',
  'FINANCE',
  'TREASURY',
  'AUDITOR',
  'EXECUTIVE',
  'MANAGER',
  'EMPLOYEE',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  GROUP_ADMIN: 'Group administrator',
  HR_ADMIN: 'HR administrator',
  HR: 'HR officer',
  PAYROLL_OPERATOR: 'Payroll operator (maker)',
  PAYROLL_APPROVER: 'Payroll approver (checker)',
  FINANCE: 'Finance',
  TREASURY: 'Treasury and payments',
  AUDITOR: 'Auditor (read only)',
  EXECUTIVE: 'Executive (dashboards)',
  MANAGER: 'Line manager',
  EMPLOYEE: 'Employee',
};

export const PERMISSIONS = [
  'org.read',
  /** Create and edit legal entities. Group scope only. */
  'org.entities.manage',
  /** Business units, branches, departments and cost centres inside a company */
  'org.structure.manage',
  /** Countries, currencies and languages. Group scope only. */
  'geo.manage',
  'features.manage',
  'users.read',
  'users.manage',
  'audit.read',
  'people.read',
  'people.manage',
  /** Bank details, tax and social security identifiers */
  'people.sensitive.read',
  /** Disciplinary, grievance and medical records */
  'people.relations.read',
  'payroll.read',
  'payroll.prepare',
  'payroll.approve',
  'payments.release',
  'finance.read',
  'finance.manage',
  'reports.read',
  /** Approval steps that need a country head, such as a housing loan above the usual limit */
  'requests.executive',
  'team.read',
  'self.service',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that only make sense across the whole group */
export const GROUP_ONLY_PERMISSIONS: readonly Permission[] = ['org.entities.manage', 'geo.manage'];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Group admins configure everything but cannot approve payroll or release payments: those
  // need the checker and treasury roles, so one person cannot push a payroll through alone.
  GROUP_ADMIN: ALL.filter((p) => p !== 'payroll.approve' && p !== 'payments.release' && p !== 'people.relations.read'),
  HR_ADMIN: ['org.read', 'org.structure.manage', 'features.manage', 'users.read', 'users.manage', 'audit.read', 'people.read', 'people.manage', 'people.sensitive.read', 'people.relations.read', 'reports.read', 'self.service'],
  HR: ['org.read', 'users.read', 'people.read', 'people.manage', 'reports.read', 'self.service'],
  PAYROLL_OPERATOR: ['org.read', 'people.read', 'people.sensitive.read', 'payroll.read', 'payroll.prepare', 'reports.read', 'self.service'],
  PAYROLL_APPROVER: ['org.read', 'people.read', 'payroll.read', 'payroll.approve', 'reports.read', 'self.service'],
  FINANCE: ['org.read', 'payroll.read', 'finance.read', 'finance.manage', 'reports.read', 'self.service'],
  TREASURY: ['org.read', 'payroll.read', 'finance.read', 'payments.release', 'self.service'],
  AUDITOR: ['org.read', 'users.read', 'audit.read', 'people.read', 'payroll.read', 'finance.read', 'reports.read', 'self.service'],
  EXECUTIVE: ['org.read', 'reports.read', 'requests.executive', 'self.service'],
  MANAGER: ['org.read', 'team.read', 'self.service'],
  EMPLOYEE: ['self.service'],
};

/** Roles a non-group administrator with `users.manage` may hand out inside their own scope */
export const DELEGABLE_ROLES: readonly Role[] = ['HR', 'MANAGER', 'EMPLOYEE', 'EXECUTIVE'];

/** Pairs one person may not hold over the same company (segregation of duties) */
export const CONFLICTING_ROLES: readonly [Role, Role][] = [
  ['PAYROLL_OPERATOR', 'PAYROLL_APPROVER'],
  ['PAYROLL_OPERATOR', 'TREASURY'],
  ['PAYROLL_APPROVER', 'TREASURY'],
];

export type ScopeType = 'GROUP' | 'COUNTRY' | 'LEGAL_ENTITY';

export interface RoleAssignmentLike {
  role: Role;
  scopeType: ScopeType;
  countryCode?: string | null;
  legalEntityId?: string | null;
}

export interface EntityLike {
  id: string;
  countryCode: string;
}

export interface PermissionScope {
  /** Held with group scope: covers every company, including ones created later */
  group: boolean;
  entityIds: Set<string>;
}

export type AccessMap = Map<Permission, PermissionScope>;

/** The companies an assignment covers */
export function entitiesInScope(a: Pick<RoleAssignmentLike, 'scopeType' | 'countryCode' | 'legalEntityId'>, entities: readonly EntityLike[]): string[] {
  switch (a.scopeType) {
    case 'GROUP':
      return entities.map((e) => e.id);
    case 'COUNTRY':
      return entities.filter((e) => e.countryCode === a.countryCode).map((e) => e.id);
    case 'LEGAL_ENTITY':
      return entities.filter((e) => e.id === a.legalEntityId).map((e) => e.id);
  }
}

/** Resolves role assignments into, for each permission, the companies it applies to */
export function resolveAccess(assignments: readonly RoleAssignmentLike[], entities: readonly EntityLike[]): AccessMap {
  const map: AccessMap = new Map();
  for (const a of assignments) {
    const ids = entitiesInScope(a, entities);
    for (const p of ROLE_PERMISSIONS[a.role] ?? []) {
      if (GROUP_ONLY_PERMISSIONS.includes(p) && a.scopeType !== 'GROUP') continue;
      const s = map.get(p) ?? { group: false, entityIds: new Set<string>() };
      if (a.scopeType === 'GROUP') s.group = true;
      ids.forEach((id) => s.entityIds.add(id));
      map.set(p, s);
    }
  }
  return map;
}

export function can(access: AccessMap, permission: Permission, entityId?: string): boolean {
  const s = access.get(permission);
  if (!s) return false;
  if (entityId === undefined) return true;
  return s.group || s.entityIds.has(entityId);
}

/** Why a role grant is not allowed, or null when it is */
export function grantProblem(
  granter: { access: AccessMap; roles: readonly RoleAssignmentLike[]; userId: string },
  target: { userId: string; existing: readonly RoleAssignmentLike[] },
  grant: RoleAssignmentLike,
  entities: readonly EntityLike[],
): string | null {
  if (granter.userId === target.userId) return 'You cannot change your own roles';
  const manage = granter.access.get('users.manage');
  if (!manage) return 'You cannot manage users';
  const isGroupAdmin = granter.roles.some((r) => r.role === 'GROUP_ADMIN' && r.scopeType === 'GROUP');
  if (!isGroupAdmin && !DELEGABLE_ROLES.includes(grant.role)) return `Only a group administrator can give the ${ROLE_LABELS[grant.role]} role`;
  if (grant.scopeType === 'GROUP' && !manage.group) return 'Only group-wide administrators can give group-wide roles';
  const covered = entitiesInScope(grant, entities);
  if (grant.scopeType !== 'GROUP' && covered.length === 0) return 'That country or company does not exist';
  if (!manage.group && covered.some((id) => !manage.entityIds.has(id))) return 'That scope is outside the companies you manage';
  for (const [a, b] of CONFLICTING_ROLES) {
    const other = grant.role === a ? b : grant.role === b ? a : null;
    if (!other) continue;
    const clash = target.existing.find((r) => r.role === other && entitiesInScope(r, entities).some((id) => covered.includes(id)));
    if (clash) return `${ROLE_LABELS[grant.role]} and ${ROLE_LABELS[other]} cannot be held by one person for the same company`;
  }
  return null;
}
