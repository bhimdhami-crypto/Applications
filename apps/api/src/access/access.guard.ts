import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, Permission } from '@gpp/shared';
import { AccessService } from './access.service';
import { IS_PUBLIC, PERMISSIONS_KEY } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/** Signs in every request (unless @Public) and checks @RequirePermission */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Sign in first');
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Your sign-in has expired');
    }
    const auth = await this.access.load(payload.sub, payload.sid, req.ip);
    if (!auth) throw new UnauthorizedException('Your session has ended. Sign in again.');
    req.auth = auth;

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (needed?.length && !needed.some((p) => can(auth.access, p))) {
      throw new ForbiddenException('You do not have access to this');
    }
    return true;
  }
}
