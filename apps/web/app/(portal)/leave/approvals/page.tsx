'use client';

import Link from 'next/link';
import { useState } from 'react';
import { dateRange, leaveLabel } from '@/components/LeaveBits';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { LeaveRequest } from '@/lib/types';

/** Leave waiting for the signed-in person: their team at the manager step, and HR's queue */
export default function LeaveApprovals() {
  const { t, lang } = usePrefs();
  const list = useLoad(() => api<LeaveRequest[]>('/leave/approvals'), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function decide(r: LeaveRequest, approve: boolean) {
    setError(null);
    setDone(null);
    try {
      const res = await api<LeaveRequest>(`/leave/requests/${r.id}/${approve ? 'approve' : 'decline'}`, { method: 'POST', body: { note: notes[r.id] || undefined } });
      setDone(
        res.status === 'PENDING_HR'
          ? `Approved for ${r.employee.name}. ${leaveLabel(r.type)} also needs HR, so it has gone to them.`
          : `${approve ? 'Approved' : 'Declined'} ${leaveLabel(r.type).toLowerCase()} for ${r.employee.name}.`,
      );
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHead title={t('nav.leaveApprovals')} sub="Decide within 3 working days. The day a request arrives does not count." />
      {done && (
        <div className="alert success" role="status">
          {done}
        </div>
      )}
      <ErrorAlert error={error || list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Empty>Nothing is waiting for you.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave</th>
                <th className="num">Days</th>
                <th>Step</th>
                <th>Waiting</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/leave?employee=${r.employee.id}`}>{r.employee.name}</Link>
                    <div className="muted mono" style={{ fontSize: '.8rem' }}>
                      {r.employee.employeeNumber} · {r.employee.entity.code}
                    </div>
                  </td>
                  <td>
                    {leaveLabel(r.type)}
                    <div className="muted" style={{ fontSize: '.85rem' }}>
                      {dateRange(r.startDate, r.endDate, lang)}
                    </div>
                    {(r.reason || r.handoverTo) && (
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {[r.reason, r.handoverTo && `Handover: ${r.handoverTo}`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="num">{r.days}</td>
                  <td>{r.step === 'manager' ? 'Manager' : 'HR'}</td>
                  <td>
                    {r.overdue ? <span className="badge bad">{r.waitingDays} days, overdue</span> : <span className="muted">{r.waitingDays} days</span>}
                    <div className="muted" style={{ fontSize: '.8rem' }}>
                      Asked {fmtDate(r.createdAt, lang)}
                    </div>
                  </td>
                  <td>
                    <input aria-label={`Note for ${r.employee.name}`} placeholder="Optional" maxLength={500} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', gap: '.4rem' }}>
                      <button className="btn small" onClick={() => decide(r, true)}>
                        Approve
                      </button>
                      <button className="btn danger small" onClick={() => decide(r, false)}>
                        Decline
                      </button>
                    </div>
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
