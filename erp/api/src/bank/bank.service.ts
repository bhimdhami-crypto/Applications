import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { FileStore } from '../archive/file-store';
import { safeFileName } from '../archive/file-types';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { fromUnits, toUnits } from '../common/money';
import { CompaniesService } from '../companies/companies.service';
import { toDate } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CreateBankAccountDto, LayoutHolder, LineVoucherDto, MatchDto, PrepareReconciliationDto, UpdateBankAccountDto } from './bank.dto';
import { BankItem, autoMatch } from './matching';
import { ReconItem, outstanding, reconcile } from './reconciliation';
import { ParsedLine, StatementLayout, balanceBreaks, guessLayout, inDateOrder, parseCsv, readStatement } from './statement-csv';

const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const units = (d: Prisma.Decimal) => toUnits(d.toFixed(4));
const money = (u: bigint) => fromUnits(u);

type Account = Prisma.BankAccountGetPayload<{ include: { glAccount: true; company: true } }>;
/** What the ledger side needs to know about a bank account */
type BankLike = { glAccountId: number; currencyCode: string; company: { homeCurrency: string } };
type EntryRow = Prisma.LedgerEntryGetPayload<{ include: { batch: { select: { auditNo: true; reference: true; description: true } } } }>;

export interface UploadedStatement {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Bank reconciliation: statements are imported per bank account, their lines are matched against the
 * ledger rows on the account's GL account (automatically where the amount and date agree, by hand
 * otherwise), and the reconciliation statement is prepared by one person and reviewed by another.
 */
