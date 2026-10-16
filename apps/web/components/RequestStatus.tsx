import type { ChangeRequest } from '@/lib/types';

/** Status badge for a change request */
export function RequestStatus({ r }: { r: ChangeRequest }) {
  const cls = r.status === 'APPROVED' ? 'ok' : r.status === 'REJECTED' ? 'bad' : r.status === 'PENDING' ? 'warn' : '';
  const text = { PENDING: 'Waiting for HR', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' }[r.status];
  return <span className={`badge ${cls}`}>{text}</span>;
}
