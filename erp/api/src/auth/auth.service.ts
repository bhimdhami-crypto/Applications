import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Email and password sign-in returning a bearer token. Single sign-on can replace this later. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user?.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      await this.audit.record(user?.id ?? null, 'auth.login_failed', 'User', user?.id, { email });
      throw new UnauthorizedException('Email or password is incorrect');
    }
    await this.audit.record(user.id, 'auth.login', 'User', user.id);
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }
}
