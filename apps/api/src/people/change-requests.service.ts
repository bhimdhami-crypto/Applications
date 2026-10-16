import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField, last4, masked } from '../common/field-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleAccess, today } from './people-access.service';
import { BankChangeDto, ChangeRequestQuery, DecisionDto } from './people.dto';

/**
 * Self-service changes that need HR approval before they apply. Bank details for now: a change
 * there redirects someone's pay, so a second person (HR with access to sensitive data) checks it.
 */
@Injectable()
export class ChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PeopleAccess,
  ) {}

  /** Companies where the caller can decide: they need both people.manage and people.sensitive.read */
  private deciderEntities(auth: AuthContext) {
    const sensitive = new Set(entityIds(auth, 'people.sensitive.read'));
    return entityIds(auth, 'people.manage').filter((id) => sensitive.has(id));
  }

  private present(r: Prisma.ChangeRequestGetPayload<{ include: { employment: { select: { id: true; employeeNumber: true; person: { select: { firstName: true; lastName: true } }; legalEntity: { select: { code: true; name: true } } } } } }>) {
    const { payloadEncrypted, employment, ...rest } = r;
    return {
      ...rest,
      employee: { id: employment.id, employeeNumber: employment.employeeNumber, name: `${employment.person.firstName} ${employment.person.lastName}`, entity: employment.legalEntity },
    };
  }

  private readonly include = {
    employment: { select: { id: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true, name: true } } } },
  } as const;

  async requestBankChange(auth: AuthContext, employmentId: string, dto: BankChangeDto) {
    const { subject, rel } = await this.access.resolve(auth, employmentId);
    if (!rel.self) throw new ForbiddenException('Only the employee can ask to change their own bank details');
    if (subject.status !== 'ACTIVE') throw new BadRequestException('This employment has ended');
    const pending = await this.prisma.changeRequest.count({ where: { employmentId, kind: 'BANK_ACCOUNT', status: 'PENDING' } });
    if (pending) throw new ConflictException('You already have a bank details change waiting for HR. Cancel it first to send a new one.');
    const account = dto.accountNumber.replace(/\s+/g, '').toUpperCase();
    const row = await this.prisma.changeRequest.create({
      data: {
        employmentId,
        legalEntityId: subject.legalEntityId,
        kind: 'BANK_ACCOUNT',
        payloadEncrypted: encryptField(JSON.stringify({ ...dto, accountNumber: account })),
        summary: `New bank account at ${dto.bankName}, ${masked(last4(account))}`,
        requestedById: auth.userId,
      },
      include: this.include,
    });
    await this.audit.record(auth, { action: 'people.change.requested', targetType: 'change_request', targetId: row.id, legalEntityId: subject.legalEntityId, detail: { kind: 'BANK_ACCOUNT' } });
    return this.present(row);
  }

  /** The employee's own requests, or any for HR who can see the record */
  async forEmployee(auth: AuthContext, employmentId: string) {
    const { rel } = await this.access.resolve(auth, employmentId);
    if (!rel.hr && !rel.self) throw new NotFoundException('Employee not found');
    const rows = await this.prisma.changeRequest.findMany({ where: { employmentId }, orderBy: { createdAt: 'desc' }, include: this.include });
    return rows.map((r) => this.present(r));
  }

  async list(auth: AuthContext, q: ChangeRequestQuery) {
    const ids = this.deciderEntities(auth);
    if (q.entityId && !ids.includes(q.entityId)) throw new NotFoundException('Company not found');
    const rows = await this.prisma.changeRequest.findMany({
      where: { legalEntityId: { in: q.entityId ? [q.entityId] : ids }, status: q.status ?? 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: this.include,
    });
    return rows.map((r) => this.present(r));
  }

  /** Full requested values for the reviewer; audited like any other reveal */
  async details(auth: AuthContext, id: string) {
    const row = await this.loadForDecider(auth, id);
    await this.audit.record(auth, { action: 'people.change.viewed', targetType: 'change_request', targetId: id, legalEntityId: row.legalEntityId });
    return { ...this.present(row), requested: JSON.parse(decryptField(row.payloadEncrypted)) };
  }

  private async loadForDecider(auth: AuthContext, id: string) {
    const row = await this.prisma.changeRequest.findFirst({ where: { id, employment: { legalEntity: { groupId: auth.groupId } } }, include: this.include });
    if (!row || !this.deciderEntities(auth).includes(row.legalEntityId)) throw new NotFoundException('Request not found');
    return row;
  }

  async decide(auth: AuthContext, id: string, approve: boolean, dto: DecisionDto) {
    const row = await this.loadForDecider(auth, id);
    if (row.status !== 'PENDING') throw new ConflictException('This request has already been decided');
    if (row.requestedById === auth.userId) throw new ForbiddenException('Someone else must approve your own request');
    const mine = await this.access.ownEmploymentIds(auth);
    if (mine.includes(row.employmentId)) throw new ForbiddenException('Someone else must approve changes to your own record');

    await this.prisma.$transaction(async (tx) => {
      // Guard against two reviewers deciding at once
      const claimed = await tx.changeRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note },
      });
      if (!claimed.count) throw new ConflictException('This request has already been decided');
      if (approve && row.kind === 'BANK_ACCOUNT') {
        const p = JSON.parse(decryptField(row.payloadEncrypted)) as BankChangeDto;
        const from = today();
        const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: row.legalEntityId }, select: { functionalCurrency: true } });
        // Close the current account; one that only started today is replaced outright
        await tx.bankAccount.deleteMany({ where: { employmentId: row.employmentId, effectiveTo: null, effectiveFrom: { gte: from } } });
        await tx.bankAccount.updateMany({ where: { employmentId: row.employmentId, effectiveTo: null }, data: { effectiveTo: from } });
        await tx.bankAccount.create({
          data: {
            employmentId: row.employmentId,
            legalEntityId: row.legalEntityId,
            bankName: p.bankName,
            branchCode: p.branchCode,
            accountName: p.accountName,
            accountNumberEncrypted: encryptField(p.accountNumber),
            accountNumberLast4: last4(p.accountNumber),
            currency: entity.functionalCurrency,
            effectiveFrom: from,
          },
        });
      }
      await this.audit.record(auth, { action: approve ? 'people.change.approved' : 'people.change.rejected', targetType: 'change_request', targetId: id, legalEntityId: row.legalEntityId, detail: { kind: row.kind, note: dto.note ?? null } }, tx);
    });
    const updated = await this.prisma.changeRequest.findUniqueOrThrow({ where: { id }, include: this.include });
    return this.present(updated);
  }

  async cancel(auth: AuthContext, id: string) {
    const row = await this.prisma.changeRequest.findFirst({ where: { id, requestedById: auth.userId }, include: this.include });
    if (!row) throw new NotFoundException('Request not found');
    if (row.status !== 'PENDING') throw new ConflictException('This request has already been decided');
    await this.prisma.changeRequest.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    await this.audit.record(auth, { action: 'people.change.cancelled', targetType: 'change_request', targetId: id, legalEntityId: row.legalEntityId });
    return this.present({ ...row, status: 'CANCELLED' });
  }
}
