import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from '@gpp/shared';
import { AuthContext } from './auth-context';

export const IS_PUBLIC = 'isPublic';
/** Skips sign-in for this route */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** The caller needs at least one of these permissions somewhere in their scope */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** The signed-in caller */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => ctx.switchToHttp().getRequest().auth);
