import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURE_MODULES } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { assertEntity, entityFilter } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBranchDto,
  CreateBusinessUnitDto,
  CreateCostCentreDto,
  CreateCountryDto,
  CreateCurrencyDto,
  CreateDepartmentDto,
  CreateEntityDto,
  StructureKind,
  UpdateCountryDto,
  UpdateCurrencyDto,
  UpdateEntityDto,
  UpdateStructureDto,
} from './org.dto';

export function assertTimeZone(tz: string | undefined) {
  if (tz === undefined) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new BadRequestException(`${tz} is not a known time zone`);
  }
}

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───── Reference data ─────

  currencies() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  async createCurrency(auth: AuthContext, dto: CreateCurrencyDto) {
    const row = await this.prisma.currency.create({ data: dto });
    await this.audit.record(auth, { action: 'org.currency.created', targetType: 'currency', targetId: row.code, detail: { ...dto } });
    return row;
  }

  async updateCurrency(auth: AuthContext, code: string, dto: UpdateCurrencyDto) {
    await this.prisma.currency.findUniqueOrThrow({ where: { code } }).catch(() => {
      throw new NotFoundException('Currency not found');
    });
    const row = await this.prisma.currency.update({ where: { code }, data: dto });
    await this.audit.record(auth, { action: 'org.currency.updated', targetType: 'currency', targetId: code, detail: { ...dto } });
    return row;
  }

  languages() {
    return this.prisma.language.findMany({ orderBy: { englishName: 'asc' } });
  }

  async countries(auth: AuthContext) {
    const scope = entityFilter(auth, 'org.read');
    const [countries, counts] = await Promise.all([
      this.prisma.country.findMany({ orderBy: { name: 'asc' }, include: { currency: true } }),
      this.prisma.legalEntity.groupBy({ by: ['countryCode'], where: { groupId: auth.groupId, ...(scope ? { id: scope } : {}) }, _count: true }),
    ]);
    return countries.map((c) => ({ ...c, entityCount: counts.find((x) => x.countryCode === c.code)?._count ?? 0 }));
  }

  async createCountry(auth: AuthContext, dto: CreateCountryDto) {
    assertTimeZone(dto.timeZone);
    await this.assertLanguages(dto.languages);
    if (!(await this.prisma.currency.findUnique({ where: { code: dto.currencyCode } }))) throw new BadRequestException('Add the currency first');
    const row = await this.prisma.country.create({ data: dto });
    await this.audit.record(auth, { action: 'org.country.created', targetType: 'country', targetId: row.code, detail: { ...dto } });
    return row;
  }

  async updateCountry(auth: AuthContext, code: string, dto: UpdateCountryDto) {
    assertTimeZone(dto.timeZone);
    if (dto.languages) await this.assertLanguages(dto.languages);
    if (!(await this.prisma.country.findUnique({ where: { code } }))) throw new NotFoundException('Country not found');
    const row = await this.prisma.country.update({ where: { code }, data: dto });
    await this.audit.record(auth, { action: 'org.country.updated', targetType: 'country', targetId: code, detail: { ...dto } });
    return row;
  }

  private async assertLanguages(codes: string[]) {
    const found = await this.prisma.language.count({ where: { code: { in: codes } } });
    if (found !== new Set(codes).size) throw new BadRequestException('One of those languages is not in the language catalogue');
  }

  // ───── Legal entities ─────

  async tree(auth: AuthContext) {
    const scope = entityFilter(auth, 'org.read');
    const entities = await this.prisma.legalEntity.findMany({
      where: { groupId: auth.groupId, ...(scope ? { id: scope } : {}) },
      orderBy: [{ countryCode: 'asc' }, { code: 'asc' }],
      include: {
        businessUnits: { orderBy: { code: 'asc' } },
        branches: { orderBy: { code: 'asc' } },
        departments: { orderBy: { code: 'asc' }, include: { costCentres: { orderBy: { code: 'asc' } } } },
      },
    });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: auth.groupId } });
    const countries = await this.prisma.country.findMany({ where: { code: { in: [...new Set(entities.map((e) => e.countryCode))] } }, orderBy: { name: 'asc' } });
    return {
      group,
      countries: countries.map((c) => ({ ...c, entities: entities.filter((e) => e.countryCode === c.code) })),
    };
  }

  async entities(auth: AuthContext, countryCode?: string, q?: string) {
    const scope = entityFilter(auth, 'org.read');
    return this.prisma.legalEntity.findMany({
      where: {
        groupId: auth.groupId,
        ...(scope ? { id: scope } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ countryCode: 'asc' }, { code: 'asc' }],
      include: { country: { select: { name: true } }, _count: { select: { businessUnits: true, branches: true, departments: true, costCentres: true } } },
    });
  }

  async entity(auth: AuthContext, id: string) {
    assertEntity(auth, 'org.read', id, 'Company');
    const row = await this.prisma.legalEntity.findUniqueOrThrow({
      where: { id },
      include: {
        country: true,
        currency: true,
        businessUnits: { orderBy: { code: 'asc' } },
        branches: { orderBy: { code: 'asc' } },
        departments: { orderBy: { code: 'asc' }, include: { businessUnit: { select: { name: true } }, branch: { select: { name: true } } } },
        costCentres: { orderBy: { code: 'asc' }, include: { department: { select: { name: true } } } },
        features: true,
      },
    });
    return {
      ...row,
      features: FEATURE_MODULES.map((m) => ({
        module: m.key,
        label: m.label,
        alwaysOn: m.alwaysOn,
        enabled: m.alwaysOn || (row.features.find((f) => f.module === m.key)?.enabled ?? false),
      })),
    };
  }

  async createEntity(auth: AuthContext, dto: CreateEntityDto) {
    const country = await this.prisma.country.findUnique({ where: { code: dto.countryCode } });
    if (!country) throw new BadRequestException('Add the country first');
    assertTimeZone(dto.timeZone);
    const currency = dto.functionalCurrency ?? country.currencyCode;
    if (!(await this.prisma.currency.findUnique({ where: { code: currency } }))) throw new BadRequestException('Add the currency first');
    const row = await this.prisma.legalEntity.create({
      data: {
        ...dto,
        groupId: auth.groupId,
        functionalCurrency: currency,
        timeZone: dto.timeZone ?? country.timeZone,
        weekendDays: dto.weekendDays ?? country.weekendDays,
        defaultLanguage: dto.defaultLanguage ?? country.languages[0] ?? 'en',
      },
    });
    await this.audit.record(auth, { action: 'org.entity.created', targetType: 'legal_entity', targetId: row.id, legalEntityId: row.id, detail: { code: row.code, name: row.name } });
    return row;
  }

  async updateEntity(auth: AuthContext, id: string, dto: UpdateEntityDto) {
    assertEntity(auth, 'org.entities.manage', id, 'Company');
    assertTimeZone(dto.timeZone);
    const row = await this.prisma.legalEntity.update({ where: { id }, data: dto });
    await this.audit.record(auth, { action: 'org.entity.updated', targetType: 'legal_entity', targetId: id, legalEntityId: id, detail: { ...dto } });
    return row;
  }

  async setFeature(auth: AuthContext, id: string, module: string, enabled: boolean) {
    assertEntity(auth, 'features.manage', id, 'Company');
    const def = FEATURE_MODULES.find((m) => m.key === module);
    if (!def) throw new NotFoundException('Unknown module');
    if (def.alwaysOn) throw new BadRequestException(`${def.label} cannot be switched off`);
    await this.prisma.entityFeature.upsert({
      where: { legalEntityId_module: { legalEntityId: id, module } },
      create: { legalEntityId: id, module, enabled, updatedById: auth.userId },
      update: { enabled, updatedById: auth.userId },
    });
    await this.audit.record(auth, { action: enabled ? 'org.feature.enabled' : 'org.feature.disabled', targetType: 'legal_entity', targetId: id, legalEntityId: id, detail: { module } });
    return { module, enabled };
  }

  // ───── Business units, branches, departments, cost centres ─────

  async createStructure(auth: AuthContext, entityId: string, kind: StructureKind, dto: CreateBusinessUnitDto | CreateBranchDto | CreateDepartmentDto | CreateCostCentreDto) {
    assertEntity(auth, 'org.structure.manage', entityId, 'Company');
    const base = { legalEntityId: entityId, code: dto.code, name: dto.name };
    let row: { id: string };
    switch (kind) {
      case 'business-units':
        row = await this.prisma.businessUnit.create({ data: base });
        break;
      case 'branches': {
        const d = dto as CreateBranchDto;
        assertTimeZone(d.timeZone);
        row = await this.prisma.branch.create({ data: { ...base, city: d.city, address: d.address, timeZone: d.timeZone } });
        break;
      }
      case 'departments': {
        const d = dto as CreateDepartmentDto;
        await this.assertSameEntity(entityId, { businessUnitId: d.businessUnitId, branchId: d.branchId, departmentId: d.parentId });
        row = await this.prisma.department.create({ data: { ...base, businessUnitId: d.businessUnitId, branchId: d.branchId, parentId: d.parentId } });
        break;
      }
      case 'cost-centres': {
        const d = dto as CreateCostCentreDto;
        await this.assertSameEntity(entityId, { departmentId: d.departmentId });
        row = await this.prisma.costCentre.create({ data: { ...base, departmentId: d.departmentId, glCode: d.glCode } });
        break;
      }
    }
    await this.audit.record(auth, { action: `org.${kind}.created`, targetType: kind, targetId: row.id, legalEntityId: entityId, detail: { code: dto.code, name: dto.name } });
    return row;
  }

  async updateStructure(auth: AuthContext, kind: StructureKind, id: string, dto: UpdateStructureDto) {
    const found = await this.findStructure(kind, id);
    if (!found) throw new NotFoundException('Not found');
    assertEntity(auth, 'org.structure.manage', found.legalEntityId, 'Record');
    const { name, status } = dto;
    let row: unknown;
    switch (kind) {
      case 'business-units':
        row = await this.prisma.businessUnit.update({ where: { id }, data: { name, status } });
        break;
      case 'branches':
        row = await this.prisma.branch.update({ where: { id }, data: { name, status, city: dto.city, address: dto.address } });
        break;
      case 'departments':
        row = await this.prisma.department.update({ where: { id }, data: { name, status } });
        break;
      case 'cost-centres':
        row = await this.prisma.costCentre.update({ where: { id }, data: { name, status, glCode: dto.glCode } });
        break;
    }
    await this.audit.record(auth, { action: `org.${kind}.updated`, targetType: kind, targetId: id, legalEntityId: found.legalEntityId, detail: { ...dto } });
    return row;
  }

  private findStructure(kind: StructureKind, id: string): Promise<{ legalEntityId: string } | null> {
    const select = { legalEntityId: true };
    switch (kind) {
      case 'business-units':
        return this.prisma.businessUnit.findUnique({ where: { id }, select });
      case 'branches':
        return this.prisma.branch.findUnique({ where: { id }, select });
      case 'departments':
        return this.prisma.department.findUnique({ where: { id }, select });
      case 'cost-centres':
        return this.prisma.costCentre.findUnique({ where: { id }, select });
    }
  }

  /** Links inside a company must point at records of the same company */
  private async assertSameEntity(entityId: string, refs: { businessUnitId?: string; branchId?: string; departmentId?: string }) {
    const checks: [string | undefined, StructureKind][] = [
      [refs.businessUnitId, 'business-units'],
      [refs.branchId, 'branches'],
      [refs.departmentId, 'departments'],
    ];
    for (const [id, kind] of checks) {
      if (!id) continue;
      const row = await this.findStructure(kind, id);
      if (!row || row.legalEntityId !== entityId) throw new BadRequestException(`That ${kind.replace(/-/g, ' ').replace(/s$/, '')} is not in this company`);
    }
  }
}
