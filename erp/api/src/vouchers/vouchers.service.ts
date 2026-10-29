import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Voucher, VoucherLine } from '@prisma/client';
import { approvalBlocker, selectRule } from '../approvals/approval-rules';
import { ArchiveService, UploadedFile } from '../archive/archive.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { fromUnits, toUnits } from '../common/money';
import { CompaniesService } from '../companies/companies.service';
import { IntercompanyError, IntercompanyLineInput, LinkMap, linkKey, planIntercompany } from '../ledger/intercompany';
import { LedgerService, Tx, toDate } from '../ledger/ledger.service';
import { PostingRuleError, PreparedLine, prepareLines } from '../ledger/posting-rules';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApprovalRuleDto, SaveVoucherDto, VoucherLineDto } from './vouchers.dto';

const EDITABLE = ['DRAFT', 'REJECTED'];

type CompanyRow = Prisma.CompanyGetPayload<{ include: { currency: true } }>;

/** What each company will post for a voucher, worked out from its lines */
interface Plan {
  own: PreparedLine[];
  partners: Array<{ company: CompanyRow; lines: PreparedLine[] }>;
  total: bigint;
}

/**
 * Vouchers carry every transaction from draft to ledger. A voucher is drafted (typed in, or created by
 * dropping files into the inbox), submitted, approved stage by stage under the company's approval rule,
 * and posted by the last approval. Rejection sends it back to its author with a reason.
 */
