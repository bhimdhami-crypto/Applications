'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DropZone, filesForm } from '@/components/DropZone';
import { StatusBadge } from '@/components/StatusBadge';
import { Voucher, VoucherStatus, VoucherSummary, api, errorText } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

const FILTERS: { label: string; status?: VoucherStatus }[] = [
  { label: 'All' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Awaiting approval', status: 'SUBMITTED' },
  { label: 'Rejected', status: 'REJECTED' },
  { label: 'Posted', status: 'POSTED' },
];

export default function Vouchers() {
  const router = useRouter();
  const { company, canPrepare } = useSession();
  const [status, setStatus] = useState<VoucherStatus | undefined>();
  const [rows, setRows] = useState<VoucherSummary[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setRows(null);
    api<VoucherSummary[]>(`/companies/${company.code}/vouchers${status ? `?status=${status}` : ''}`)
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  }, [company.code, status]);

  // Dropping documents starts a draft voucher with them attached; the accountant then adds the lines
  async function startFromFiles(files: File[]) {
    setUploading(true);
    setError('');
    try {
      const v = await api<Voucher>(`/companies/${company.code}/inbox`, { method: 'POST', body: filesForm(files) });
      router.push(`/vouchers/${v.voucherNo}`);
    } catch (e) {
      setError(errorText(e));
      setUploading(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Vouchers</h1>
        <div className="spacer" />
        {canPrepare && (
          <Link className="btn primary" href="/vouchers/new">
            <Plus size={16} /> New voucher
          </Link>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {canPrepare && (
        <div style={{ marginBottom: 18 }}>
          <DropZone
            title={uploading ? 'Uploading…' : 'Drop invoices, receipts or statements here'}
            hint="Each drop starts a draft voucher with the files attached, so nothing needs filing on paper."
            onFiles={startFromFiles}
            disabled={uploading}
          />
        </div>
      )}
      <div className="card">
        <div className="tabs" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button key={f.label} className={`tab${status === f.status ? ' active' : ''}`} onClick={() => setStatus(f.status)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Voucher</th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="num">Amount ({company.homeCurrency})</th>
                <th>Status</th>
                <th>Prepared by</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => router.push(`/vouchers/${v.voucherNo}`)}>
                  <td>
                    <Link href={`/vouchers/${v.voucherNo}`}>{v.voucherNo}</Link>
                    {v.documentType === 'REVERSAL' && <span className="muted"> · reversal</span>}
                  </td>
                  <td>{formatDate(v.txDate)}</td>
                  <td>{v.description}</td>
                  <td>{v.reference}</td>
                  <td className="num">{formatAmount(v.totalAmount)}</td>
                  <td>
                    <StatusBadge status={v.status} />
                  </td>
                  <td>{v.createdBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows === null && !error && <div className="empty">Loading…</div>}
          {rows?.length === 0 && <div className="empty">No vouchers here yet.</div>}
        </div>
      </div>
    </>
  );
}
