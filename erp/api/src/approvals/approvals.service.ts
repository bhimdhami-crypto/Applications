import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { VOUCHER_TYPES, VoucherType } from '../common/constants';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { matrixProblems, staffingWarnings } from './approval-rules';
import { BandDto, SaveMatrixDto } from './approvals.dto';

const LABELS: Record<VoucherType, string> = { JOURNAL: 'Journals', REVERSAL: 'Reversals' };

const ruleInclude = {
  stages: { orderBy: { stageNo: 'asc' } },
  createdBy: { select: { name: true } },
  retiredBy: { select: { name: true } },
} satisfies Prisma.ApprovalRuleInclude;

type RuleRow = Prisma.ApprovalRuleGetPayload<{ include: typeof ruleInclude }>;

const amount = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

function band(r: RuleRow) {
  return {
    id: r.id,
    name: r.name,
    sopReference: r.sopReference,
    minAmount: amount(r.minAmount)!,
    maxAmount: amount(r.maxAmount),
    stages: r.stages.map((s) => ({ stageNo: s.stageNo, name: s.name, approverRole: s.approverRole })),
    createdAt: r.createdAt,
    createdBy: r.createdBy?.name ?? null,
    retiredAt: r.retiredAt,
    retiredBy: r.retiredBy?.name ?? null,
  };
}

/** Same route: amounts, name, SOP reference and stages all equal, so the rule can stay as it is */
function sameRoute(r: RuleRow, b: BandDto) {
  return (
    Number(r.minAmount) === Number(b.minAmount) &&
    (r.maxAmount === null ? b.maxAmount === null : b.maxAmount !== null && Number(r.maxAmount) === Number(b.maxAmount)) &&
    r.name === b.name &&
    (r.sopReference ?? '') === (b.sopReference ?? '') &&
    r.stages.length === b.stages.length &&
    r.stages.every((s, i) => s.name === b.stages[i].name && s.approverRole === b.stages[i].approverRole)
  );
}

/**
 * The approval matrix: for each document type, the amount bands and who approves in which order.
 * Rules are never edited in place. Saving a document type's matrix retires the rules that changed and
 * creates their replacements in one transaction, so a voucher already on its way finishes the route
 * it started, and the history shows every version with who made it and why.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  async active(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    const rules = await this.prisma.approvalRule.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: [{ documentType: 'asc' }, { minAmount: 'asc' }],
      include: ruleInclude,
    });
    return rules.map(band);
  }

  async matrix(companyCode: string) {
    const company = await this.companies.byCode(companyCode);
    const [rules, retired, staff, inFlight] = await Promise.all([
      this.prisma.approvalRule.findMany({
        where: { companyId: company.id, isActive: true },
        orderBy: { minAmount: 'asc' },
        include: ruleInclude,
      }),
      this.prisma.approvalRule.findMany({
        where: { companyId: company.id, isActive: false },
        orderBy: { retiredAt: 'desc' },
        take: 50,
        include: ruleInclude,
      }),
      this.prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: true }),
      this.prisma.voucher.groupBy({ by: ['ruleId'], where: { companyId: company.id, status: 'SUBMITTED' }, _count: true }),
    ]);
    const usersByRole = Object.fromEntries(staff.map((s) => [s.role, s._count]));
    const waiting = new Map(inFlight.map((v) => [v.ruleId, v._count]));

    return {
      company: company.code,
      currency: company.homeCurrency,
      usersByRole,
      documentTypes: VOUCHER_TYPES.map((documentType) => {
        const bands = rules.filter((r) => r.documentType === documentType).map(band);
        return {
          documentType,
          label: LABELS[documentType],
          bands: bands.map((b) => ({ ...b, waiting: waiting.get(b.id) ?? 0 })),
          problems: matrixProblems(bands),
          warnings: staffingWarnings(bands, usersByRole),
        };
      }),
      history: retired.map((r) => ({ ...band(r), documentType: r.documentType, waiting: waiting.get(r.id) ?? 0 })),
    };
  }

  async saveMatrix(companyCode: string, documentType: VoucherType, user: AuthUser, dto: SaveMatrixDto) {
    const company = await this.companies.byCode(companyCode);
    const problems = matrixProblems(dto.bands);
    if (problems.length) throw new BadRequestException(problems.join('. '));
    const bands = [...dto.bands].sort((a, b) => Number(a.minAmount) - Number(b.minAmount));

    const changes = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.approvalRule.findMany({
          where: { companyId: company.id, documentType, isActive: true },
          include: ruleInclude,
        });
        const kept = new Set<number>();
        const created: number[] = [];
        for (const b of bands) {
          const same = current.find((r) => !kept.has(r.id) && sameRoute(r, b));
          if (same) {
            kept.add(same.id);
            continue;
          }
          const rule = await tx.approvalRule.create({
            data: {
              companyId: company.id,
              documentType,
              name: b.name,
              sopReference: b.sopReference || null,
              minAmount: b.minAmount,
              maxAmount: b.maxAmount,
              createdById: user.id,
              stages: { create: b.stages.map((s, i) => ({ stageNo: i + 1, name: s.name, approverRole: s.approverRole })) },
            },
          });
          created.push(rule.id);
        }
        const retired = current.filter((r) => !kept.has(r.id));
        if (retired.length) {
          await tx.approvalRule.updateMany({
            where: { id: { in: retired.map((r) => r.id) } },
            data: { isActive: false, retiredAt: new Date(), retiredById: user.id },
          });
        }
        if (created.length || retired.length) {
          await this.audit.record(
            user.id,
            'approval.matrix_changed',
            'ApprovalRule',
            `${company.code}/${documentType}`,
            { reason: dto.reason, retired: retired.map(band), created, bands },
            tx,
          );
        }
        return { created: created.length, retired: retired.length, kept: kept.size };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { ...changes, matrix: await this.matrix(companyCode) };
  }
}
