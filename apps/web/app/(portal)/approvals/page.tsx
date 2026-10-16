'use client';

import Link from 'next/link';
import { useState } from 'react';
import { money, trail } from '@/components/MoneyBits';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, apiBlob } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { ApprovalItem } from '@/lib/types';

/** Advances, loans and IOUs waiting for the signed-in person. Each step is decided by a different person. */
export default function ApprovalsPage() {
  const { t, lang } = usePrefs();
  const { can } = useSession();
  const list = useLoad(() => api<ApprovalItem[]>('/approvals'), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(r: ApprovalItem, approve: boolean) {
    if (busy) return;
    setBusy(r.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api<{ status: string; stageLabel: string | null }>(`/approvals/${r.entity}/${r.id}/${approve ? 'approve' : 'decline'}`, {
        method: 'POST',
        body: { note: notes[r.id] || undefined },
      });
      setNotice(
        !approve
          ? `${r.title} for ${r.employee.name} ${r.title === 'IOU settlement' ? 'sent back' : 'declined'}. They have been emailed.`
          : updated.status === 'PENDING' && updated.stageLabel
            ? `Approved. ${r.employee.name}'s ${r.title.toLowerCase()} now goes to ${updated.stageLabel}.`
            : `${r.title} for ${r.employee.name} ${r.title === 'IOU settlement' ? 'confirmed' : 'approved'}. They have been emailed.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      list.reload();
    }
  }

  async function receipt(r: ApprovalItem) {
    try {
      const blob = await apiBlob(`/loans/${r.id}/receipt`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHead title={t('nav.approvals')} sub="Salary advances, staff loans and IOUs waiting for you. Each step is approved by a different person, and nobody approves their own request." />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty>Nothing is waiting for you.</Empty>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Request</th>
                <th className="num">Amount</th>
                <th>Details</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={`${r.entity}-${r.id}`}>
                  <td>
                    {can('people.read') ? <Link href={`/people/${r.employee.id}`}>{r.employee.name}</Link> : r.employee.name}
                    <div className="muted small">
                      {r.employee.employeeNumber} · {r.employee.entity.code}
                    </div>
                  </td>
                  <td>
                    {r.title}
                    <div className="muted small">Sent {fmtDate(r.createdAt, lang)}</div>
                    <div className="muted small">
                      Steps: {r.stages.map((s) => (r.stageLabel.startsWith(s) ? `${s} (now)` : s)).join(' → ')}
                    </div>
                  </td>
                  <td className="num">{r.amount ? money(r.amount, r.currency, lang) : ''}</td>
                  <td className="small">
                    {r.details.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                    {r.receipt && (
                      <button type="button" className="btn secondary small" onClick={() => receipt(r)}>
                        Open receipts
                      </button>
                    )}
                    {r.decisions.length > 0 && (
                      <ul style={{ margin: '.3rem 0 0', paddingInlineStart: '1rem' }}>
                        {trail(r.decisions, lang).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    )}
                    <div className="muted">Rules {r.rulesVersion} (draft)</div>
                  </td>
                  <td style={{ minWidth: 200 }}>
                    <input
                      aria-label={`Note for ${r.employee.name}`}
                      placeholder="Note (optional)"
                      value={notes[r.id] ?? ''}
                      maxLength={300}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      style={{ width: '100%', marginBottom: '.4rem' }}
                    />
                    <button className="btn small" disabled={!!busy} onClick={() => decide(r, true)}>
                      {r.title === 'IOU settlement' ? 'Confirm' : 'Approve'}
                    </button>{' '}
                    <button className="btn danger small" disabled={!!busy} onClick={() => decide(r, false)}>
                      {r.title === 'IOU settlement' ? 'Send back' : 'Decline'}
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
