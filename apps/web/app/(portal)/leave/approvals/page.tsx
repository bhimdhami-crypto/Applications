'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, dateRange, LEAVE_STATUS_LABEL, LeaveRequest, LeaveTypeInfo } from '@/lib/api';

export default function ApprovalsPage() {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [types, setTypes] = useState<LeaveTypeInfo[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<LeaveRequest[]>('/leave/approvals').then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api<LeaveTypeInfo[]>('/leave/types').then(setTypes).catch(() => setTypes([]));
  }, []);

  async function decide(r: LeaveRequest, approve: boolean) {
    setError('');
    setNotice('');
    try {
      const updated = await api<LeaveRequest>(`/leave/requests/${r.id}/${approve ? 'approve' : 'decline'}`, { method: 'POST', body: { note: notes[r.id] || undefined } });
      const who = r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'The employee';
      setNotice(updated.status === 'PENDING_HR' ? `Approved. ${who}'s request now goes to HR.` : `${who}'s leave was ${approve ? 'approved' : 'declined'}. They have been emailed.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const label = (t: string) => types.find((x) => x.type === t)?.label ?? t;

  return (
    <>
      <h1>Leave approvals</h1>
      <p className="muted">Please respond within 3 working days. Requests that have waited longer are marked overdue.</p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Leave</th><th className="num">Days</th><th>Reason</th><th>Waiting</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.employee && <Link href={`/leave?employeeId=${r.employee.id}`}>{r.employee.firstName} {r.employee.lastName}</Link>}
                  <div className="muted small">{r.employee?.company.name}</div>
                </td>
                <td>
                  {label(r.type)}
                  <div className="muted small">{dateRange(r.startDate, r.endDate)}</div>
                  {r.status === 'PENDING_HR' && <span className="badge PENDING_HR">{LEAVE_STATUS_LABEL[r.status]}</span>}
                </td>
                <td className="num">{r.days}</td>
                <td className="small">
                  {r.reason}
                  {r.handoverTo && <div className="muted">Handover: {r.handoverTo}</div>}
                  {r.documentId && <div className="muted">Document attached (see their profile)</div>}
                </td>
                <td>
                  {r.overdue ? <span className="badge DECLINED">Overdue</span> : null} {r.waitingDays} working day{r.waitingDays === 1 ? '' : 's'}
                </td>
                <td className="decide">
                  <input placeholder="Note (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div>
                    <button className="small" onClick={() => decide(r, true)}>Approve</button>{' '}
                    <button className="danger small" onClick={() => decide(r, false)}>Decline</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing is waiting for you.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
