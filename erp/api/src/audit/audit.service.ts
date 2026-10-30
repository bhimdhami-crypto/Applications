import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface AuditEntry {
  userId: number | null;
  /** The company the change belongs to; empty for sign-ins and other events outside any company */
  companyId?: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  /** What a reader calls the record, such as the voucher number or account code */
  label?: string | null;
  detail?: unknown;
}

/**
 * Append-only record of sign-ins and every change to financial data. Updates carry field-by-field
 * changes (see changes.ts) so the change history can show what was there before. The database refuses
 * updates and deletes on the table outside test databases.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma) {
    await db.auditLog.create({
      data: {
        userId: entry.userId,
        companyId: entry.companyId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId == null ? null : String(entry.entityId),
        label: entry.label?.slice(0, 100) ?? null,
        detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
      },
    });
  }
}
