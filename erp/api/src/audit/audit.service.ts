import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/** Append-only record of sign-ins and every change to financial data */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    userId: number | null,
    action: string,
    entity: string,
    entityId?: string | number | null,
    detail?: unknown,
    db: Db = this.prisma,
  ) {
    await db.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId: entityId == null ? null : String(entityId),
        detail: detail === undefined ? null : JSON.stringify(detail),
      },
    });
  }
}
