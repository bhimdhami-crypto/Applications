import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartyDto, UpdatePartyDto } from './parties.dto';

/** Customers and suppliers. Code and kind are fixed once created, since posted rows refer to them. */
@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  async list(companyCode: string, kind?: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.party.findMany({ where: { companyId: company.id, kind }, orderBy: [{ kind: 'asc' }, { code: 'asc' }] });
  }

  async create(companyCode: string, user: AuthUser, dto: CreatePartyDto) {
    const company = await this.companies.byCode(companyCode);
    try {
      const party = await this.prisma.party.create({
        data: { ...dto, code: dto.code.trim(), currencyCode: dto.currencyCode?.toUpperCase(), companyId: company.id },
      });
      await this.audit.record(user.id, 'party.created', 'Party', party.id, dto);
      return party;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`${dto.kind === 'CUSTOMER' ? 'Customer' : 'Supplier'} ${dto.code} already exists`);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException(`Unknown currency ${dto.currencyCode}`);
      }
      throw e;
    }
  }

  async update(companyCode: string, id: number, user: AuthUser, dto: UpdatePartyDto) {
    const company = await this.companies.byCode(companyCode);
    const party = await this.prisma.party.findFirst({ where: { id, companyId: company.id } });
    if (!party) throw new NotFoundException(`No customer or supplier id ${id}`);
    const updated = await this.prisma.party.update({
      where: { id },
      data: { ...dto, currencyCode: dto.currencyCode?.toUpperCase() },
    });
    // Terms and credit limits matter for audit, so keep before and after
    await this.audit.record(user.id, 'party.updated', 'Party', id, { before: party, after: dto });
    return updated;
  }
}
