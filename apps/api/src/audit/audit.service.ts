import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../access/auth-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  legalEntityId?: string | null;
  detail?: Prisma.InputJsonValue;
}

/** Writes the append-only audit trail. The table rejects updates and deletes. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(auth: Pick<AuthContext, 'userId' | 'groupId' | 'ip'> | null, entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    return tx.auditLog.create({
      data: {
        groupId: auth?.groupId,
        actorId: auth?.userId,
        ip: auth?.ip,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        legalEntityId: entry.legalEntityId ?? null,
        detail: entry.detail,
      },
    });
  }
}
