import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompaniesService } from '../companies/companies.service';
import { toDate } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { HistoryEntity, HistoryQuery, SignInQuery } from './history.dto';

const PAGE = 100;
/** Filter dates are days in Nairobi (UTC+3 all year), where the books are kept */
const LOCAL_OFFSET_MS = 3 * 60 * 60 * 1000;

type Row = Prisma.AuditLogGetPayload<{ include: { user: { select: { name: true; email: true } } } }>;

/** Reads the audit log back as change history: who did what to which record, and what changed */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  /** Everything that happened in one company, newest first, a page at a time */
  async list(companyCode: string, q: HistoryQuery) {
    const company = await this.companies.byCode(companyCode);
    const where: Prisma.AuditLogWhereInput = {
      companyId: company.id,
      entity: q.entity,
      userId: q.userId,
      at: this.range(q.from, q.to),
      id: this.cursor(q.before),
    };
    if (q.q) where.OR = [{ label: { contains: q.q } }, { action: { contains: q.q } }, { entityId: q.q }];
    return this.page(where, q.limit ?? PAGE);
  }

  /** One record's history, oldest first, as its own screen shows it */
  async forRecord(companyCode: string, entity: HistoryEntity, entityId: string) {
    const company = await this.companies.byCode(companyCode);
    const ids = [entityId];
    if (entity === 'Voucher') {
      // Older approval entries were filed under the voucher number rather than its id
      const voucher = await this.prisma.voucher.findFirst({ where: { id: Number(entityId) || 0, companyId: company.id } });
      if (!voucher) throw new NotFoundException(`No voucher id ${entityId}`);
      ids.push(voucher.voucherNo);
    }
    const rows = await this.prisma.auditLog.findMany({
      // Rows from before companies were recorded have none, so match on the record alone for those
      where: { entity, entityId: { in: ids }, OR: [{ companyId: company.id }, { companyId: null }] },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { id: 'asc' },
      take: 1000,
    });
    return rows.map(toEntry);
  }

  /** Sign-ins and failed attempts across all companies, for administrators */
  async signIns(q: SignInQuery) {
    return this.page({ entity: 'User', action: { startsWith: 'auth.' }, at: this.range(q.from, q.to), id: this.cursor(q.before) }, PAGE);
  }

  /** The people who appear in a company's history, for the filter */
  async people(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    const ids = await this.prisma.auditLog.findMany({ where: { companyId: company.id, userId: { not: null } }, distinct: ['userId'], select: { userId: true } });
    return this.prisma.user.findMany({ where: { id: { in: ids.map((r) => r.userId!) } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  private async page(where: Prisma.AuditLogWhereInput, take: number) {
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { id: 'desc' },
      take: take + 1,
    });
    const more = rows.length > take;
    const items = rows.slice(0, take).map(toEntry);
    return { items, next: more ? items[items.length - 1].id : null };
  }

  private range(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    if (from && to && from > to) throw new BadRequestException('The start date is after the end date');
    const startOf = (day: string) => new Date(toDate(day).getTime() - LOCAL_OFFSET_MS);
    // "to" is a whole day: everything before the next midnight
    const end = to ? new Date(startOf(to).getTime() + 24 * 60 * 60 * 1000) : undefined;
    return { gte: from ? startOf(from) : undefined, lt: end };
  }

  private cursor(before?: string): Prisma.BigIntFilter | undefined {
    if (!before) return undefined;
    if (!/^\d+$/.test(before)) throw new BadRequestException('Bad page cursor');
    return { lt: BigInt(before) };
  }
}

function toEntry(r: Row) {
  let detail: unknown = null;
  try {
    detail = r.detail ? JSON.parse(r.detail) : null;
  } catch {
    detail = r.detail;
  }
  return {
    id: r.id.toString(),
    at: r.at,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    label: r.label,
    user: r.user ? r.user.name : null,
    detail,
  };
}
