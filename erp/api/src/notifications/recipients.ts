import { approvalBlocker, PastAction, Stage } from '../approvals/approval-rules';
import { Role } from '../common/constants';

export interface Candidate {
  id: number;
  role: Role;
  email: string;
  name: string;
  emailAlerts: boolean;
}

/**
 * Who to tell that a stage is waiting: everyone who holds the stage's role and could approve it now
 * (not the author, not someone who signed an earlier stage). Administrators can stand in for any role,
 * but are only told when nobody with the role can act, so they are not copied on everything.
 */
export function stageRecipients(stage: Stage, voucher: { createdById: number }, actions: PastAction[], people: Candidate[]) {
  const able = people.filter((p) => !approvalBlocker(stage, p, voucher, actions));
  const holders = able.filter((p) => p.role === stage.approverRole);
  const chosen = holders.length ? holders : able.filter((p) => p.role === 'ADMIN');
  return { recipients: chosen.filter((p) => p.emailAlerts), standIn: !holders.length };
}
