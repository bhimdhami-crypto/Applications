import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { fieldChanges } from '../audit/changes';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartyDto, UpdatePartyDto } from './parties.dto';

const PARTY_FIELDS = {
  name: 'Name',
  currencyCode: 'Currency',
  termsDays: 'Terms (days)',
  creditLimit: 'Credit limit',
  taxNumber: 'Tax number',
  email: 'Email',
  phone: 'Phone',
  isActive: 'Active',
} as const;

const partyLabel = (p: { kind: string; code: string; name: string }) =>
  `${p.kind === 'CUSTOMER' ? 'Customer' : 'Supplier'} ${p.code} ${p.name}`;

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
      await this.audit.record({ userId: user.id, companyId: company.id, action: 'party.created', entity: 'Party', entityId: party.id, label: partyLabel(party), detail: dto });
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
    // Terms and credit limits matter for audit, so keep what each changed field held before
    const changes = fieldChanges(party, updated, PARTY_FIELDS);
    if (changes.length) {
      await this.audit.record({
        userId: user.id,
        companyId: company.id,
        action: 'party.updated',
        entity: 'Party',
        entityId: id,
        label: partyLabel(updated),
        detail: { changes },
      });
    }
    return updated;
  }
}
