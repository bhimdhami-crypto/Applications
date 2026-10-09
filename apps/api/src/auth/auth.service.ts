import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CaptchaService } from './captcha.service';

const MAX_CHALLENGES_PER_15_MIN = 5;

/**
 * Two-step sign-in: password plus CAPTCHA, then a 6-digit code sent by email.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly captcha: CaptchaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, captchaToken?: string, ip?: string) {
    if (!(await this.captcha.verify(captchaToken, ip))) {
      throw new BadRequestException('CAPTCHA check failed, please try again');
    }
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user?.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      await this.audit.record(user?.id ?? null, 'auth.login_failed', 'User', user?.id, { email });
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const since = new Date(Date.now() - 15 * 60_000);
    const recent = await this.prisma.loginChallenge.count({ where: { userId: user.id, createdAt: { gte: since } } });
    if (recent >= MAX_CHALLENGES_PER_15_MIN) {
      throw new HttpException('Too many sign-in attempts, wait 15 minutes', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttl = Number(this.config.get('OTP_TTL_MINUTES', 5));
    const challenge = await this.prisma.loginChallenge.create({
      data: { userId: user.id, codeHash: 'pending', expiresAt: new Date(Date.now() + ttl * 60_000) },
    });
    await this.prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { codeHash: this.hashCode(challenge.id, code) },
    });
    await this.mail.send({
      to: user.email,
      subject: 'Your Mindspace sign-in code',
      text: `Your sign-in code is ${code}. It expires in ${ttl} minutes.\n\nIf you did not try to sign in, tell IT Security at once.`,
    });
    return { challengeId: challenge.id, message: `We sent a 6-digit code to ${user.email}` };
  }

  async verify(challengeId: string, code: string) {
    const challenge = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS', 5));
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || challenge.attempts >= maxAttempts) {
      throw new UnauthorizedException('This code has expired, sign in again');
    }
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const given = Buffer.from(this.hashCode(challenge.id, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.prisma.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('The code is incorrect');
    }

    const user = challenge.user;
    await this.prisma.$transaction([
      this.prisma.loginChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    await this.audit.record(user.id, 'auth.login', 'User', user.id);
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return { accessToken, user: { id: user.id, email: user.email, role: user.role } };
  }

  private hashCode(challengeId: string, code: string) {
    return createHash('sha256').update(`${challengeId}:${code}:${this.config.getOrThrow('JWT_SECRET')}`).digest('hex');
  }
}
