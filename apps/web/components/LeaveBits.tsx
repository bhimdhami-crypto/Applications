'use client';

import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS } from '@gpp/shared';
import { fmtDate } from '@/components/ui';
import type { LeaveRulePack, LeaveStatus, LeaveType } from '@/lib/types';

const TONE: Record<LeaveStatus, string> = { PENDING_MANAGER: 'warn', PENDING_HR: 'warn', APPROVED: 'ok', DECLINED: 'bad', CANCELLED: '' };

export const leaveLabel = (t: LeaveType) => LEAVE_TYPE_LABELS[t] ?? t;

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <span className={`badge ${TONE[status]}`}>{LEAVE_STATUS_LABELS[status] ?? status}</span>;
}

export function dateRange(start: string, end: string, lang = 'en') {
  return start === end ? fmtDate(start, lang) : `${fmtDate(start, lang)} – ${fmtDate(end, lang)}`;
}

/** Shown wherever balances or day counts appear: the rules are not certified */
export function DraftRulesNote({ pack }: { pack?: LeaveRulePack | null }) {
  if (!pack) return null;
  return (
    <div className="alert info" role="note">
      <strong>Draft leave rules ({pack.version}), not verified.</strong> {pack.summary} Balances are a guide until HR in each country signs the rules off.
    </div>
  );
}
