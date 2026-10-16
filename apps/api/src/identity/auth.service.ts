import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashCode, hashToken, newCode, newToken, sameHash } from './tokens';

const CODE_TTL_MS = 5 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const ACCESS_TTL_S = 15 * 60;
const SESSION_TTL_MS = { web: 12 * 3600_000, mobile: 30 * 24 * 3600_000 };

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

/** A bcrypt hash of a random string, compared against when the email is unknown so timing stays the same */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get demoCodes() {
    return this.config.get('DEMO_SHOW_CODES') === 'true' && process.env.NODE_ENV !== 'production';
  }

  private get secret() {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  /** Step 1: password. Emails a one-time code and returns the challenge to answer. */
  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const wrong = new UnauthorizedException('Email or password is wrong');
    if (!user || !user.passwordHash || !user.isActive) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw wrong;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Too many failed attempts. Try again in 15 minutes or ask HR to unlock your account.');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= LOCK_AFTER_FAILURES;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : undefined },
      });
      await this.audit.record({ userId: user.id, groupId: user.groupId, ip: meta.ip }, { action: lock ? 'auth.locked' : 'auth.password_failed', targetType: 'user', targetId: user.id });
      throw wrong;
    }
    const code = newCode();
    const challenge = await this.prisma.loginChallenge.create({
      data: { userId: user.id, codeHash: hashCode(code, this.secret), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    await this.mail.send({
      to: user.email,
      subject: `Your sign-in code: ${code}`,
      text: `Hello ${user.displayName},\n\nYour sign-in code is ${code}. It expires in 5 minutes.\n\nIf you did not try to sign in, change your password and tell IT security.`,
    });
    return {
      challengeId: challenge.id,
      expiresInSeconds: CODE_TTL_MS / 1000,
      sentTo: maskEmail(user.email),
      // Demo installations can show the code on screen instead of in an inbox. Never in production.
      ...(this.demoCodes ? { demoCode: code } : {}),
    };
  }

  /** Step 2: the emailed code. Opens a session. */
  async verify(challengeId: string, code: string, client: 'web' | 'mobile', meta: ClientMeta): Promise<IssuedTokens> {
    const invalid = new UnauthorizedException('That code is wrong or has expired. Sign in again for a new one.');
    const challenge = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || challenge.attempts >= CODE_MAX_ATTEMPTS || !challenge.user.isActive) throw invalid;
    if (!sameHash(challenge.codeHash, hashCode(code, this.secret))) {
      await this.prisma.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }
    // Consume atomically so the same code cannot open two sessions
    const consumed = await this.prisma.loginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw invalid;

    const user = challenge.user;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const session = await this.prisma.session.create({
      data: { userId: user.id, client, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), expiresAt: new Date(Date.now() + SESSION_TTL_MS[client]) },
    });
    await this.audit.record({ userId: user.id, groupId: user.groupId, ip: meta.ip }, { action: 'auth.signed_in', targetType: 'session', targetId: session.id, detail: { client } });
    return this.issue(user.id, session.id);
  }

  /** Swaps a refresh token for a new pair. A token used twice means it was stolen: the session ends. */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<IssuedTokens> {
    const ended = new UnauthorizedException('Your session has ended. Sign in again.');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) }, include: { session: { include: { user: true } } } });
    if (!row) throw ended;
    const { session } = row;
    if (session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) throw ended;
    const used = await this.prisma.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) {
      await this.revokeSession(session.id, 'refresh token reused');
      await this.audit.record({ userId: session.userId, groupId: session.user.groupId, ip: meta.ip }, { action: 'auth.refresh_reuse_detected', targetType: 'session', targetId: session.id });
      throw ended;
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    return this.issue(session.userId, session.id);
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    let id = sessionId;
    if (!id && refreshToken) {
      id = (await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } }))?.sessionId;
    }
    if (id) await this.revokeSession(id, 'signed out');
  }

  revokeSession(sessionId: string, reason: string) {
    return this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Sets the first password from an invitation link */
  async acceptInvite(token: string, password: string, meta: ClientMeta) {
    const invite = await this.prisma.userInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date() || !invite.user.isActive) {
      throw new BadRequestException('This invitation link is invalid or has expired. Ask your administrator for a new one.');
    }
    await this.prisma.$transaction([
      this.prisma.userInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: invite.userId }, data: { passwordHash: await bcrypt.hash(password, 12) } }),
    ]);
    await this.audit.record({ userId: invite.userId, groupId: invite.user.groupId, ip: meta.ip }, { action: 'auth.invite_accepted', targetType: 'user', targetId: invite.userId });
    return { email: invite.user.email };
  }

  async changePassword(userId: string, currentSessionId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException('Your current password is wrong');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    // Sign out every other device
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: new Date(), revokedReason: 'password changed' } });
  }

  private async issue(userId: string, sessionId: string): Promise<IssuedTokens> {
    const refreshToken = newToken();
    await this.prisma.refreshToken.create({ data: { sessionId, tokenHash: hashToken(refreshToken) } });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: ACCESS_TTL_S });
    return { accessToken, expiresIn: ACCESS_TTL_S, refreshToken, sessionId };
  }
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}
