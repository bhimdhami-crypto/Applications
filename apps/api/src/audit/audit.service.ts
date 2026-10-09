import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(actorId: string | null, action: string, entity: string, entityId?: string, details?: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, details } });
  }
}
