import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { fieldChanges } from '../audit/changes';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './ledger.dto';
import { PreparedLine } from './posting-rules';
import { dueDateFor, subledgerProblem } from './subledger-rules';

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
          subledger: dto.subledger,
        },
      });
      await this.audit.record({
        userId: user.id,
        companyId: company.id,
        action: 'gl.account_created',
        entity: 'GlAccount',
        entityId: account.id,
        label: `${account.code} ${account.description}`,
        detail: dto,
      });
      return account;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Account ${dto.code} already exists`);
      }
      throw e;
    }
  }

  /**
   * Marks an account as Debtors or Creditors Control (or clears it). Refused once rows posted to it would
   * disagree: a control account with rows that name no party, or a plain account whose rows name parties.
   */
  async updateAccount(companyCode: string, accountId: number, user: AuthUser, dto: UpdateAccountDto) {
    const company = await this.companies.byCode(companyCode);
    const account = await this.prisma.glAccount.findFirst({ where: { id: accountId, companyId: company.id } });
    if (!account) throw new NotFoundException(`No account id ${accountId}`);
    const data: Prisma.GlAccountUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.subledger !== undefined && (dto.subledger ?? null) !== account.subledger) {
      const subledger = dto.subledger ?? null;
      if (subledger) {
        if (!account.isPostable) throw new BadRequestException(`${account.code} is a header account`);
        const unnamed = await this.prisma.ledgerEntry.count({ where: { accountId, partyId: null } });
        if (unnamed) {
          throw new ConflictException(`${account.code} already has ${unnamed} posted rows with no customer or supplier, so it cannot become a control account`);
        }
      } else {
        const named = await this.prisma.ledgerEntry.count({ where: { accountId, partyId: { not: null } } });
        if (named) throw new ConflictException(`${account.code} holds customer or supplier balances and must stay a control account`);
      }
      data.subledger = subledger;
    }
    const updated = await this.prisma.glAccount.update({ where: { id: accountId }, data });
    const changes = fieldChanges(account, updated, { description: 'Description', isActive: 'Active', subledger: 'Control account' });
    if (changes.length) {
      await this.audit.record({
        userId: user.id,
        companyId: company.id,
        action: 'gl.account_updated',
        entity: 'GlAccount',
        entityId: accountId,
        label: `${updated.code} ${updated.description}`,
        detail: { changes },
      });
    }
    return updated;
  }

  async journal(companyCode: string, auditNo: string) {
    const company = await this.companies.byCode(companyCode);
    const batch = await this.prisma.postingBatch.findUnique({
      where: { companyId_auditNo: { companyId: company.id, auditNo } },
      include: {
        entries: {
          orderBy: { lineNo: 'asc' },
          include: { account: { select: { code: true, description: true } }, party: { select: { code: true, name: true } } },
        },
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
    const terms = await this.termsByParty(tx, lines);
    const auditNo = await this.nextNumber(tx, header.companyId, 'AUDIT', 'GL');
    const batch = await tx.postingBatch.create({
      data: {
        ...header,
        auditNo,
        periodId: period.id,
        postedById: userId,
        entries: {
          create: lines.map((l) => ({
            ...l,
            companyId: header.companyId,
            txDate: header.txDate,
            periodId: period.id,
            dueDate: l.partyId ? dueDateFor(header.txDate, terms.get(l.partyId) ?? 0, l.dueDate) : null,
          })),
        },
      },
    });
    await this.audit.record(
      {
        userId,
        companyId: header.companyId,
        action: `gl.${header.documentType.toLowerCase()}_posted`,
        entity: 'PostingBatch',
        entityId: batch.id,
        label: auditNo,
        detail: { auditNo, lines: lines.length },
      },
      tx,
    );
    return batch;
  }

  private async termsByParty(tx: Tx, lines: PreparedLine[]) {
    const ids = unique(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])));
    const parties = ids.length ? await tx.party.findMany({ where: { id: { in: ids } }, select: { id: true, termsDays: true } }) : [];
    return new Map(parties.map((p) => [p.id, p.termsDays]));
  }

  /**
   * Accounts, projects, tax codes and currencies must exist, belong to this company and be open for posting,
   * and control account lines must name a customer or supplier of this company
   */
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

    const partyIds = unique(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])));
    const parties = partyIds.length ? await tx.party.findMany({ where: { id: { in: partyIds }, companyId } }) : [];
    const partyById = new Map(parties.map((p) => [p.id, p]));
    lines.forEach((l, i) => {
      const party = l.partyId ? partyById.get(l.partyId) : null;
      if (l.partyId && !party) throw new BadRequestException(`Line ${i + 1}: customer or supplier id ${l.partyId} is not in this company`);
      const problem = subledgerProblem(`Line ${i + 1}`, found.get(l.accountId)!, party);
      if (problem) throw new BadRequestException(problem);
    });

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
