'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PendingVoucher, api, errorText } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

/** Everything waiting for the signed-in person, across all three companies, oldest first */
export default function Approvals() {
  const { setCompany } = useSession();
  const [items, setItems] = useState<PendingVoucher[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    api<PendingVoucher[]>('/approvals/pending')
      .then(setItems)
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function decide(v: PendingVoucher, action: 'approve' | 'reject') {
    setBusy(v.id);
    setError('');
    setNotice('');
    try {
      await api(`/companies/${v.company.code}/vouchers/${v.voucherNo}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? { comment: reason } : {},
      });
      setNotice(`${v.voucherNo} ${action === 'approve' ? 'approved' : 'sent back to its author'}`);
      setRejecting(null);
      setReason('');
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Waiting for your approval</h1>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {items === null && !error && <div className="empty">Loading…</div>}
      {items?.length === 0 && <div className="card empty">Nothing is waiting for you. Approved vouchers post to the ledger straight away.</div>}
      <div className="inbox">
        {items?.map((v) => (
          <div key={v.id} className="card inbox-item">
            <div>
              <div>
                <Link href={`/vouchers/${v.voucherNo}`} onClick={() => setCompany(v.company.code)}>
                  <strong>
                    {v.company.code} · {v.voucherNo}
                  </strong>
                </Link>
                {v.documentType === 'REVERSAL' && <span className="muted"> · reversal</span>}
              </div>
              <div>{v.description}</div>
              <div className="meta">
                {formatDate(v.txDate)} · prepared by {v.createdBy.name}
                {v.reference && ` · ref ${v.reference}`} · stage {v.currentStage}: {v.stage}
                {v.sopReference && ` · ${v.sopReference}`}
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'grid', gap: 8, justifyItems: 'end' }}>
              <div className="amount">{formatAmount(v.totalAmount)}</div>
              <div className="actions-bar">
                <Link className="btn small" href={`/vouchers/${v.voucherNo}`} onClick={() => setCompany(v.company.code)}>
                  Open
                </Link>
                <button className="btn small danger" disabled={busy === v.id} onClick={() => setRejecting(rejecting === v.id ? null : v.id)}>
                  Reject
                </button>
                <button className="btn small success" disabled={busy === v.id} onClick={() => decide(v, 'approve')}>
                  Approve
                </button>
              </div>
            </div>
            {rejecting === v.id && (
              <div className="reject-box">
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is rejected, so the author can fix it" />
                <button className="btn danger" disabled={busy === v.id || reason.trim().length < 3} onClick={() => decide(v, 'reject')}>
                  Send back
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
