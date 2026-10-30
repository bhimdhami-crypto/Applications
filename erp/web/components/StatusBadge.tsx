import { VoucherStatus } from '@/lib/api';

const LABEL: Record<VoucherStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  REJECTED: 'Rejected',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
};

export function StatusBadge({ status }: { status: VoucherStatus }) {
  return <span className={`badge ${status}`}>{LABEL[status] ?? status}</span>;
}
