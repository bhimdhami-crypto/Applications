import { Role } from '../common/constants';

export interface RuleBand {
  id: number;
  documentType: string;
  minAmount: string;
  maxAmount: string | null;
  isActive: boolean;
}

export interface Stage {
  stageNo: number;
  name: string;
  approverRole: string;
}

export interface PastAction {
  action: string;
  stageNo: number | null;
  userId: number;
}

/**
 * The approval rule (SOP) that applies: same document type, active, and minAmount ≤ amount < maxAmount.
 * When bands overlap the most specific one (highest minimum) wins. No rule means the voucher cannot be
 * submitted: every transaction must pass through an approval route.
 */
export function selectRule<T extends RuleBand>(rules: T[], documentType: string, amount: number): T | undefined {
  return rules
    .filter(
      (r) =>
        r.isActive &&
        r.documentType === documentType &&
        Number(r.minAmount) <= amount &&
        (r.maxAmount === null || amount < Number(r.maxAmount)),
    )
    .sort((a, b) => Number(b.minAmount) - Number(a.minAmount))[0];
}

/**
 * Who may approve the current stage. Segregation of duties: the author never approves their own voucher,
 * and one person approves at most one stage of it. Admins may stand in for any role, under the same limits.
 */
export function approvalBlocker(
  stage: Stage,
  user: { id: number; role: Role },
  voucher: { createdById: number },
  actions: PastAction[],
): string | null {
  if (user.role !== 'ADMIN' && user.role !== stage.approverRole) {
    return `Stage ${stage.stageNo} (${stage.name}) needs the ${stage.approverRole} role`;
  }
  if (voucher.createdById === user.id) return 'You prepared this voucher, so someone else must approve it';
  // Approvals since the last submission count; earlier rounds were cancelled by a rejection or recall
  const lastSubmit = actions.map((a) => a.action).lastIndexOf('SUBMITTED');
  const thisRound = actions.slice(lastSubmit + 1);
  if (thisRound.some((a) => a.action === 'APPROVED' && a.userId === user.id)) {
    return 'You already approved an earlier stage of this voucher';
  }
  return null;
}
