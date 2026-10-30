import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Role } from '../common/constants';
import { Email, VoucherFacts, approvalNeeded, posted, rejected } from './email-templates';
import { Candidate, stageRecipients } from './recipients';

type Tx = Prisma.TransactionClient;

const VOUCHER_INCLUDE = {
  company: { select: { code: true, homeCurrency: true } },
  createdBy: { select: { id: true, name: true, email: true, isActive: true, emailAlerts: true } },
  rule: { include: { stages: true } },
  actions: { orderBy: { id: 'asc' } },
} satisfies Prisma.VoucherInclude;

type VoucherRow = Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>;

/**
 * Queues the approval emails. Each call runs inside the transaction of the step that causes it, so an
 * email exists exactly when the step happened; the mailer sends it afterwards.
 */
@Injectable()
export class NotificationsService {
  private readonly appUrl: string;

  constructor(config: ConfigService) {
    this.appUrl = config.get('APP_URL', 'http://localhost:3100').replace(/\/+$/, '');
  }

  link(path: string) {
    return `${this.appUrl}${path}`;
  }

  /** Tells whoever can approve the voucher's current stage that it is waiting for them */
  async stageWaiting(tx: Tx, voucherId: number) {
    const v = await this.load(tx, voucherId);
    const stage = v.rule?.stages.find((s) => s.stageNo === v.currentStage);
    if (v.status !== 'SUBMITTED' || !stage) return;
    const people = await activePeople(tx);
    const { recipients, standIn } = stageRecipients(stage, v, v.actions, people);
    const email = approvalNeeded(this.facts(v), stage, standIn);
    await this.queue(tx, 'APPROVAL_NEEDED', recipients, email, v.id);
  }

  async rejected(tx: Tx, voucherId: number, by: string, stageName: string, reason: string) {
    const v = await this.load(tx, voucherId);
    await this.queue(tx, 'REJECTED', authorIfAlerting(v), rejected(this.facts(v), by, stageName, reason), v.id);
  }

  async posted(tx: Tx, voucherId: number, auditNo: string, by: string) {
    const v = await this.load(tx, voucherId);
    await this.queue(tx, 'POSTED', authorIfAlerting(v), posted(this.facts(v), auditNo, by), v.id);
  }

  async queue(tx: Tx, kind: string, to: Array<{ id: number; email: string }>, email: Email, voucherId?: number, createdAt?: Date) {
    if (!to.length) return;
    await tx.emailMessage.createMany({
      data: to.map((p) => ({ kind, userId: p.id, toEmail: p.email, subject: email.subject, text: email.text, html: email.html, voucherId, createdAt })),
    });
  }

  private load(tx: Tx, id: number) {
    return tx.voucher.findUniqueOrThrow({ where: { id }, include: VOUCHER_INCLUDE });
  }

  private facts(v: VoucherRow): VoucherFacts {
    return {
      companyCode: v.company.code,
      voucherNo: v.voucherNo,
      description: v.description,
      amount: v.totalAmount?.toString() ?? '0',
      currency: v.company.homeCurrency,
      author: v.createdBy.name,
      link: this.link(`/vouchers/${encodeURIComponent(v.voucherNo)}`),
    };
  }
}

/** Everyone who could be asked to approve: active, and not a read-only viewer */
export async function activePeople(db: Tx): Promise<Candidate[]> {
  const users = await db.user.findMany({
    where: { isActive: true, role: { not: 'VIEWER' } },
    select: { id: true, role: true, email: true, name: true, emailAlerts: true },
  });
  return users.map((u) => ({ ...u, role: u.role as Role }));
}

function authorIfAlerting(v: VoucherRow) {
  const a = v.createdBy;
  return a.isActive && a.emailAlerts ? [a] : [];
}
