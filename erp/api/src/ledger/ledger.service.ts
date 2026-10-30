import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './ledger.dto';
import { PreparedLine } from './posting-rules';

export type Tx = Prisma.TransactionClient;

export interface BatchHeader {
  companyId: number;
  source: string;
  documentType: string;
  description: string;
  reference?: string | null;
  txDate: Date;
  reversesId?: number;
  intercompanyOfId?: number;
}

/**
 * The posting engine and ledger queries. Nothing posts directly: vouchers are approved first
 * (VouchersService), and the final approval calls postInTx() inside its own transaction.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  async accounts(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.glAccount.findMany({ where: { companyId: company.id }, orderBy: { code: 'asc' } });
  }

  async createAccount(companyCode: string, user: AuthUser, dto: CreateAccountDto) {
    const company = await this.companies.byCode(companyCode);
    let parentId: number | undefined;
    if (dto.parentCode) {
      const parent = await this.prisma.glAccount.findUnique({
        where: { companyId_code: { companyId: company.id, code: dto.parentCode } },
      });
      if (!parent) throw new BadRequestException(`No parent account ${dto.parentCode}`);
      parentId = parent.id;
    }
    try {
      const account = await this.prisma.glAccount.create({
        data: {
          companyId: company.id,
          code: dto.code,
          description: dto.description,
          type: dto.type,
          parentId,
          isPostable: dto.isPostable ?? true,
          costCentre: dto.costCentre,
        },
      });
      await this.audit.record(user.id, 'gl.account_created', 'GlAccount', account.id, dto);
      return account;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Account ${dto.code} already exists`);
      }
      throw e;
    }
  }

  async journal(companyCode: string, auditNo: string) {
    const company = await this.companies.byCode(companyCode);
    const batch = await this.prisma.postingBatch.findUnique({
      where: { companyId_auditNo: { companyId: company.id, auditNo } },
      include: {
        entries: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, description: true } } } },
        postedBy: { select: { name: true } },
      },
    });
    if (!batch) throw new NotFoundException(`No journal ${auditNo}`);
    return batch;
  }

  async journals(companyCode: string, from: string, to: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.postingBatch.findMany({
      where: { companyId: company.id, txDate: { gte: toDate(from), lte: toDate(to) } },
      orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  /** Debit and credit totals per account for the dates given, with closing balance (debit minus credit) */
  async trialBalance(companyCode: string, from: string, to: string) {
    const company = await this.companies.byCode(companyCode);
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { companyId: company.id, txDate: { gte: toDate(from), lte: toDate(to) } },
      _sum: { debit: true, credit: true },
    });
    const accounts = await this.prisma.glAccount.findMany({
      where: { id: { in: sums.map((s) => s.accountId) } },
      select: { id: true, code: true, description: true, type: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const zero = new Prisma.Decimal(0);
    let totalDebit = zero;
    let totalCredit = zero;
    const rows = sums
      .map((s) => {
        const debit = s._sum.debit ?? zero;
        const credit = s._sum.credit ?? zero;
        totalDebit = totalDebit.plus(debit);
        totalCredit = totalCredit.plus(credit);
        const account = byId.get(s.accountId)!;
        return {
          accountId: account.id,
          code: account.code,
          description: account.description,
          type: account.type,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
          balance: debit.minus(credit).toFixed(2),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      company: company.code,
      currency: company.homeCurrency,
      from,
      to,
      rows,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
    };
  }

  /**
   * Checks a batch can post: the date falls in an open period, and every account, project, tax code
   * and currency exists and belongs to the company. Returns the period. Used at submission as a dry run,
   * and again at posting.
   */
  async checkPostable(tx: Tx, companyId: number, txDate: Date, lines: PreparedLine[]) {
    const period = await tx.fiscalPeriod.findFirst({
      where: { companyId, startDate: { lte: txDate }, endDate: { gte: txDate } },
      orderBy: { number: 'asc' },
    });
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!period) throw new BadRequestException(`${company.code}: no fiscal period covers ${isoDate(txDate)}`);
    if (period.isClosed) throw new BadRequestException(`${company.code}: period ${period.year}/${period.number} is closed`);
    await this.checkReferences(tx, companyId, lines);
    return period;
  }

  /**
   * The only way rows reach the ledger. Runs inside the caller's transaction (the final approval),
   * numbers the batch and writes header, lines and audit log.
   */
  async postInTx(tx: Tx, userId: number, header: BatchHeader, lines: PreparedLine[]) {
    const period = await this.checkPostable(tx, header.companyId, header.txDate, lines);
    const auditNo = await this.nextNumber(tx, header.companyId, 'AUDIT', 'GL');
    const batch = await tx.postingBatch.create({
      data: {
        ...header,
        auditNo,
        periodId: period.id,
        postedById: userId,
        entries: {
          create: lines.map((l) => ({ ...l, companyId: header.companyId, txDate: header.txDate, periodId: period.id })),
        },
      },
    });
    await this.audit.record(userId, `gl.${header.documentType.toLowerCase()}_posted`, 'PostingBatch', batch.id, { auditNo }, tx);
    return batch;
  }

  /** Accounts, projects, tax codes and currencies must exist, belong to this company and be open for posting */
  private async checkReferences(tx: Tx, companyId: number, lines: PreparedLine[]) {
    const accountIds = unique(lines.map((l) => l.accountId));
    const accounts = await tx.glAccount.findMany({ where: { id: { in: accountIds }, companyId } });
    const found = new Map(accounts.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const a = found.get(id);
      if (!a) throw new BadRequestException(`Account id ${id} does not exist in this company`);
      if (!a.isActive) throw new BadRequestException(`Account ${a.code} is inactive`);
      if (!a.isPostable) throw new BadRequestException(`Account ${a.code} is a header account and cannot be posted to`);
    }

    const projectIds = unique(lines.flatMap((l) => (l.projectId ? [l.projectId] : [])));
    if (projectIds.length) {
      const count = await tx.project.count({ where: { id: { in: projectIds }, companyId, isActive: true } });
      if (count !== projectIds.length) throw new BadRequestException('A project on this journal is unknown or inactive');
    }
    const taxIds = unique(lines.flatMap((l) => (l.taxCodeId ? [l.taxCodeId] : [])));
    if (taxIds.length) {
      const count = await tx.taxCode.count({ where: { id: { in: taxIds }, companyId, isActive: true } });
      if (count !== taxIds.length) throw new BadRequestException('A tax code on this journal is unknown or inactive');
    }
    const currencies = unique(lines.map((l) => l.currencyCode));
    const known = await tx.currency.count({ where: { code: { in: currencies } } });
    if (known !== currencies.length) throw new BadRequestException(`Unknown currency in ${currencies.join(', ')}`);
  }

  /** Takes the next number in a series inside the posting transaction, so numbers are never reused or skipped */
  async nextNumber(tx: Tx, companyId: number, name: string, prefix: string) {
    const seq = await tx.numberSequence.upsert({
      where: { companyId_name: { companyId, name } },
      create: { companyId, name, prefix, next: 2 },
      update: { next: { increment: 1 } },
    });
    return `${seq.prefix}${String(seq.next - 1).padStart(6, '0')}`;
  }
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

/** Ledger dates are calendar days: parse YYYY-MM-DD as UTC midnight so no timezone shifts the day */
export function toDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
