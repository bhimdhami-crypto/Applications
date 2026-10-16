import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LANGUAGES, ROLE_LABELS } from '@gpp/shared';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthContext } from '../access/auth-context';
import { Auth } from '../access/decorators';
import { PrismaService } from '../prisma/prisma.service';

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsOptional() @IsIn(LANGUAGES.map((l) => l.code)) preferredLanguage?: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Who I am, my roles, and the companies each permission reaches */
  @Get()
  async me(@Auth() auth: AuthContext) {
    const [user, group] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, email: true, displayName: true, preferredLanguage: true, lastLoginAt: true } }),
      this.prisma.group.findUniqueOrThrow({ where: { id: auth.groupId }, select: { id: true, code: true, name: true, reportingCurrency: true, defaultLanguage: true } }),
    ]);
    const reachable = new Set<string>();
    const permissions: Record<string, { group: boolean; legalEntityIds: string[] }> = {};
    for (const [p, s] of auth.access) {
      permissions[p] = { group: s.group, legalEntityIds: [...s.entityIds] };
      s.entityIds.forEach((id) => reachable.add(id));
    }
    const entities = await this.prisma.legalEntity.findMany({
      where: { id: { in: [...reachable] } },
      select: { id: true, code: true, name: true, countryCode: true, functionalCurrency: true, defaultLanguage: true, status: true, features: { select: { module: true, enabled: true } } },
      orderBy: [{ countryCode: 'asc' }, { code: 'asc' }],
    });
    const names = new Map(entities.map((e) => [e.id, e.name]));
    return {
      user,
      group,
      roles: auth.roles.map((r) => ({
        ...r,
        label: ROLE_LABELS[r.role],
        scopeLabel: r.scopeType === 'GROUP' ? 'Whole group' : r.scopeType === 'COUNTRY' ? `Country: ${r.countryCode}` : (names.get(r.legalEntityId!) ?? 'Company'),
      })),
      permissions,
      entities,
    };
  }

  @Patch()
  async update(@Auth() auth: AuthContext, @Body() dto: UpdateMeDto) {
    return this.prisma.user.update({ where: { id: auth.userId }, data: dto, select: { id: true, displayName: true, preferredLanguage: true } });
  }
}