@Injectable()
export class BankService {
  private readonly store: FileStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    private readonly vouchers: VouchersService,
    config: ConfigService,
  ) {
    this.store = new FileStore(config.get('ARCHIVE_DIR', 'archive'));
  }

  // ---- Bank accounts ----

  async list(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId: company.id },
      include: { glAccount: true, company: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      accounts.map(async (a) => {
        const [ledger, lastLine, unmatchedLines, lastStatement, lastRecon] = await Promise.all([
          this.ledgerBalance(a, null),
          this.prisma.bankStatementLine.findFirst({ where: { bankAccountId: a.id }, orderBy: [{ txDate: 'desc' }, { id: 'desc' }] }),
          this.prisma.bankStatementLine.count({ where: { bankAccountId: a.id, matchId: null } }),
          this.prisma.bankStatement.findFirst({ where: { bankAccountId: a.id }, orderBy: { toDate: 'desc' }, select: { toDate: true } }),
          this.prisma.bankReconciliation.findFirst({
            where: { bankAccountId: a.id },
            orderBy: { asAt: 'desc' },
            select: { asAt: true, difference: true, reviewedAt: true },
          }),
        ]);
        const unmatchedEntries = (await this.openEntries(a, null)).length;
        return {
          ...this.summary(a),
          isActive: a.isActive,
          csvLayout: undefined,
          ledgerBalance: money(ledger),
          statementBalance: lastLine?.balance?.toFixed(4) ?? null,
          statementDate: lastLine ? iso(lastLine.txDate) : null,
          lastStatementTo: lastStatement ? iso(lastStatement.toDate) : null,
          unmatchedLines,
          unmatchedEntries,
          lastReconciliation: lastRecon,
        };
      }),
    );
  }

  async create(companyCode: string, user: AuthUser, dto: CreateBankAccountDto) {
    const company = await this.companies.byCode(companyCode);
    const gl = await this.prisma.glAccount.findFirst({ where: { id: dto.glAccountId, companyId: company.id } });
    if (!gl) throw new BadRequestException(`Account id ${dto.glAccountId} is not in ${company.code}`);
    if (!gl.isPostable) throw new BadRequestException(`${gl.code} is a header account`);
    if (gl.type !== 'ASSET' && gl.type !== 'LIABILITY') throw new BadRequestException(`${gl.code} is not a balance sheet account`);
    if (gl.subledger) throw new BadRequestException(`${gl.code} is a control account`);
    try {
      const account = await this.prisma.bankAccount.create({
        data: {
          companyId: company.id,
          glAccountId: gl.id,
          name: dto.name.trim(),
          bankName: dto.bankName?.trim() || null,
          accountNumber: dto.accountNumber?.trim() || null,
          currencyCode: (dto.currencyCode ?? company.homeCurrency).toUpperCase(),
          reconcileFrom: toDate(dto.reconcileFrom),
        },
      });
      await this.log(user, account, 'bank.account_created', { glAccount: gl.code, ...dto });
      return account;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`${gl.code} or the name ${dto.name} is already set up as a bank account`);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new BadRequestException(`Unknown currency ${dto.currencyCode}`);
      throw e;
    }
  }

  async update(companyCode: string, id: number, user: AuthUser, dto: UpdateBankAccountDto) {
    const account = await this.account(companyCode, id);
    if (dto.reconcileFrom) {
      const reviewed = await this.lastReviewed(account.id);
      if (reviewed && toDate(dto.reconcileFrom) <= reviewed) {
        throw new ConflictException(`Reconciliations are reviewed up to ${iso(reviewed)}; the start date must be after that`);
      }
    }
    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        isActive: dto.isActive,
        reconcileFrom: dto.reconcileFrom ? toDate(dto.reconcileFrom) : undefined,
      },
    });
    await this.log(user, updated, 'bank.account_updated', dto);
    return updated;
  }

  // ---- Statements ----

  /** Reads a statement without saving it, so the person can check the columns first */
  async preview(companyCode: string, id: number, file: UploadedStatement | undefined, layoutJson?: string, openingBalance?: string) {
    const account = await this.account(companyCode, id);
    const { rows, layout } = this.read(account, file, layoutJson);
    const result = layout ? this.lines(rows, layout) : { lines: [], problems: ['Could not find the heading row: choose the columns'] };
    const { fresh, skipped } = layout ? await this.newLines(account.id, result.lines) : { fresh: [], skipped: 0 };
    const opening = await this.openingFor(account.id, result.lines, openingBalance);
    return {
      headings: layout ? rows[layout.headerRow] : (rows[0] ?? []),
      rows: rows.slice(0, 15),
      layout,
      problems: result.problems,
      needsOpeningBalance: result.lines.length > 0 && result.lines.some((l) => l.balance == null) && opening == null,
      lines: result.lines.slice(0, 200).map((l) => ({ ...l, amount: money(l.amount), balance: l.balance == null ? null : money(l.balance) })),
      lineCount: result.lines.length,
      newLines: fresh.length,
      skipped,
    };
  }

  async import(companyCode: string, id: number, user: AuthUser, file: UploadedStatement | undefined, layoutJson?: string, openingBalance?: string) {
    const account = await this.account(companyCode, id);
    const { rows, layout, sha256 } = this.read(account, file, layoutJson);
    if (!layout) throw new BadRequestException('Could not find the heading row: choose the columns');
    const { lines, problems } = this.lines(rows, layout);
    if (problems.length) throw new BadRequestException(`The statement has rows that could not be read. ${problems.slice(0, 5).join('; ')}`);
    if (!lines.length) throw new BadRequestException('The statement has no transactions');
    if (await this.prisma.bankStatement.findUnique({ where: { bankAccountId_sha256: { bankAccountId: id, sha256 } } })) {
      throw new ConflictException(`${file!.originalname} has already been imported`);
    }

    // Files without a balance column get one from the opening balance, so the statement balance is known
    if (lines.some((l) => l.balance == null)) {
      const opening = await this.openingFor(id, lines, openingBalance);
      if (opening == null) throw new BadRequestException('This file has no balance column: enter the balance before its first line');
      let running = opening;
      for (const l of lines) l.balance = running += l.amount;
    }
    const { fresh, skipped } = await this.newLines(id, lines);
    if (!fresh.length) throw new ConflictException('Every line in this statement has already been imported');

    const storageKey = `${account.company.code}/bank/${account.id}/${randomUUID()}-${safeFileName(file!.originalname)}`;
    await this.store.put(storageKey, file!.buffer);
    try {
      const statement = await this.prisma.$transaction(async (tx) => {
        const s = await tx.bankStatement.create({
          data: {
            bankAccountId: id,
            fileName: file!.originalname.slice(0, 260),
            sha256,
            storageKey,
            fromDate: toDate(lines[0].txDate),
            toDate: toDate(lines[lines.length - 1].txDate),
            lineCount: fresh.length,
            skipped,
            importedById: user.id,
          },
        });
        await tx.bankStatementLine.createMany({
          data: fresh.map((l, i) => ({
            statementId: s.id,
            bankAccountId: id,
            lineNo: i + 1,
            txDate: toDate(l.txDate),
            description: l.description,
            reference: l.reference,
            amount: money(l.amount),
            balance: l.balance == null ? null : money(l.balance),
            fingerprint: l.fingerprint,
          })),
        });
        await tx.bankAccount.update({ where: { id }, data: { csvLayout: JSON.stringify(layout) } });
        return s;
      });
      await this.log(user, account, 'bank.statement_imported', { file: statement.fileName, lines: fresh.length, skipped, from: lines[0].txDate, to: lines.at(-1)!.txDate });
      const matched = await this.autoMatch(companyCode, id, user);
      return { statement, imported: fresh.length, skipped, matched: matched.matched };
    } catch (e) {
      await this.store.remove(storageKey);
      throw e;
    }
  }

  async statements(companyCode: string, id: number) {
    await this.account(companyCode, id);
    return this.prisma.bankStatement.findMany({
      where: { bankAccountId: id },
      orderBy: { importedAt: 'desc' },
      select: { id: true, fileName: true, fromDate: true, toDate: true, lineCount: true, skipped: true, importedAt: true, importedBy: { select: { name: true } } },
    });
  }

  async statementFile(companyCode: string, id: number, statementId: number) {
    await this.account(companyCode, id);
    const s = await this.prisma.bankStatement.findFirst({ where: { id: statementId, bankAccountId: id } });
    if (!s) throw new NotFoundException('No such statement');
    const data = await this.store.get(s.storageKey);
    if (!data) throw new NotFoundException('The statement file is missing from storage');
    if (createHash('sha256').update(data).digest('hex') !== s.sha256) throw new NotFoundException('The statement file has been altered since it was imported');
    return { fileName: s.fileName, data };
  }

  // ---- Matching ----

  /** Everything not yet ticked off on either side, up to a date, and the latest matches */
  async workspace(companyCode: string, id: number, to?: string) {
    const account = await this.account(companyCode, id);
    const end = to ? toDate(to) : null;
    const [lines, entries, matches] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where: { bankAccountId: id, matchId: null, txDate: { gte: account.reconcileFrom, ...(end ? { lte: end } : {}) } },
        orderBy: [{ txDate: 'asc' }, { statementId: 'asc' }, { lineNo: 'asc' }],
      }),
      this.openEntries(account, end),
      this.prisma.bankMatch.findMany({
        where: { bankAccountId: id },
        orderBy: { id: 'desc' },
        take: 100,
        include: {
          matchedBy: { select: { name: true } },
          lines: true,
          entries: { include: { ledgerEntry: { include: { batch: { select: { auditNo: true, reference: true, description: true } } } } } },
        },
      }),
    ]);
    const lockedTo = await this.lastReviewed(id);
    return {
      account: this.summary(account),
      lockedTo: lockedTo ? iso(lockedTo) : null,
      lines: lines.map((l) => this.lineOut(l)),
      entries: entries.map((e) => this.entryOut(account, e)),
      matches: matches.map((m) => ({
        id: m.id,
        method: m.method,
        matchedBy: m.matchedBy.name,
        matchedAt: m.matchedAt,
        lines: m.lines.map((l) => this.lineOut(l)),
        entries: m.entries.map((e) => this.entryOut(account, e.ledgerEntry)),
      })),
    };
  }

  async autoMatch(companyCode: string, id: number, user: AuthUser) {
    const account = await this.account(companyCode, id);
    const [lines, entries] = await Promise.all([
      this.prisma.bankStatementLine.findMany({ where: { bankAccountId: id, matchId: null, txDate: { gte: account.reconcileFrom } } }),
      this.openEntries(account, null),
    ]);
    const pairs = autoMatch(
      lines.map((l): BankItem => ({ id: String(l.id), txDate: iso(l.txDate), amount: units(l.amount), text: `${l.description} ${l.reference ?? ''}` })),
      entries.map((e): BankItem => ({ id: e.id.toString(), txDate: iso(e.txDate), amount: this.entryAmount(account, e), text: `${e.description ?? ''} ${e.batch.reference ?? ''} ${e.batch.auditNo}` })),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const p of pairs) {
        const match = await tx.bankMatch.create({
          data: { bankAccountId: id, method: 'AUTO', matchedById: user.id, entries: { create: { ledgerEntryId: BigInt(p.entryId) } } },
        });
        // Guard against a concurrent match: only lines still open are taken
        const taken = await tx.bankStatementLine.updateMany({ where: { id: Number(p.lineId), matchId: null }, data: { matchId: match.id } });
        if (taken.count !== 1) throw new ConflictException('The statement changed while matching; try again');
      }
    });
    if (pairs.length) await this.log(user, account, 'bank.auto_matched', { matches: pairs.length });
    return { matched: pairs.length };
  }

  /** Ticks off any statement lines against any ledger rows, as long as both sides add up to the same amount */
  async match(companyCode: string, id: number, user: AuthUser, dto: MatchDto) {
    const account = await this.account(companyCode, id);
    if (!dto.lineIds.length || !dto.entryIds.length) throw new BadRequestException('Choose at least one statement line and one ledger row');
    if (dto.entryIds.some((e) => !/^\d+$/.test(e))) throw new BadRequestException('Bad ledger row id');
    const entryIds = dto.entryIds.map((e) => BigInt(e));
    const match = await this.prisma.$transaction(
      async (tx) => {
        const lines = await tx.bankStatementLine.findMany({ where: { id: { in: dto.lineIds }, bankAccountId: id } });
        const entries = await tx.ledgerEntry.findMany({ where: { id: { in: entryIds }, accountId: account.glAccountId }, include: { bankMatch: true } });
        if (lines.length !== new Set(dto.lineIds).size) throw new BadRequestException('A statement line is not on this bank account');
        if (entries.length !== new Set(dto.entryIds).size) throw new BadRequestException(`A ledger row is not on ${account.glAccount.code}`);
        if (lines.some((l) => l.matchId)) throw new ConflictException('A statement line is already matched');
        if (entries.some((e) => e.bankMatch)) throw new ConflictException('A ledger row is already matched');
        const bankSide = lines.reduce((s, l) => s + units(l.amount), 0n);
        const ledgerSide = entries.reduce((s, e) => s + this.entryAmount(account, e), 0n);
        if (bankSide !== ledgerSide) {
          throw new BadRequestException(`The statement lines come to ${money(bankSide)} and the ledger rows to ${money(ledgerSide)}; they must be equal`);
        }
        const m = await tx.bankMatch.create({
          data: { bankAccountId: id, method: 'MANUAL', matchedById: user.id, entries: { create: entryIds.map((ledgerEntryId) => ({ ledgerEntryId })) } },
        });
        await tx.bankStatementLine.updateMany({ where: { id: { in: dto.lineIds } }, data: { matchId: m.id } });
        return m;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.log(user, account, 'bank.matched', { match: match.id, lines: dto.lineIds, entries: dto.entryIds });
    return match;
  }

  async unmatch(companyCode: string, id: number, matchId: number, user: AuthUser) {
    const account = await this.account(companyCode, id);
    const match = await this.prisma.bankMatch.findFirst({
      where: { id: matchId, bankAccountId: id },
      include: { lines: true, entries: { include: { ledgerEntry: { select: { txDate: true } } } } },
    });
    if (!match) throw new NotFoundException(`No match ${matchId}`);
    const lockedTo = await this.lastReviewed(id);
    const dates = [...match.lines.map((l) => l.txDate), ...match.entries.map((e) => e.ledgerEntry.txDate)];
    if (lockedTo && dates.some((d) => d <= lockedTo)) {
      throw new ConflictException(`This match is part of the reconciliation reviewed at ${iso(lockedTo)} and cannot be undone`);
    }
    await this.prisma.$transaction([
      this.prisma.bankStatementLine.updateMany({ where: { matchId }, data: { matchId: null } }),
      this.prisma.bankMatch.delete({ where: { id: matchId } }),
    ]);
    await this.log(user, account, 'bank.unmatched', { match: matchId, method: match.method, lines: match.lines.map((l) => `${iso(l.txDate)} ${l.description} ${l.amount.toFixed(2)}`) });
    return { ok: true };
  }

  /**
   * Starts a voucher for a statement line the ledger does not have yet, such as bank charges or interest.
   * It goes through approval like any other; once posted, auto-match ticks it off.
   */
  async voucherForLine(companyCode: string, id: number, lineId: number, user: AuthUser, dto: LineVoucherDto) {
    const account = await this.account(companyCode, id);
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, bankAccountId: id } });
    if (!line) throw new NotFoundException(`No statement line ${lineId}`);
    if (line.matchId) throw new ConflictException('This statement line is already matched');
    const amount = units(line.amount);
    const abs = money(amount < 0n ? -amount : amount);
    const foreign = account.currencyCode !== account.company.homeCurrency;
    let bankLine: Record<string, unknown>;
    if (foreign) {
      const rate =
        dto.exchangeRate ??
        (
          await this.prisma.exchangeRate.findFirst({
            where: { currencyCode: account.currencyCode, rateDate: { lte: line.txDate } },
            orderBy: { rateDate: 'desc' },
          })
        )?.rate.toString();
      if (!rate) throw new BadRequestException(`No ${account.currencyCode} rate on file for ${iso(line.txDate)}: enter one`);
      bankLine = { accountId: account.glAccountId, currencyCode: account.currencyCode, exchangeRate: rate, foreignAmount: money(amount) };
    } else {
      bankLine = { accountId: account.glAccountId, ...(amount > 0n ? { debit: abs } : { credit: abs }) };
    }
    const lines: Array<Record<string, unknown>> = [{ ...bankLine, description: line.description.slice(0, 400) }];
    if (dto.contraAccountId && !foreign) lines.push({ accountId: dto.contraAccountId, ...(amount > 0n ? { credit: abs } : { debit: abs }) });
    else if (dto.contraAccountId) lines.push({ accountId: dto.contraAccountId });
    const voucher = await this.vouchers.create(companyCode, user, {
      txDate: iso(line.txDate),
      description: line.description.slice(0, 400) || `Bank statement ${account.name}`,
      reference: (line.reference ?? '').slice(0, 50) || undefined,
      lines: lines as never,
    });
    await this.log(user, account, 'bank.voucher_from_line', { line: lineId, voucherNo: voucher.voucherNo });
    return voucher;
  }

  // ---- Reconciliation ----

  async reconciliation(companyCode: string, id: number, asAt: string) {
    const account = await this.account(companyCode, id);
    return this.compute(account, asAt);
  }

  async reconciliations(companyCode: string, id: number) {
    await this.account(companyCode, id);
    return this.prisma.bankReconciliation.findMany({
      where: { bankAccountId: id },
      orderBy: { asAt: 'desc' },
      include: { preparedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } },
    });
  }

  /** Records the reconciliation as it stands; an unbalanced one needs a note saying why */
  async prepare(companyCode: string, id: number, user: AuthUser, dto: PrepareReconciliationDto) {
    const account = await this.account(companyCode, id);
    const r = await this.compute(account, dto.asAt);
    if (r.statementBalance == null) throw new BadRequestException(`No statement lines on or before ${dto.asAt}: import the statement first`);
    if (r.difference !== '0.0000' && !dto.note?.trim()) throw new BadRequestException('The reconciliation does not balance: add a note explaining the difference');
    const existing = await this.prisma.bankReconciliation.findUnique({ where: { bankAccountId_asAt: { bankAccountId: id, asAt: toDate(dto.asAt) } } });
    if (existing?.reviewedAt) throw new ConflictException(`The reconciliation at ${dto.asAt} has been reviewed`);
    const lastReviewed = await this.lastReviewed(id);
    if (lastReviewed && toDate(dto.asAt) < lastReviewed) throw new ConflictException(`Reconciliations are reviewed up to ${iso(lastReviewed)}`);
    const data = {
      statementBalance: r.statementBalance,
      depositsInTransit: r.depositsInTransit,
      unpresentedPayments: r.unpresentedPayments,
      bankMoneyIn: r.bankMoneyIn,
      bankMoneyOut: r.bankMoneyOut,
      ledgerBalance: r.ledgerBalance,
      difference: r.difference,
      note: dto.note?.trim() || null,
      preparedById: user.id,
      preparedAt: new Date(),
    };
    const saved = await this.prisma.bankReconciliation.upsert({
      where: { bankAccountId_asAt: { bankAccountId: id, asAt: toDate(dto.asAt) } },
      create: { bankAccountId: id, asAt: toDate(dto.asAt), ...data },
      update: data,
    });
    await this.log(user, account, 'bank.reconciliation_prepared', { asAt: dto.asAt, difference: r.difference, note: data.note });
    return saved;
  }

  /** A second person signs off; the figures must still be what the preparer saw */
  async review(companyCode: string, id: number, reconId: number, user: AuthUser) {
    const account = await this.account(companyCode, id);
    const recon = await this.prisma.bankReconciliation.findFirst({ where: { id: reconId, bankAccountId: id } });
    if (!recon) throw new NotFoundException(`No reconciliation ${reconId}`);
    if (recon.reviewedAt) throw new ConflictException('Already reviewed');
    if (recon.preparedById === user.id) throw new ForbiddenException('You prepared this reconciliation, so someone else must review it');
    const now = await this.compute(account, iso(recon.asAt));
    const same =
      now.statementBalance === recon.statementBalance.toFixed(4) &&
      now.ledgerBalance === recon.ledgerBalance.toFixed(4) &&
      now.difference === recon.difference.toFixed(4) &&
      now.depositsInTransit === recon.depositsInTransit.toFixed(4) &&
      now.unpresentedPayments === recon.unpresentedPayments.toFixed(4);
    if (!same) throw new ConflictException('Matches or postings have changed since this was prepared: it must be prepared again');
    const reviewed = await this.prisma.bankReconciliation.update({ where: { id: reconId }, data: { reviewedById: user.id, reviewedAt: new Date() } });
    await this.log(user, account, 'bank.reconciliation_reviewed', { asAt: iso(recon.asAt), difference: recon.difference.toFixed(2) });
    return reviewed;
  }

  // ---- Helpers ----

  private async compute(account: Account, asAt: string) {
    const end = toDate(asAt);
    const statementLine = await this.prisma.bankStatementLine.findFirst({
      where: { bankAccountId: account.id, txDate: { lte: end }, balance: { not: null } },
      orderBy: [{ txDate: 'desc' }, { statementId: 'desc' }, { lineNo: 'desc' }],
    });
    const ledgerBalance = await this.ledgerBalance(account, end);
    // Every item from the start date to asAt, with the latest date of whatever it is matched to
    const [lines, entries] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where: { bankAccountId: account.id, txDate: { gte: account.reconcileFrom, lte: end } },
        include: { match: { include: { lines: { select: { txDate: true } }, entries: { include: { ledgerEntry: { select: { txDate: true } } } } } } },
        orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.ledgerEntry.findMany({
        where: { accountId: account.glAccountId, txDate: { gte: account.reconcileFrom, lte: end } },
        include: {
          batch: { select: { auditNo: true, reference: true, description: true } },
          bankMatch: { include: { match: { include: { lines: { select: { txDate: true } }, entries: { include: { ledgerEntry: { select: { txDate: true } } } } } } } },
        },
        orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
      }),
    ]);
    type MatchDates = { lines: { txDate: Date }[]; entries: { ledgerEntry: { txDate: Date } }[] };
    const clearedOn = (m: MatchDates | null | undefined) => {
      if (!m) return null;
      const all = [...m.lines.map((l) => iso(l.txDate)), ...m.entries.map((e) => iso(e.ledgerEntry.txDate))];
      return all.sort().at(-1)!;
    };
    const ledgerItems = entries
      .map((e) => ({ row: e, item: { txDate: iso(e.txDate), amount: this.entryAmount(account, e), clearedOn: clearedOn(e.bankMatch?.match) } as ReconItem }))
      .filter((x) => x.item.amount !== 0n);
    const statementItems = lines.map((l) => ({ row: l, item: { txDate: iso(l.txDate), amount: units(l.amount), clearedOn: clearedOn(l.match) } as ReconItem }));
    const statementBalance = statementLine?.balance ? units(statementLine.balance) : 0n;
    const r = reconcile(
      asAt,
      statementBalance,
      ledgerBalance,
      ledgerItems.map((x) => x.item),
      statementItems.map((x) => x.item),
    );
    return {
      account: this.summary(account),
      asAt,
      statementDate: statementLine ? iso(statementLine.txDate) : null,
      statementBalance: statementLine ? money(r.statementBalance) : null,
      depositsInTransit: money(r.depositsInTransit),
      unpresentedPayments: money(r.unpresentedPayments),
      bankMoneyIn: money(r.bankMoneyIn),
      bankMoneyOut: money(r.bankMoneyOut),
      adjustedBalance: money(r.adjustedBalance),
      ledgerBalance: money(r.ledgerBalance),
      difference: money(r.difference),
      outstandingEntries: ledgerItems.filter((x) => outstanding(x.item, asAt)).map((x) => this.entryOut(account, x.row)),
      outstandingLines: statementItems.filter((x) => outstanding(x.item, asAt)).map((x) => this.lineOut(x.row)),
    };
  }

  /** Ledger balance of the bank account in its own currency, up to a date (or all time) */
  private async ledgerBalance(account: BankLike, end: Date | null) {
    const foreign = account.currencyCode !== account.company.homeCurrency;
    const sum = await this.prisma.ledgerEntry.aggregate({
      where: { accountId: account.glAccountId, ...(end ? { txDate: { lte: end } } : {}) },
      _sum: foreign ? { foreignDebit: true, foreignCredit: true } : { debit: true, credit: true },
    });
    const s = sum._sum as Record<string, Prisma.Decimal | null>;
    const dr = foreign ? s.foreignDebit : s.debit;
    const cr = foreign ? s.foreignCredit : s.credit;
    return (dr ? units(dr) : 0n) - (cr ? units(cr) : 0n);
  }

  private async openEntries(account: BankLike & { reconcileFrom: Date }, end: Date | null): Promise<EntryRow[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        accountId: account.glAccountId,
        bankMatch: null,
        txDate: { gte: account.reconcileFrom, ...(end ? { lte: end } : {}) },
      },
      include: { batch: { select: { auditNo: true, reference: true, description: true } } },
      orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
    });
    return rows.filter((e) => this.entryAmount(account, e) !== 0n);
  }

  /** What the row did to the bank balance, in the bank account's currency: money in is positive */
  private entryAmount(account: { currencyCode: string; company: { homeCurrency: string } }, e: { debit: Prisma.Decimal; credit: Prisma.Decimal; foreignDebit: Prisma.Decimal; foreignCredit: Prisma.Decimal; currencyCode: string }) {
    if (account.currencyCode === account.company.homeCurrency) return units(e.debit) - units(e.credit);
    return e.currencyCode === account.currencyCode ? units(e.foreignDebit) - units(e.foreignCredit) : 0n;
  }

  private lineOut(l: { id: number; txDate: Date; description: string; reference: string | null; amount: Prisma.Decimal; balance: Prisma.Decimal | null; matchId: number | null }) {
    return { id: l.id, txDate: iso(l.txDate), description: l.description, reference: l.reference, amount: l.amount.toFixed(4), balance: l.balance?.toFixed(4) ?? null, matchId: l.matchId };
  }

  private entryOut(account: Account, e: EntryRow) {
    return {
      id: e.id.toString(),
      txDate: iso(e.txDate),
      auditNo: e.batch.auditNo,
      description: e.description ?? e.batch.description,
      reference: e.batch.reference,
      amount: money(this.entryAmount(account, e)),
    };
  }

  private summary(a: Account) {
    return {
      id: a.id,
      name: a.name,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      currencyCode: a.currencyCode,
      reconcileFrom: iso(a.reconcileFrom),
      glAccount: { id: a.glAccount.id, code: a.glAccount.code, description: a.glAccount.description },
      csvLayout: a.csvLayout ? (JSON.parse(a.csvLayout) as StatementLayout) : null,
    };
  }

  private async account(companyCode: string, id: number): Promise<Account> {
    const company = await this.companies.byCode(companyCode);
    const account = await this.prisma.bankAccount.findFirst({ where: { id, companyId: company.id }, include: { glAccount: true, company: true } });
    if (!account) throw new NotFoundException(`No bank account ${id} in ${company.code}`);
    return account;
  }

  private async lastReviewed(bankAccountId: number) {
    const r = await this.prisma.bankReconciliation.findFirst({ where: { bankAccountId, reviewedAt: { not: null } }, orderBy: { asAt: 'desc' } });
    return r?.asAt ?? null;
  }

  private read(account: Account, file: UploadedStatement | undefined, layoutJson?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose or drop the statement file');
    if (file.size > MAX_STATEMENT_BYTES) throw new BadRequestException('The statement file is over 5 MB');
    if (!/\.(csv|txt)$/i.test(file.originalname)) {
      throw new BadRequestException('Export the statement from the bank as CSV (in Excel: File, Save As, CSV) and drop that file');
    }
    if (file.buffer.includes(0)) throw new BadRequestException('This is not a text CSV file');
    const rows = parseCsv(file.buffer.toString('utf8'));
    let layout: StatementLayout | null = null;
    if (layoutJson) {
      let raw: unknown;
      try {
        raw = JSON.parse(layoutJson);
      } catch {
        throw new BadRequestException('The column layout is not valid JSON');
      }
      const holder = plainToInstance(LayoutHolder, { layout: raw });
      const errors = validateSync(holder, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) throw new BadRequestException('The column layout is incomplete');
      layout = holder.layout as StatementLayout;
    } else {
      const saved = account.csvLayout ? (JSON.parse(account.csvLayout) as StatementLayout) : null;
      // The remembered layout is used only if this file has the same headings
      layout = saved && rows[saved.headerRow]?.map((h) => h.trim()).includes(saved.date) ? saved : guessLayout(rows);
    }
    return { rows, layout, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  private lines(rows: string[][], layout: StatementLayout) {
    const { lines, problems } = readStatement(rows, layout);
    const ordered = inDateOrder(lines);
    const breaks = balanceBreaks(ordered);
    if (breaks.length) problems.push(`The running balance does not add up at row ${breaks.slice(0, 5).join(', ')}: check the amount and balance columns`);
    return { lines: ordered, problems };
  }

  /** Lines not already imported from an earlier, overlapping file */
  private async newLines(bankAccountId: number, lines: ParsedLine[]) {
    const seen = new Map<string, number>();
    const withPrints = lines.map((l) => {
      const key = [l.txDate, money(l.amount), l.description, l.reference ?? '', l.balance == null ? '' : money(l.balance)].join('|');
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { ...l, fingerprint: createHash('sha256').update(`${bankAccountId}|${key}|${n}`).digest('hex') };
    });
    const existing = new Set<string>();
    for (let i = 0; i < withPrints.length; i += 500) {
      const chunk = withPrints.slice(i, i + 500).map((l) => l.fingerprint);
      const found = await this.prisma.bankStatementLine.findMany({ where: { bankAccountId, fingerprint: { in: chunk } }, select: { fingerprint: true } });
      found.forEach((f) => existing.add(f.fingerprint));
    }
    const fresh = withPrints.filter((l) => !existing.has(l.fingerprint));
    return { fresh, skipped: withPrints.length - fresh.length };
  }

  /** The balance before a file's first line: given, or the last imported balance before it */
  private async openingFor(bankAccountId: number, lines: ParsedLine[], given?: string) {
    if (given != null && given !== '') return toUnits(given);
    if (!lines.length) return null;
    const before = await this.prisma.bankStatementLine.findFirst({
      where: { bankAccountId, txDate: { lt: toDate(lines[0].txDate) }, balance: { not: null } },
      orderBy: [{ txDate: 'desc' }, { statementId: 'desc' }, { lineNo: 'desc' }],
    });
    return before?.balance ? units(before.balance) : null;
  }

  private log(user: AuthUser, account: { id: number; companyId: number; name: string }, action: string, detail: object) {
    return this.audit.record({ userId: user.id, companyId: account.companyId, action, entity: 'BankAccount', entityId: account.id, label: account.name, detail });
  }
}
