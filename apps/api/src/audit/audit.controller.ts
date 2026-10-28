import { Controller, Get, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

class AuditQuery {
  /** Matches the action (e.g. "payroll.") or the record id */
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() entity?: string;
  /** Actor email, or part of it */
  @IsOptional() @IsString() actor?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize?: number;
}

/** Read-only view of the audit trail for administrators. Nothing here can change or delete an entry. */
@Controller('audit')
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: AuditQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.q) where.OR = [{ action: { contains: query.q, mode: 'insensitive' } }, { entityId: query.q }];
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(new Date(query.to).getTime() + 86_400_000) } : {}),
      };
    }
    if (query.actor) {
      const users = await this.prisma.user.findMany({ where: { email: { contains: query.actor, mode: 'insensitive' } }, select: { id: true }, take: 500 });
      where.actorId = { in: users.map((u) => u.id) };
    }
    const [total, rows, entities] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } },
    });
    return {
      items: rows.map((r) => {
        const a = actors.find((x) => x.id === r.actorId);
        return {
          ...r,
          actor: a ? { email: a.email, role: a.role, name: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : null } : null,
        };
      }),
      total,
      page,
      pageSize,
      entities: entities.map((e) => e.entity),
    };
  }
}
