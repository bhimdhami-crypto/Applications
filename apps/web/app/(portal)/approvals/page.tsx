'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, apiBlob, ApprovalItem, formatDate, money, trail } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';

export default function MoneyApprovalsPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<ApprovalItem[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<ApprovalItem[]>('/approvals').then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function decide(r: ApprovalItem, approve: boolean) {
    if (busy) return;
    setBusy(r.id);
    setError('');
    setNotice('');
    try {
      const updated = await api<{ status: string; stageLabel?: string | null; stage?: string | null }>(`/approvals/${r.entity}/${r.id}/${approve ? 'approve' : 'decline'}`, {
        method: 'POST',
        body: { note: notes[r.id] || undefined },
      });
      const next = r.stages[r.stages.indexOf(r.stageLabel) + 1];
      setNotice(
        !approve
          ? `${r.title} for ${r.employee.name} declined. They have been emailed.`
          : updated.status === 'PENDING' && next
            ? `Approved. ${r.employee.name}'s ${r.title.toLowerCase()} now goes to ${next}.`
            : `${r.title} for ${r.employee.name} approved. They have been emailed.`,
      );
      load();
    } catch (err) {
      setError((err as Error).message);
      load();
    } finally {
      setBusy('');
    }
  }

  async function receipt(r: ApprovalItem) {
    try {
      const blob = await apiBlob(`/loans/${r.id}/receipt`);
      const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] ?? 'bin';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IOU receipts, ${r.employee.name}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Loan and benefit approvals" sub={<>Salary advances, staff loans, IOUs, meal and gym enrolments and gift vouchers waiting for you. Each step is approved by a different person.</>} />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Request</th><th className="num">Amount</th><th>Details</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={`${r.entity}-${r.id}`}>
                <td className="wrap">
                  {can('HR', 'PAYROLL', 'MANAGER') ? <Link href={`/employees/${r.employee.id}`}>{r.employee.name}</Link> : r.employee.name}
                  <div className="muted small">{r.employee.employeeNo} · {r.employee.company.replace(/^Mindspace (Artificial Intelligence|Inteligencia Artificial) /, '')}</div>
                </td>
                <td>
                  {r.title}
                  <div className="muted small">Sent {formatDate(r.createdAt)}</div>
                  <div className="muted small">Steps: {r.stages.map((s) => (s === r.stageLabel || r.stageLabel.startsWith(s) ? `${s} (now)` : s)).join(' → ')}</div>
                </td>
                <td className="num">{r.amount ? money(r.amount, r.currency) : ''}</td>
                <td className="small wrap">
                  {r.details.map((d) => <div key={d}>{d}</div>)}
                  {r.receipt && <button type="button" className="secondary small" onClick={() => receipt(r)}>Download receipts</button>}
                  {r.decisions.length > 0 && <ul className="trail">{trail(r.decisions).map((t, i) => <li key={i}>{t}</li>)}</ul>}
                </td>
                <td className="decide">
                  <input placeholder="Note (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div>
                    <button className="small" disabled={!!busy} onClick={() => decide(r, true)}>{r.title === 'IOU settlement' ? 'Confirm' : 'Approve'}</button>{' '}
                    <button className="secondary danger small" disabled={!!busy} onClick={() => decide(r, false)}>{r.title === 'IOU settlement' ? 'Send back' : 'Decline'}</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={5} className="empty">Nothing is waiting for you.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
