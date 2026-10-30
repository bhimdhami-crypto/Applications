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

export interface BandInput {
  minAmount: string;
  maxAmount: string | null;
  stages: { name: string; approverRole: string }[];
}

/** Roles that may approve a stage. Viewers only read; everyone else can be asked to sign off. */
export const APPROVER_ROLES = ['ACCOUNTANT', 'FINANCE_MANAGER', 'DIRECTOR', 'ADMIN'] as const;

/**
 * Checks a document type's whole approval matrix before it replaces the current one. The bands must
 * start at zero, follow on from each other with no gap or overlap, and end with no upper limit, so every
 * amount has exactly one route. Each band needs at least one stage. Returns the problems, or none.
 */
export function matrixProblems(bands: BandInput[]): string[] {
  if (!bands.length) return ['Add at least one amount band'];
  const problems: string[] = [];
  const sorted = [...bands].sort((a, b) => Number(a.minAmount) - Number(b.minAmount));
  if (Number(sorted[0].minAmount) !== 0) problems.push(`The first band must start at 0, not ${sorted[0].minAmount}`);
  sorted.forEach((b, i) => {
    const label = `Band ${i + 1} (from ${b.minAmount})`;
    const next = sorted[i + 1];
    if (b.maxAmount !== null && Number(b.maxAmount) <= Number(b.minAmount)) problems.push(`${label}: the upper limit must be above the lower`);
    if (next) {
      if (b.maxAmount === null) problems.push(`${label}: only the last band can have no upper limit`);
      else if (Number(b.maxAmount) < Number(next.minAmount)) problems.push(`Amounts from ${b.maxAmount} to ${next.minAmount} have no approval route`);
      else if (Number(b.maxAmount) > Number(next.minAmount)) problems.push(`Bands overlap between ${next.minAmount} and ${b.maxAmount}`);
    } else if (b.maxAmount !== null) {
      problems.push(`Amounts from ${b.maxAmount} up have no approval route; leave the last band's upper limit empty`);
    }
    if (!b.stages.length) problems.push(`${label}: add at least one approval stage`);
    for (const s of b.stages) {
      if (!(APPROVER_ROLES as readonly string[]).includes(s.approverRole)) problems.push(`${label}: ${s.approverRole} cannot approve`);
    }
  });
  return problems;
}

/**
 * Since one person approves at most one stage, a band with two director stages needs two directors.
 * Lists each band whose stages need more people in a role than there are active users with it.
 */
export function staffingWarnings(bands: (BandInput & { name: string })[], usersByRole: Record<string, number>): string[] {
  const warnings: string[] = [];
  for (const b of bands) {
    const needed = new Map<string, number>();
    for (const s of b.stages) needed.set(s.approverRole, (needed.get(s.approverRole) ?? 0) + 1);
    // Admins may stand in for any role, so they count towards every role's shortfall
    const admins = usersByRole.ADMIN ?? 0;
    for (const [role, count] of needed) {
      const have = (usersByRole[role] ?? 0) + (role === 'ADMIN' ? 0 : admins);
      if (have < count) warnings.push(`"${b.name}" needs ${count} different ${roleName(role)} approvers, but only ${have} active user${have === 1 ? '' : 's'} can act as one`);
    }
  }
  return warnings;
}

const ROLE_NAMES: Record<string, string> = { ACCOUNTANT: 'accountant', FINANCE_MANAGER: 'finance manager', DIRECTOR: 'director', ADMIN: 'administrator' };
export const roleName = (role: string) => ROLE_NAMES[role] ?? role;
