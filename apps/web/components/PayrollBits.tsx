'use client';

import type { PayrollStatus } from '@/lib/types';

const STATUS: Record<PayrollStatus, [string, string]> = {
  DRAFT: ['Draft', ''],
  SUBMITTED: ['Waiting for approval', 'warn'],
  APPROVED: ['Approved, to finalise', 'warn'],
  FINALIZED: ['Final', 'ok'],
};

export function RunBadge({ status }: { status: PayrollStatus }) {
  const [label, tone] = STATUS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Shown wherever payroll figures appear while a country's rules are not signed off */
export function UnverifiedRules({ version, verified }: { version: string; verified: boolean }) {
  if (verified) return null;
  return (
    <div className="alert warn" role="note">
      <strong>Unverified draft rules ({version}).</strong> Tax and social security here follow the first build’s draft country pack, which a local payroll expert has not signed off. These figures are for demonstration and must not be paid as they are.
    </div>
  );
}
