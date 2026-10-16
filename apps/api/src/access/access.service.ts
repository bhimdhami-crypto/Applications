import { Injectable } from '@nestjs/common';
import { resolveAccess, Role } from '@gpp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from './auth-context';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads the caller's roles and companies, or null when the session is no longer valid */
  async load(userId: string, sessionId: string, ip?: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { roles: true } } },
    });
    const now = new Date();
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < now || !session.user.isActive) return null;
    if (now.getTime() - session.lastUsedAt.getTime() > 5 * 60_000) {
      await this.prisma.session.update({ where: { id: sessionId }, data: { lastUsedAt: now } });
    }
    const entities = await this.prisma.legalEntity.findMany({
      where: { groupId: session.user.groupId },
      select: { id: true, countryCode: true },
    });
    const roles = session.user.roles.map((r) => ({
      id: r.id,
      role: r.role as Role,
      scopeType: r.scopeType,
      countryCode: r.countryCode,
      legalEntityId: r.legalEntityId,
    }));
    return {
      userId,
      groupId: session.user.groupId,
      sessionId,
      email: session.user.email,
      displayName: session.user.displayName,
      roles,
      entities,
      access: resolveAccess(roles, entities),
      ip,
    };
  }
}