@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly ledger: LedgerService,
    private readonly archive: ArchiveService,
    private readonly audit: AuditService,
  ) {}

  async create(companyCode: string, user: AuthUser, dto: SaveVoucherDto) {
    const company = await this.companies.byCode(companyCode);
    const lines = await this.toLineRows(company.id, dto.lines);
    const voucher = await this.prisma.$transaction(async (tx) =>
      tx.voucher.create({
        data: {
          companyId: company.id,
          voucherNo: await this.ledger.nextNumber(tx, company.id, 'VOUCHER', 'JV'),
          documentType: 'JOURNAL',
          status: 'DRAFT',
          txDate: toDate(dto.txDate),
          description: dto.description,
          reference: dto.reference,
          createdById: user.id,
          lines: { create: lines },
        },
      }),
    );
    await this.audit.record(user.id, 'voucher.created', 'Voucher', voucher.id, { voucherNo: voucher.voucherNo });
    return this.get(companyCode, voucher.voucherNo);
  }

  /** Files dropped on the inbox become a draft voucher with the files attached; lines are added next */
  async inbox(companyCode: string, user: AuthUser, files: UploadedFile[], description?: string) {
    const company = await this.companies.byCode(companyCode);
    if (!files?.length) throw new BadRequestException('Drop at least one file');
    const voucher = await this.prisma.$transaction(async (tx) =>
      tx.voucher.create({
        data: {
          companyId: company.id,
          voucherNo: await this.ledger.nextNumber(tx, company.id, 'VOUCHER', 'JV'),
          documentType: 'JOURNAL',
          status: 'DRAFT',
          txDate: toDate(new Date().toISOString()),
          description: (description || files.map((f) => f.originalname).join(', ')).slice(0, 400),
          createdById: user.id,
        },
      }),
    );
    try {
      await this.archive.attach(company.id, company.code, voucher.id, user, files);
    } catch (e) {
      await this.prisma.voucher.delete({ where: { id: voucher.id } });
      throw e;
    }
    await this.audit.record(user.id, 'voucher.created_from_files', 'Voucher', voucher.id, { voucherNo: voucher.voucherNo });
    return this.get(companyCode, voucher.voucherNo);
  }

  async update(companyCode: string, voucherNo: string, user: AuthUser, dto: SaveVoucherDto) {
    const { company, voucher } = await this.load(companyCode, voucherNo);
    this.mustBeAuthor(voucher, user);
    if (!EDITABLE.includes(voucher.status)) throw new ConflictException(`${voucherNo} is ${voucher.status} and cannot be edited`);
    if (voucher.documentType === 'REVERSAL') throw new ConflictException('A reversal copies its journal and cannot be edited');
    const lines = await this.toLineRows(company.id, dto.lines);
    await this.prisma.$transaction([
      this.prisma.voucherLine.deleteMany({ where: { voucherId: voucher.id } }),
      this.prisma.voucher.update({
        where: { id: voucher.id },
        data: {
          txDate: toDate(dto.txDate),
          description: dto.description,
          reference: dto.reference,
          lines: { create: lines },
        },
      }),
    ]);
    await this.audit.record(user.id, 'voucher.updated', 'Voucher', voucher.id);
    return this.get(companyCode, voucherNo);
  }

  /** Checks the voucher would post (balance, periods, accounts in every company), then starts its approval route */
  async submit(companyCode: string, voucherNo: string, user: AuthUser, comment?: string) {
    const { company, voucher } = await this.load(companyCode, voucherNo);
    this.mustBeAuthor(voucher, user);
    if (!EDITABLE.includes(voucher.status)) throw new ConflictException(`${voucherNo} is ${voucher.status}`);

    await this.prisma.$transaction(async (tx) => {
      const plan = await this.plan(tx, company, voucher);
      await this.ledger.checkPostable(tx, company.id, voucher.txDate, plan.own);
      for (const p of plan.partners) await this.ledger.checkPostable(tx, p.company.id, voucher.txDate, p.lines);
      if (voucher.reversesBatchId) await this.checkReversible(tx, voucher.reversesBatchId, voucher.id);

      const total = Number(fromUnits(plan.total));
      const rules = await tx.approvalRule.findMany({ where: { companyId: company.id, documentType: voucher.documentType } });
      const rule = selectRule(
        rules.map((r) => ({ ...r, minAmount: r.minAmount.toString(), maxAmount: r.maxAmount?.toString() ?? null })),
        voucher.documentType,
        total,
      );
      if (!rule) {
        throw new BadRequestException(
          `No approval rule covers a ${voucher.documentType} of ${company.homeCurrency} ${total.toFixed(2)} in ${company.code}; an administrator must set one up`,
        );
      }
      const stages = await tx.approvalRuleStage.count({ where: { ruleId: rule.id } });
      if (!stages) throw new BadRequestException(`Approval rule "${rule.name}" has no stages`);

      await tx.voucher.update({
        where: { id: voucher.id },
        data: { status: 'SUBMITTED', ruleId: rule.id, currentStage: 1, totalAmount: fromUnits(plan.total), submittedAt: new Date() },
      });
      await tx.approvalAction.create({ data: { voucherId: voucher.id, action: 'SUBMITTED', userId: user.id, comment } });
    });
    await this.audit.record(user.id, 'voucher.submitted', 'Voucher', voucher.id);
    return this.get(companyCode, voucherNo);
  }

  /** Approves the current stage; the last stage posts the voucher in the same transaction */
  async approve(companyCode: string, voucherNo: string, user: AuthUser, comment?: string) {
    const { company } = await this.load(companyCode, voucherNo);
    await this.prisma.$transaction(
      async (tx) => {
        // Re-read inside the transaction so two approvers cannot both act on the same stage
        const voucher = await tx.voucher.findUniqueOrThrow({
          where: { companyId_voucherNo: { companyId: company.id, voucherNo } },
          include: { lines: { orderBy: { lineNo: 'asc' } }, actions: { orderBy: { id: 'asc' } } },
        });
        const stage = await this.currentStage(tx, voucher, user);
        const stageCount = await tx.approvalRuleStage.count({ where: { ruleId: voucher.ruleId! } });
        await tx.approvalAction.create({
          data: { voucherId: voucher.id, stageNo: stage.stageNo, action: 'APPROVED', userId: user.id, comment },
        });

        if (stage.stageNo < stageCount) {
          await tx.voucher.update({ where: { id: voucher.id }, data: { currentStage: stage.stageNo + 1 } });
          return;
        }
        const batchId = await this.post(tx, company, voucher, user.id);
        await tx.voucher.update({ where: { id: voucher.id }, data: { status: 'POSTED', currentStage: null, postedBatchId: batchId } });
        await tx.approvalAction.create({ data: { voucherId: voucher.id, action: 'POSTED', userId: user.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
    );
    await this.audit.record(user.id, 'voucher.approved', 'Voucher', voucherNo);
    return this.get(companyCode, voucherNo);
  }

  async reject(companyCode: string, voucherNo: string, user: AuthUser, comment: string) {
    const { company } = await this.load(companyCode, voucherNo);
    await this.prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.findUniqueOrThrow({
        where: { companyId_voucherNo: { companyId: company.id, voucherNo } },
        include: { actions: { orderBy: { id: 'asc' } } },
      });
      const stage = await this.currentStage(tx, voucher, user);
      await tx.approvalAction.create({ data: { voucherId: voucher.id, stageNo: stage.stageNo, action: 'REJECTED', userId: user.id, comment } });
      await tx.voucher.update({ where: { id: voucher.id }, data: { status: 'REJECTED', currentStage: null } });
    });
    await this.audit.record(user.id, 'voucher.rejected', 'Voucher', voucherNo, { comment });
    return this.get(companyCode, voucherNo);
  }

  /** The author takes a submitted voucher back to change it; approvals so far are cancelled */
  async recall(companyCode: string, voucherNo: string, user: AuthUser) {
    const { voucher } = await this.load(companyCode, voucherNo);
    this.mustBeAuthor(voucher, user);
    if (voucher.status !== 'SUBMITTED') throw new ConflictException(`${voucherNo} is not waiting for approval`);
    await this.prisma.$transaction([
      this.prisma.voucher.update({ where: { id: voucher.id }, data: { status: 'DRAFT', currentStage: null } }),
      this.prisma.approvalAction.create({ data: { voucherId: voucher.id, action: 'RECALLED', userId: user.id } }),
    ]);
    return this.get(companyCode, voucherNo);
  }

  async cancel(companyCode: string, voucherNo: string, user: AuthUser) {
    const { voucher } = await this.load(companyCode, voucherNo);
    this.mustBeAuthor(voucher, user);
    if (!EDITABLE.includes(voucher.status)) throw new ConflictException(`${voucherNo} is ${voucher.status} and cannot be cancelled`);
    await this.prisma.voucher.update({ where: { id: voucher.id }, data: { status: 'CANCELLED' } });
    await this.audit.record(user.id, 'voucher.cancelled', 'Voucher', voucher.id);
    return this.get(companyCode, voucherNo);
  }

  /** Starts a draft that reverses a posted journal line for line; it then goes through approval like any voucher */
  async reverse(companyCode: string, auditNo: string, user: AuthUser, txDate?: string) {
    const company = await this.companies.byCode(companyCode);
    const batch = await this.prisma.postingBatch.findUnique({
      where: { companyId_auditNo: { companyId: company.id, auditNo } },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    });
    if (!batch) throw new NotFoundException(`No journal ${auditNo}`);
    await this.checkReversible(this.prisma, batch.id);

    const voucher = await this.prisma.$transaction(async (tx) =>
      tx.voucher.create({
        data: {
          companyId: company.id,
          voucherNo: await this.ledger.nextNumber(tx, company.id, 'VOUCHER', 'JV'),
          documentType: 'REVERSAL',
          status: 'DRAFT',
          txDate: txDate ? toDate(txDate) : batch.txDate,
          description: `Reversal of ${auditNo}: ${batch.description}`.slice(0, 400),
          reference: batch.reference,
          reversesBatchId: batch.id,
          createdById: user.id,
          lines: {
            create: batch.entries.map((e) => {
              const foreign = e.currencyCode !== company.homeCurrency;
              return {
                lineNo: e.lineNo,
                accountId: e.accountId,
                debit: foreign || e.credit.isZero() ? null : e.credit,
                credit: foreign || e.debit.isZero() ? null : e.debit,
                currencyCode: foreign ? e.currencyCode : null,
                exchangeRate: foreign ? e.exchangeRate : null,
                // Reversed side: what was a debit is now a credit, so the sign flips
                foreignAmount: foreign ? e.foreignCredit.minus(e.foreignDebit) : null,
                description: e.description,
                projectId: e.projectId,
                taxCodeId: e.taxCodeId,
              };
            }),
          },
        },
      }),
    );
    await this.audit.record(user.id, 'voucher.reversal_drafted', 'Voucher', voucher.id, { auditNo });
    return this.get(companyCode, voucher.voucherNo);
  }

  async attach(companyCode: string, voucherNo: string, user: AuthUser, files: UploadedFile[], description?: string) {
    const { company, voucher } = await this.load(companyCode, voucherNo);
    if (voucher.status === 'CANCELLED') throw new ConflictException(`${voucherNo} is cancelled`);
    // Supporting documents can be added at any stage, including after posting
    await this.archive.attach(company.id, company.code, voucher.id, user, files, description);
    return this.archive.forVoucher(voucher.id);
  }

  async removeAttachment(companyCode: string, voucherNo: string, attachmentId: number, user: AuthUser) {
    const { voucher } = await this.load(companyCode, voucherNo);
    this.mustBeAuthor(voucher, user);
    if (!EDITABLE.includes(voucher.status)) {
      throw new ConflictException('Files stay archived once a voucher is submitted or posted');
    }
    const file = await this.prisma.attachment.findFirst({ where: { id: attachmentId, entityType: 'VOUCHER', entityId: voucher.id } });
    if (!file) throw new NotFoundException('No such file on this voucher');
    await this.archive.remove(file.id, user);
    return this.archive.forVoucher(voucher.id);
  }

  async get(companyCode: string, voucherNo: string) {
    const { voucher } = await this.load(companyCode, voucherNo);
    const full = await this.prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            account: { select: { code: true, description: true } },
            partnerCompany: { select: { code: true } },
            partnerAccount: { select: { code: true, description: true } },
          },
        },
        actions: { orderBy: { id: 'asc' }, include: { user: { select: { name: true } } } },
        rule: { include: { stages: { orderBy: { stageNo: 'asc' } } } },
        createdBy: { select: { name: true } },
        postedBatch: { select: { auditNo: true, intercompanyMirror: { select: { auditNo: true, companyId: true } } } },
      },
    });
    return { ...full, attachments: await this.archive.forVoucher(voucher.id) };
  }

  async list(companyCode: string, status?: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.voucher.findMany({
      where: { companyId: company.id, status },
      orderBy: { id: 'desc' },
      take: 200,
      include: { createdBy: { select: { name: true } } },
    });
  }

  /** Vouchers in any company waiting at a stage this user may approve, oldest first */
  async pending(user: AuthUser) {
    const waiting = await this.prisma.voucher.findMany({
      where: { status: 'SUBMITTED', createdById: { not: user.id } },
      orderBy: { submittedAt: 'asc' },
      include: {
        company: { select: { code: true } },
        createdBy: { select: { name: true } },
        rule: { include: { stages: true } },
        actions: { orderBy: { id: 'asc' } },
      },
    });
    return waiting
      .filter((v) => {
        const stage = v.rule?.stages.find((s) => s.stageNo === v.currentStage);
        return stage && !approvalBlocker(stage, user, v, v.actions);
      })
      .map(({ actions, rule, ...v }) => ({ ...v, stage: rule?.stages.find((s) => s.stageNo === v.currentStage)?.name, sopReference: rule?.sopReference }));
  }

  async rules(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    return this.prisma.approvalRule.findMany({
      where: { companyId: company.id },
      orderBy: [{ documentType: 'asc' }, { minAmount: 'asc' }],
      include: { stages: { orderBy: { stageNo: 'asc' } } },
    });
  }

  async createRule(companyCode: string, user: AuthUser, dto: CreateApprovalRuleDto) {
    const company = await this.companies.byCode(companyCode);
    if (!dto.stages.length) throw new BadRequestException('An approval rule needs at least one stage');
    if (dto.maxAmount && toUnits(dto.maxAmount) <= toUnits(dto.minAmount)) {
      throw new BadRequestException('maxAmount must be above minAmount');
    }
    const rule = await this.prisma.approvalRule.create({
      data: {
        companyId: company.id,
        documentType: dto.documentType,
        name: dto.name,
        sopReference: dto.sopReference,
        minAmount: dto.minAmount,
        maxAmount: dto.maxAmount,
        stages: { create: dto.stages.map((s, i) => ({ stageNo: i + 1, name: s.name, approverRole: s.approverRole })) },
      },
      include: { stages: true },
    });
    await this.audit.record(user.id, 'approval.rule_created', 'ApprovalRule', rule.id, dto);
    return rule;
  }

  private async load(companyCode: string, voucherNo: string) {
    const company = await this.companies.byCode(companyCode);
    const voucher = await this.prisma.voucher.findUnique({
      where: { companyId_voucherNo: { companyId: company.id, voucherNo } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!voucher) throw new NotFoundException(`No voucher ${voucherNo}`);
    return { company, voucher };
  }

  private mustBeAuthor(voucher: Voucher, user: AuthUser) {
    if (voucher.createdById !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only the author can change, submit or withdraw this voucher');
    }
  }

  private async currentStage(tx: Tx, voucher: Voucher & { actions: { action: string; stageNo: number | null; userId: number }[] }, user: AuthUser) {
    if (voucher.status !== 'SUBMITTED' || !voucher.ruleId || !voucher.currentStage) {
      throw new ConflictException(`${voucher.voucherNo} is not waiting for approval`);
    }
    const stage = await tx.approvalRuleStage.findUniqueOrThrow({
      where: { ruleId_stageNo: { ruleId: voucher.ruleId, stageNo: voucher.currentStage } },
    });
    const blocker = approvalBlocker(stage, user, voucher, voucher.actions);
    if (blocker) throw new ForbiddenException(blocker);
    return stage;
  }

  /** Writes the voucher to the ledger: its own batch, plus a linked batch in each partner company */
  private async post(tx: Tx, company: CompanyRow, voucher: Voucher & { lines: VoucherLine[] }, userId: number) {
    const plan = await this.plan(tx, company, voucher);
    const reference = voucher.reference ?? voucher.voucherNo;
    const batch = await this.ledger.postInTx(
      tx,
      userId,
      {
        companyId: company.id,
        source: 'GL',
        documentType: voucher.documentType,
        description: voucher.description,
        reference,
        txDate: voucher.txDate,
        reversesId: voucher.reversesBatchId ?? undefined,
      },
      plan.own,
    );
    for (const p of plan.partners) {
      await this.ledger.postInTx(
        tx,
        userId,
        {
          companyId: p.company.id,
          source: 'IC',
          documentType: 'INTERCOMPANY',
          description: `${company.code} ${voucher.voucherNo}: ${voucher.description}`.slice(0, 400),
          reference: batch.auditNo,
          txDate: voucher.txDate,
          intercompanyOfId: batch.id,
        },
        p.lines,
      );
    }
    return batch.id;
  }

  private async plan(tx: Tx, company: CompanyRow, voucher: Voucher & { lines: VoucherLine[] }): Promise<Plan> {
    if (voucher.lines.length < 2) throw new BadRequestException('Add at least two lines before submitting');
    const inputs: IntercompanyLineInput[] = voucher.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit?.toFixed(4),
      credit: l.credit?.toFixed(4),
      currencyCode: l.currencyCode ?? undefined,
      exchangeRate: l.exchangeRate?.toFixed(6),
      foreignAmount: l.foreignAmount?.toFixed(4),
      description: l.description ?? undefined,
      projectId: l.projectId ?? undefined,
      taxCodeId: l.taxCodeId ?? undefined,
      partnerCompanyId: l.partnerCompanyId ?? undefined,
      partnerAccountId: l.partnerAccountId ?? undefined,
    }));
    const links: LinkMap = new Map(
      (await tx.intercompanyLink.findMany()).map((l) => [linkKey(l.companyId, l.partnerCompanyId), l.accountId]),
    );
    try {
      const split = planIntercompany(company.id, inputs, links);
      const own = prepareLines(split.own, company.homeCurrency, company.currency.decimals);
      const partners = [];
      for (const [partnerId, lines] of split.partners) {
        const partner = await tx.company.findUniqueOrThrow({ where: { id: partnerId }, include: { currency: true } });
        partners.push({ company: partner, lines: prepareLines(lines, partner.homeCurrency, partner.currency.decimals) });
      }
      const total = own.reduce((sum, l) => sum + toUnits(l.debit), 0n);
      return { own, partners, total };
    } catch (e) {
      if (e instanceof PostingRuleError || e instanceof IntercompanyError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private async checkReversible(db: Tx, batchId: number, ignoreVoucherId?: number) {
    const batch = await db.postingBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { reversedBy: true, intercompanyMirror: { select: { id: true } } },
    });
    if (batch.reversedBy) throw new ConflictException(`${batch.auditNo} was already reversed by ${batch.reversedBy.auditNo}`);
    if (batch.reversesId) throw new ConflictException(`${batch.auditNo} is itself a reversal`);
    if (batch.intercompanyOfId || batch.intercompanyMirror.length) {
      throw new ConflictException(`${batch.auditNo} is part of an intercompany posting; correct it with a new intercompany voucher`);
    }
    const open = await db.voucher.findFirst({
      where: { reversesBatchId: batchId, status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] }, id: { not: ignoreVoucherId } },
    });
    if (open) throw new ConflictException(`${open.voucherNo} already reverses ${batch.auditNo}`);
  }

  /**
   * Draft lines: accounts must belong to the company, and an intercompany line's account to its partner.
   * An intercompany line's own side is always the current account with that partner.
   */
  private async toLineRows(companyId: number, lines: VoucherLineDto[]) {
    const rows = [];
    for (const [i, l] of lines.entries()) {
      let accountId = l.accountId;
      let partnerCompanyId: number | undefined;
      if (l.partnerCompany || l.partnerAccountId) {
        if (!l.partnerCompany || !l.partnerAccountId) {
          throw new BadRequestException(`Line ${i + 1}: an intercompany line needs partnerCompany and partnerAccountId`);
        }
        const partner = await this.companies.byCode(l.partnerCompany);
        const account = await this.prisma.glAccount.findFirst({ where: { id: l.partnerAccountId, companyId: partner.id } });
        if (!account) throw new BadRequestException(`Line ${i + 1}: account id ${l.partnerAccountId} is not in ${partner.code}`);
        const link = await this.prisma.intercompanyLink.findUnique({
          where: { companyId_partnerCompanyId: { companyId, partnerCompanyId: partner.id } },
        });
        if (!link) throw new BadRequestException(`Line ${i + 1}: set up the current account with ${partner.code} first`);
        accountId = link.accountId;
        partnerCompanyId = partner.id;
      }
      if (!accountId) throw new BadRequestException(`Line ${i + 1}: choose an account`);
      rows.push({
        lineNo: i + 1,
        accountId,
        debit: l.debit,
        credit: l.credit,
        currencyCode: l.currencyCode?.toUpperCase(),
        exchangeRate: l.exchangeRate,
        foreignAmount: l.foreignAmount,
        description: l.description,
        projectId: l.projectId,
        taxCodeId: l.taxCodeId,
        partnerCompanyId,
        partnerAccountId: l.partnerAccountId,
      });
    }
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const own = await this.prisma.glAccount.count({ where: { id: { in: accountIds }, companyId } });
    if (own !== accountIds.length) throw new BadRequestException('An account on this voucher is not in this company');
    return rows;
  }
}
