import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, IS_PUBLIC, ROLES_KEY } from './decorators';

/** Checks the bearer token on every route except @Public ones, then applies @Roles. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Sign in first');

    let payload: { sub: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired, sign in again');
    }
    // Re-read the account so deactivated users and role changes take effect at once
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account is not active');
    req.user = { id: user.id, email: user.email, role: user.role as Role } satisfies AuthUser;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length && user.role !== 'ADMIN' && !roles.includes(user.role as Role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    return true;
  }
}
