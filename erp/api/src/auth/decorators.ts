import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Role } from '../common/constants';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Route needs no sign-in */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these roles. ADMIN always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
