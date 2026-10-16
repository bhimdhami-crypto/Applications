import { AccessMap, EntityLike, RoleAssignmentLike } from '@gpp/shared';

export interface AssignedRole extends RoleAssignmentLike {
  id: string;
}

/** Who is calling, resolved once per request by the access guard */
export interface AuthContext {
  userId: string;
  groupId: string;
  sessionId: string;
  email: string;
  displayName: string;
  roles: AssignedRole[];
  /** Every company in the user's group, for scope resolution */
  entities: EntityLike[];
  access: AccessMap;
  ip?: string;
}
