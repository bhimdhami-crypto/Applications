import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, PostJournalDto } from './ledger.dto';
import { PostingRuleError, PreparedLine, prepareLines, reverseLines } from './posting-rules';

type Tx = Prisma.TransactionClient;

interface BatchHeader {
  companyId: number;
  source: string;
  documentType: string;
  description: string;
  reference?: string | null;
  txDate: Date;
  reversesId?: number;
}

/**
 * The posting engine. Every ledger change goes through post(), which numbers the batch,
 * checks the period, accounts and balance, and writes header, lines and audit log in one transaction.
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

  async postJournal(companyCode: string, user: AuthUser, dto: PostJournalDto) {
    const company = await this.companies.byCode(companyCode);
    const lines = this.prepare(() => prepareLines(dto.lines, company.homeCurrency, company.currency.decimals));
    return this.post(
      user,
      {
        companyId: company.id,
        source: 'GL',
        documentType: 'JOURNAL',
        description: dto.description,
        reference: dto.reference,
        txDate: toDate(dto.txDate),
      },
      lines,
    );
  }

  async reverseJournal(companyCode: string, user: AuthUser, auditNo: string, txDate?: string) {
    const company = await this.companies.byCode(companyCode);
    const original = await this.prisma.postingBatch.findUnique({
      where: { companyId_auditNo: { companyId: company.id, auditNo } },
      include: { entries: { orderBy: { lineNo: 'asc' } }, reversedBy: true },
    });
    if (!original) throw new NotFoundException(`No journal ${auditNo}`);
    if (original.reversedBy) throw new ConflictException(`${auditNo} was already reversed by ${original.reversedBy.auditNo}`);
    if (original.reversesId) throw new ConflictException(`${auditNo} is itself a reversal`);

    const lines = reverseLines(
      original.entries.map((e) => ({
        lineNo: e.lineNo,
        accountId: e.accountId,
        debit: e.debit.toFixed(4),
        credit: e.credit.toFixed(4),
        currencyCode: e.currencyCode,
        exchangeRate: e.exchangeRate.toFixed(6),
        foreignDebit: e.foreignDebit.toFixed(4),
        foreignCredit: e.foreignCredit.toFixed(4),
        description: e.description ?? undefined,
        projectId: e.projectId ?? undefined,
        taxCodeId: e.taxCodeId ?? undefined,
      })),
    );
    return this.post(
      user,
      {
        companyId: company.id,
        source: original.source,
        documentType: 'REVERSAL',
        description: `Reversal of ${auditNo}: ${original.description}`.slice(0, 400),
        reference: original.reference,
        txDate: txDate ? toDate(txDate) : original.txDate,
        reversesId: original.id,
      },
      lines,
    );
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

  private prepare(fn: () => PreparedLine[]) {
    try {
      return fn();
    } catch (e) {
      // Rule failures (unbalanced, bad amount) are the caller's mistake, so they come back as 400 with the reason
      if (e instanceof PostingRuleError || e instanceof Error) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private async post(user: AuthUser, header: BatchHeader, lines: PreparedLine[]) {
    return this.prisma.$transaction(
      async (tx) => {
        const period = await tx.fiscalPeriod.findFirst({
          where: { companyId: header.companyId, startDate: { lte: header.txDate }, endDate: { gte: header.txDate } },
          orderBy: { number: 'asc' },
        });
        if (!period) throw new BadRequestException(`No fiscal period covers ${isoDate(header.txDate)}`);
        if (period.isClosed) throw new BadRequestException(`Period ${period.year}/${period.number} is closed`);

        await this.checkReferences(tx, header.companyId, lines);
        const auditNo = await this.nextNumber(tx, header.companyId, 'AUDIT', 'GL');

        const batch = await tx.postingBatch.create({
          data: {
            ...header,
            auditNo,
            periodId: period.id,
            postedById: user.id,
            entries: {
              create: lines.map((l) => ({ ...l, companyId: header.companyId, txDate: header.txDate, periodId: period.id })),
            },
          },
          include: { entries: { orderBy: { lineNo: 'asc' } } },
        });
        await this.audit.record(user.id, `gl.${header.documentType.toLowerCase()}_posted`, 'PostingBatch', batch.id, { auditNo }, tx);
        return batch;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
  private async nextNumber(tx: Tx, companyId: number, name: string, prefix: string) {
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
function toDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
