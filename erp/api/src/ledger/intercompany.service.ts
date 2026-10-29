import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIntercompanyLinkDto } from './ledger.dto';
import { toDate } from './ledger.service';

/** The current accounts that link sister companies, and the check that both sides agree */
@Injectable()
export class IntercompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  async links(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.intercompanyLink.findMany({
      where: { companyId: company.id },
      include: { partnerCompany: { select: { code: true, name: true } }, account: { select: { code: true, description: true } } },
    });
  }

  async createLink(companyCode: string, user: AuthUser, dto: CreateIntercompanyLinkDto) {
    const company = await this.companies.byCode(companyCode);
    const partner = await this.companies.byCode(dto.partnerCode);
    if (partner.id === company.id) throw new BadRequestException('A company cannot link to itself');
    const account = await this.prisma.glAccount.findFirst({ where: { id: dto.accountId, companyId: company.id } });
    if (!account) throw new BadRequestException(`Account id ${dto.accountId} is not in ${company.code}`);
    if (!account.isPostable) throw new BadRequestException(`Account ${account.code} is a header account`);
    try {
      const link = await this.prisma.intercompanyLink.create({
        data: { companyId: company.id, partnerCompanyId: partner.id, accountId: account.id },
      });
      await this.audit.record(user.id, 'ic.link_created', 'IntercompanyLink', link.id, { company: company.code, partner: partner.code, account: account.code });
      return link;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`${company.code} already has a current account with ${partner.code}`);
      }
      throw e;
    }
  }

  /**
   * For every linked pair, each side's current account balance up to a date. One company's receivable is
   * the other's payable, so the two balances should add up to zero; anything else is a difference to clear.
   */
  async reconciliation(to: string) {
    const links = await this.prisma.intercompanyLink.findMany({
      include: { company: { select: { code: true } }, partnerCompany: { select: { code: true } }, account: { select: { code: true } } },
    });
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: links.map((l) => l.accountId) }, txDate: { lte: toDate(to) } },
      _sum: { debit: true, credit: true },
    });
    const zero = new Prisma.Decimal(0);
    const balance = new Map(sums.map((s) => [s.accountId, (s._sum.debit ?? zero).minus(s._sum.credit ?? zero)]));
    const byPair = new Map(links.map((l) => [`${l.companyId}>${l.partnerCompanyId}`, l]));

    const rows = [];
    for (const l of links) {
      if (l.companyId > l.partnerCompanyId) continue; // each pair once
      const other = byPair.get(`${l.partnerCompanyId}>${l.companyId}`);
      const mine = balance.get(l.accountId) ?? zero;
      const theirs = other ? (balance.get(other.accountId) ?? zero) : zero;
      rows.push({
        company: l.company.code,
        account: l.account.code,
        balance: mine.toFixed(2),
        partner: l.partnerCompany.code,
        partnerAccount: other?.account.code ?? null,
        partnerBalance: theirs.toFixed(2),
        difference: mine.plus(theirs).toFixed(2),
        agrees: other !== undefined && mine.plus(theirs).isZero(),
      });
    }
    return { to, rows };
  }
}
