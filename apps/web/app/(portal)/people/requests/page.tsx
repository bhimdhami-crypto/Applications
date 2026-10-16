'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequestStatus } from '@/components/RequestStatus';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { ChangeRequest } from '@/lib/types';

interface Details extends ChangeRequest {
  requested: { bankName: string; branchCode?: string; accountName: string; accountNumber: string };
}

/** HR queue for self-service changes that need a second person's approval */
export default function Requests() {
  const { t, lang } = usePrefs();
  const { entityId } = useSession();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>('PENDING');
  const list = useLoad(() => api<ChangeRequest[]>(`/change-requests?status=${status}${entityId ? `&entityId=${entityId}` : ''}`), [status, entityId]);
  const [open, setOpen] = useState<Details | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const view = async (r: ChangeRequest) => {
    setError(null);
    try {
      setOpen(await api<Details>(`/change-requests/${r.id}`));
      setNote('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const decide = async (approve: boolean) => {
    if (!open) return;
    setError(null);
    try {
      await api(`/change-requests/${open.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note: note || undefined } });
      setOpen(null);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHead
        title={t('nav.changeRequests')}
        sub="Bank detail changes employees asked for. Check them against the bank letter before approving: an approved change is used for the next payroll."
        actions={
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        }
      />
      <ErrorAlert error={error || list.error} />
      {open && (
        <section className="card" aria-label="Request details">
          <h2>
            {open.employee.name} <span className="muted mono">{open.employee.employeeNumber}</span>
          </h2>
          <dl className="facts">
            <dt>Bank</dt>
            <dd>{open.requested.bankName}</dd>
            <dt>Branch code</dt>
            <dd>{open.requested.branchCode ?? '—'}</dd>
            <dt>Account name</dt>
            <dd>{open.requested.accountName}</dd>
            <dt>Account number</dt>
            <dd className="mono">{open.requested.accountNumber}</dd>
            <dt>Asked on</dt>
            <dd>{fmtDate(open.createdAt, lang, true)}</dd>
          </dl>
          {open.status === 'PENDING' && (
            <>
              <label className="field" style={{ marginTop: '.75rem' }}>
                <span>Note to the employee (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>
              <div className="row">
                <button className="btn" onClick={() => decide(true)}>
                  Approve
                </button>
                <button className="btn danger" onClick={() => decide(false)}>
                  Reject
                </button>
                <button className="btn secondary" onClick={() => setOpen(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty>Nothing waiting.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Company</th>
                <th>Change</th>
                <th>Asked</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/people/${r.employee.id}`}>{r.employee.name}</Link>
                    <div className="muted mono" style={{ fontSize: '.8rem' }}>
                      {r.employee.employeeNumber}
                    </div>
                  </td>
                  <td>{r.employee.entity.code}</td>
                  <td>{r.summary}</td>
                  <td className="muted">{fmtDate(r.createdAt, lang)}</td>
                  <td>
                    <RequestStatus r={r} />
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => view(r)}>
                      {r.status === 'PENDING' ? 'Review' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
