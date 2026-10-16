import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalStage, Prisma, RequestStatus } from '@prisma/client';
import { can, Permission } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';

/**
 * Who decides each step, in the employee's company. The manager step is the employee's line
 * manager (or HR for the company, when the manager is away). Country Head needs
 * requests.executive, held by executives and group administrators.
 */
export const STAGE_PERMISSION: Record<ApprovalStage, Permission | null> = {
  MANAGER: null,
  HR: 'people.manage',
  PAYROLL: 'payroll.prepare',
  FINANCE: 'finance.manage',
  COUNTRY_HEAD: 'requests.executive',
};

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  MANAGER: 'Manager',
  HR: 'HR',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  COUNTRY_HEAD: 'Country Head',
};

export interface Decision {
  stage: ApprovalStage;
  /** User id of the person who decided */
  byId: string;
  byName: string;
  at: string;
  approved: boolean;
  note: string | null;
}

/** The fields every approvable record (loan, voucher, enrolment) shares */
export interface Approvable {
  id: string;
  legalEntityId: string;
  status: RequestStatus;
  stages: ApprovalStage[];
  stage: ApprovalStage | null;
  approverId: string | null;
  decisions: Prisma.JsonValue;
}

export const decisionsOf = (r: { decisions: Prisma.JsonValue }) => (Array.isArray(r.decisions) ? (r.decisions as unknown as Decision[]) : []);

export function canDecideStage(auth: AuthContext, stage: ApprovalStage, legalEntityId: string, approverId: string | null, mine: string[]) {
  if (stage === ApprovalStage.MANAGER) return (!!approverId && mine.includes(approverId)) || can(auth.access, 'people.manage', legalEntityId);
  return can(auth.access, STAGE_PERMISSION[stage]!, legalEntityId);
}

/** Filters for the steps waiting for the signed-in person, across the companies in their scope */
export function waitingFor(auth: AuthContext, mine: string[]) {
  const or: Array<{ stage: ApprovalStage; approverId?: { in: string[] }; legalEntityId?: { in: string[] } }> = [];
  if (mine.length) or.push({ stage: ApprovalStage.MANAGER, approverId: { in: mine } });
  for (const stage of Object.keys(STAGE_PERMISSION) as ApprovalStage[]) {
    const permission = stage === ApprovalStage.MANAGER ? null : STAGE_PERMISSION[stage];
    if (!permission) continue;
    const ids = entityIds(auth, permission);
    if (ids.length) or.push({ stage, legalEntityId: { in: ids } });
  }
  return or;
}

/** Whether the person could decide any step at all, used to keep a record out of view otherwise */
export function involved(auth: AuthContext, r: Approvable, mine: string[]) {
  return r.stages.some((s) => canDecideStage(auth, s, r.legalEntityId, r.approverId, mine)) || decisionsOf(r).some((d) => d.byId === auth.userId);
}

/**
 * Checks the signed-in person may decide the step that is waiting, and works out what comes next.
 * Nobody approves their own request, and one person approves at most one step of a request.
 */
export function nextAfterDecision(auth: AuthContext, record: Approvable, owner: { userId: string | null }, mine: string[], approve: boolean, note?: string) {
  const stage = record.stage;
  if (!stage || record.status !== RequestStatus.PENDING) throw new ConflictException(`This request is already ${record.status.toLowerCase()}`);
  if (!canDecideStage(auth, stage, record.legalEntityId, record.approverId, mine)) {
    if (!involved(auth, record, mine)) throw new NotFoundException('Request not found');
    throw new ForbiddenException(stage === ApprovalStage.MANAGER ? 'Only their manager can decide this step' : `Only ${STAGE_LABEL[stage]} can decide this step`);
  }
  if (owner.userId === auth.userId) throw new ForbiddenException('You cannot approve your own request');
  const decisions = decisionsOf(record);
  if (decisions.some((d) => d.byId === auth.userId && d.approved)) {
    throw new ForbiddenException('You approved an earlier step of this request, so someone else must decide this one');
  }
  const decision: Decision = { stage, byId: auth.userId, byName: auth.displayName, at: new Date().toISOString(), approved: approve, note: note || null };
  const index = record.stages.indexOf(stage);
  const next = approve ? record.stages[index + 1] ?? null : null;
  return {
    decisions: [...decisions, decision] as unknown as Prisma.InputJsonValue,
    stage: next,
    /** True when this was the last step and it was approved */
    finished: approve && next === null,
    declined: !approve,
  };
}

/**
 * Steps the person creating a request settles by creating it (a manager nominating their own
 * report, HR nominating anyone). They are recorded as approved and taken out of the queue.
 */
export function settleOwnSteps(stages: ApprovalStage[], settled: ApprovalStage[], auth: AuthContext) {
  const at = new Date().toISOString();
  const decisions: Decision[] = stages.filter((s) => settled.includes(s)).map((stage) => ({ stage, byId: auth.userId, byName: auth.displayName, at, approved: true, note: 'Nominated by them' }));
  const remaining = stages.filter((s) => !settled.includes(s));
  return { decisions, stages: [...decisions.map((d) => d.stage), ...remaining], stage: remaining[0] ?? null };
}
