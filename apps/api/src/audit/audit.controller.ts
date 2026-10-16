import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { entityFilter } from '../access/scope';
import { PrismaService } from '../prisma/prisma.service';

class AuditQuery {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() legalEntityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Group-wide auditors see everything in the group; others only their companies' entries. */
  @Get()
  @RequirePermission('audit.read')
  async list(@Auth() auth: AuthContext, @Query() q: AuditQuery) {
    const scope = entityFilter(auth, 'audit.read');
    const where = {
      groupId: auth.groupId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(scope ? { legalEntityId: q.legalEntityId ? { in: scope.in.filter((id) => id === q.legalEntityId) } : scope } : q.legalEntityId ? { legalEntityId: q.legalEntityId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, email: true } });
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actorId) ?? null })),
    };
  }
}
