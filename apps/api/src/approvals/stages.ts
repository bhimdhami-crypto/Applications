import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ApprovalStage, Prisma, RequestStatus, Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators';

/** Who decides each step. The manager step is the employee's own manager; Country Head is an administrator. */
export const STAGE_ROLE: Record<ApprovalStage, Role | null> = {
  MANAGER: null,
  HR: Role.HR,
  PAYROLL: Role.PAYROLL,
  FINANCE: Role.FINANCE,
  COUNTRY_HEAD: Role.ADMIN,
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
  byId: string;
  byName: string;
  at: string;
  approved: boolean;
  note: string | null;
}

/** The fields every approvable record (loan, voucher, enrolment) shares */
export interface Approvable {
  id: string;
  status: RequestStatus;
  stages: ApprovalStage[];
  stage: ApprovalStage | null;
  approverId: string | null;
  decisions: Prisma.JsonValue;
}

export const decisionsOf = (r: { decisions: Prisma.JsonValue }) => (Array.isArray(r.decisions) ? (r.decisions as unknown as Decision[]) : []);

/** A manager who can approve: has an active login and is not the employee themself */
export function activeManager<M extends { userId: string | null; user: { isActive: boolean; email: string } | null }>(employee: { userId: string | null; manager: M | null }) {
  const m = employee.manager;
  return m && m.user?.isActive && m.userId !== employee.userId ? m : null;
}

export function canDecideStage(actor: AuthUser, stage: ApprovalStage, approverId: string | null, actorEmployeeId: string | null) {
  if (stage === ApprovalStage.MANAGER) return actor.role === Role.ADMIN || (!!actorEmployeeId && approverId === actorEmployeeId);
  return actor.role === Role.ADMIN || actor.role === STAGE_ROLE[stage];
}

/**
 * Checks the signed-in person may decide the step that is waiting, and works out what comes next.
 * Nobody approves their own request, and one person approves at most one step of a request.
 */
export function nextAfterDecision(
  actor: AuthUser,
  actorName: string,
  record: Approvable,
  owner: { userId: string | null },
  actorEmployeeId: string | null,
  approve: boolean,
  note?: string,
) {
  const stage = record.stage;
  if (!stage || record.status !== RequestStatus.PENDING) {
    throw new ConflictException(`This request is already ${record.status.toLowerCase()}`);
  }
  if (owner.userId === actor.id) throw new ForbiddenException('You cannot approve your own request');
  if (!canDecideStage(actor, stage, record.approverId, actorEmployeeId)) {
    throw new ForbiddenException(stage === ApprovalStage.MANAGER ? 'Only their manager can decide this step' : `Only ${STAGE_LABEL[stage]} can decide this step`);
  }
  const decisions = decisionsOf(record);
  if (decisions.some((d) => d.byId === actor.id && d.approved)) {
    throw new ForbiddenException('You approved an earlier step of this request, so someone else must decide this one');
  }
  const decision: Decision = { stage, byId: actor.id, byName: actorName, at: new Date().toISOString(), approved: approve, note: note || null };
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
export function settleOwnSteps(stages: ApprovalStage[], settled: ApprovalStage[], actor: AuthUser, actorName: string) {
  const at = new Date().toISOString();
  const decisions: Decision[] = stages.filter((s) => settled.includes(s)).map((stage) => ({ stage, byId: actor.id, byName: actorName, at, approved: true, note: 'Nominated by them' }));
  const remaining = stages.filter((s) => !settled.includes(s));
  return { decisions, stages: [...decisions.map((d) => d.stage), ...remaining], stage: remaining[0] ?? null };
}
