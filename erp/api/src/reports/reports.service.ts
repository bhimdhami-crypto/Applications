import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartyKind } from '../common/constants';
import { fromUnits, toUnits } from '../common/money';
import { CompaniesService } from '../companies/companies.service';
import { toDate } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgeingItem, BUCKETS, Buckets, ageItems, emptyBuckets } from './ageing';

/** Most ledger rows one general ledger report returns; past this, pick an account or fewer dates */
const GL_ROW_LIMIT = 20_000;

const units = (d: Prisma.Decimal | null | undefined) => (d ? toUnits(d.toFixed(4)) : 0n);
const money = (u: bigint) => new Prisma.Decimal(fromUnits(u)).toFixed(2);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const bucketsOut = (b: Buckets) => Object.fromEntries(BUCKETS.map((k) => [k, money(b[k])])) as Record<keyof Buckets, string>;

const SUBLEDGER: Record<PartyKind, string> = { CUSTOMER: 'AR', SUPPLIER: 'AP' };

/** Read-only reports straight from the posted ledger. Balances are debit minus credit unless said otherwise. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  /** Every posting to each account in the dates given, with the opening balance and a running balance */
  async generalLedger(companyCode: string, from: string, to: string, accountCode?: string) {
    const company = await this.companies.byCode(companyCode);
    let accountId: number | undefined;
    if (accountCode) {
      const account = await this.prisma.glAccount.findUnique({ where: { companyId_code: { companyId: company.id, code: accountCode } } });
      if (!account) throw new NotFoundException(`No account ${accountCode}`);
      accountId = account.id;
    }
    const where = { companyId: company.id, accountId };
    const count = await this.prisma.ledgerEntry.count({ where: { ...where, txDate: { gte: toDate(from), lte: toDate(to) } } });
    if (count > GL_ROW_LIMIT) {
      throw new BadRequestException(`${count.toLocaleString()} postings in these dates; choose one account or a shorter period`);
    }

    const [openings, entries] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: { ...where, txDate: { lt: toDate(from) } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { ...where, txDate: { gte: toDate(from), lte: toDate(to) } },
        orderBy: [{ txDate: 'asc' }, { batchId: 'asc' }, { lineNo: 'asc' }],
        include: {
          batch: { select: { auditNo: true, reference: true, description: true, documentType: true, voucher: { select: { voucherNo: true } } } },
          party: { select: { code: true, name: true } },
        },
      }),
    ]);

    const opening = new Map(openings.map((o) => [o.accountId, units(o._sum.debit) - units(o._sum.credit)]));
    const ids = new Set([...opening.entries()].filter(([, v]) => v !== 0n).map(([id]) => id));
    for (const e of entries) ids.add(e.accountId);
    const accounts = await this.prisma.glAccount.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, description: true, type: true },
      orderBy: { code: 'asc' },
    });

    const byAccount = new Map<number, typeof entries>();
    for (const e of entries) byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);

    let totalDebit = 0n;
    let totalCredit = 0n;
    const report = accounts.map((a) => {
      let balance = opening.get(a.id) ?? 0n;
      const openingBalance = balance;
      let debit = 0n;
      let credit = 0n;
      const rows = (byAccount.get(a.id) ?? []).map((e) => {
        const dr = units(e.debit);
        const cr = units(e.credit);
        debit += dr;
        credit += cr;
        balance += dr - cr;
        return {
          txDate: iso(e.txDate),
          auditNo: e.batch.auditNo,
          voucherNo: e.batch.voucher?.voucherNo ?? null,
          reference: e.batch.reference,
          documentType: e.batch.documentType,
          description: e.description ?? e.batch.description,
          party: e.party ? `${e.party.code} · ${e.party.name}` : null,
          currencyCode: e.currencyCode,
          foreignAmount: e.currencyCode === company.homeCurrency ? null : money(units(e.foreignDebit) - units(e.foreignCredit)),
          debit: money(dr),
          credit: money(cr),
          balance: money(balance),
        };
      });
      totalDebit += debit;
      totalCredit += credit;
      return {
        accountId: a.id,
        code: a.code,
        description: a.description,
        type: a.type,
        opening: money(openingBalance),
        debit: money(debit),
        credit: money(credit),
        closing: money(balance),
        rows,
      };
    });

    return {
      company: company.code,
      currency: company.homeCurrency,
      from,
      to,
      accounts: report,
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
    };
  }

  /**
   * Aged debtors (customers) or creditors (suppliers) as at a date, checked against the control accounts:
   * the parties' balances must add up to the control accounts' balance, or the difference is shown.
   */
  async aged(companyCode: string, kind: PartyKind, asAt: string) {
    const company = await this.companies.byCode(companyCode);
    const asAtDate = toDate(asAt);
    const sign = kind === 'CUSTOMER' ? 1n : -1n; // suppliers: what we owe them is a credit
    const controls = await this.prisma.glAccount.findMany({
      where: { companyId: company.id, subledger: SUBLEDGER[kind] },
      select: { id: true, code: true, description: true },
    });
    const controlIds = controls.map((c) => c.id);

    const [entries, controlSum] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { companyId: company.id, accountId: { in: controlIds }, partyId: { not: null }, txDate: { lte: asAtDate } },
        select: {
          partyId: true,
          txDate: true,
          dueDate: true,
          debit: true,
          credit: true,
          description: true,
          batch: { select: { auditNo: true, reference: true, description: true } },
        },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { companyId: company.id, accountId: { in: controlIds }, txDate: { lte: asAtDate } },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const byParty = new Map<number, AgeingItem[]>();
    for (const e of entries) {
      const items = byParty.get(e.partyId!) ?? [];
      items.push({
        txDate: e.txDate,
        dueDate: e.dueDate ?? e.txDate,
        amount: sign * (units(e.debit) - units(e.credit)),
        auditNo: e.batch.auditNo,
        reference: e.batch.reference,
        description: e.description ?? e.batch.description,
      });
      byParty.set(e.partyId!, items);
    }
    const parties = await this.prisma.party.findMany({ where: { id: { in: [...byParty.keys()] } }, orderBy: { code: 'asc' } });

    const totals = emptyBuckets();
    let total = 0n;
    const rows = parties
      .map((p) => {
        const aged = ageItems(byParty.get(p.id)!, asAtDate);
        if (aged.balance === 0n && aged.open.length === 0) return null;
        for (const b of BUCKETS) totals[b] += aged.buckets[b];
        total += aged.balance;
        const limit = p.creditLimit ? units(p.creditLimit) : null;
        return {
          partyId: p.id,
          code: p.code,
          name: p.name,
          termsDays: p.termsDays,
          creditLimit: limit === null ? null : money(limit),
          overLimit: limit !== null && aged.balance > limit,
          ...bucketsOut(aged.buckets),
          balance: money(aged.balance),
        };
      })
      .filter((r) => r !== null);

    const control = sign * (units(controlSum._sum.debit) - units(controlSum._sum.credit));
    return {
      company: company.code,
      currency: company.homeCurrency,
      kind,
      asAt,
      controlAccounts: controls.map((c) => `${c.code} · ${c.description}`),
      rows,
      totals: bucketsOut(totals),
      total: money(total),
      controlBalance: money(control),
      difference: money(control - total),
    };
  }

  /** A customer or supplier's account: opening balance, each posting with a running balance, and what is overdue */
  async statement(companyCode: string, partyId: number, from: string, to: string) {
    const company = await this.companies.byCode(companyCode);
    const party = await this.prisma.party.findFirst({ where: { id: partyId, companyId: company.id } });
    if (!party) throw new NotFoundException(`No customer or supplier id ${partyId}`);
    const sign = party.kind === 'CUSTOMER' ? 1n : -1n;
    const where = { companyId: company.id, partyId, account: { subledger: SUBLEDGER[party.kind as PartyKind] } };

    const [before, entries, upToEnd] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { ...where, txDate: { lt: toDate(from) } }, _sum: { debit: true, credit: true } }),
      this.prisma.ledgerEntry.findMany({
        where: { ...where, txDate: { gte: toDate(from), lte: toDate(to) } },
        orderBy: [{ txDate: 'asc' }, { batchId: 'asc' }, { lineNo: 'asc' }],
        include: { batch: { select: { auditNo: true, reference: true, description: true, voucher: { select: { voucherNo: true } } } } },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { ...where, txDate: { lte: toDate(to) } },
        select: { txDate: true, dueDate: true, debit: true, credit: true, description: true, batch: { select: { auditNo: true, reference: true, description: true } } },
      }),
    ]);

    const opening = sign * (units(before._sum.debit) - units(before._sum.credit));
    let balance = opening;
    const rows = entries.map((e) => {
      const dr = units(e.debit);
      const cr = units(e.credit);
      balance += sign * (dr - cr);
      return {
        txDate: iso(e.txDate),
        dueDate: iso(e.dueDate),
        auditNo: e.batch.auditNo,
        voucherNo: e.batch.voucher?.voucherNo ?? null,
        reference: e.batch.reference,
        description: e.description ?? e.batch.description,
        debit: money(dr),
        credit: money(cr),
        balance: money(balance),
      };
    });

    const aged = ageItems(
      upToEnd.map((e) => ({
        txDate: e.txDate,
        dueDate: e.dueDate ?? e.txDate,
        amount: sign * (units(e.debit) - units(e.credit)),
        auditNo: e.batch.auditNo,
        reference: e.batch.reference,
        description: e.description ?? e.batch.description,
      })),
      toDate(to),
    );

    return {
      company: company.code,
      currency: company.homeCurrency,
      party: { id: party.id, kind: party.kind, code: party.code, name: party.name, termsDays: party.termsDays, email: party.email },
      from,
      to,
      opening: money(opening),
      rows,
      closing: money(balance),
      ageing: bucketsOut(aged.buckets),
      openItems: aged.open.map((o) => ({
        txDate: iso(o.txDate),
        dueDate: iso(o.dueDate),
        auditNo: o.auditNo,
        reference: o.reference,
        description: o.description,
        amount: money(o.amount),
        open: money(o.open),
        daysOverdue: o.daysOverdue,
      })),
    };
  }
}
