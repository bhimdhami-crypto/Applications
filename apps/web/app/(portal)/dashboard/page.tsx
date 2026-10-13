'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActivityWeek, api, ApprovalItem, hoursAndMinutes, LeaveBalance, LeaveRequest, LOCATION_LABEL, money, Payslip, PayrollRun, periodName } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function DashboardPage() {
  const { me, can } = useSession();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [latest, setLatest] = useState<Payslip | null>(null);
  const [annual, setAnnual] = useState<LeaveBalance | null>(null);
  const [toApprove, setToApprove] = useState<LeaveRequest[]>([]);
  const [moneyQueue, setMoneyQueue] = useState<ApprovalItem[]>([]);
  const [toRead, setToRead] = useState(0);
  const [day, setDay] = useState<ActivityWeek | null>(null);
  const [owed, setOwed] = useState<{ amount: string; currency: string } | null>(null);

  useEffect(() => {
    if (can('PAYROLL')) api<PayrollRun[]>('/payroll/runs').then(setRuns).catch(() => setRuns([]));
    if (me.employee) api<Payslip[]>('/payslips/me').then((p) => setLatest(p[0] ?? null)).catch(() => setLatest(null));
    if (me.employee) api<LeaveBalance[]>('/leave/balances').then((b) => setAnnual(b.find((x) => x.type === 'ANNUAL') ?? null)).catch(() => setAnnual(null));
    if (can('HR', 'MANAGER')) api<LeaveRequest[]>('/leave/approvals').then(setToApprove).catch(() => setToApprove([]));
    if (can('HR', 'MANAGER', 'PAYROLL', 'FINANCE')) api<ApprovalItem[]>('/approvals').then(setMoneyQueue).catch(() => setMoneyQueue([]));
    if (me.employee) api<{ count: number }>('/library/pending').then((p) => setToRead(p.count)).catch(() => setToRead(0));
    if (me.employee) api<ActivityWeek>('/activity/me').then(setDay).catch(() => setDay(null));
    if (me.employee) {
      api<{ outstanding: string; employee: { currency: string } }>('/loans')
        .then((l) => setOwed(Number(l.outstanding) > 0 ? { amount: l.outstanding, currency: l.employee.currency } : null))
        .catch(() => setOwed(null));
    }
  }, [me, can]);

  const waiting = runs.filter((r) => r.status !== 'FINALIZED');
  const name = me.employee?.firstName ?? 'Administrator';

  return (
    <>
      <h1>Welcome, {name}</h1>
      <div className="grid">
        {me.employee && (
          <div className="card stat">
            <div className="label">Your role</div>
            <div className="value">{me.employee.jobTitle}</div>
            <div className="muted">
              {me.employee.department} · {LOCATION_LABEL[me.employee.workLocation as keyof typeof LOCATION_LABEL]}
            </div>
            <div className="muted">{me.employee.company.name}</div>
          </div>
        )}
        {day && (
          <div className="card stat">
            <div className="label">{day.open ? 'Clocked in' : 'My day'}</div>
            <div className="value">{hoursAndMinutes(day.days.find((d) => d.date === day.today)?.workedMinutes ?? 0)}</div>
            <Link href="/activity">{day.open ? 'Clock out or add a work note' : 'Clock in'}</Link>
          </div>
        )}
        {toRead > 0 && (
          <div className="card stat">
            <div className="label">Policies to read</div>
            <div className="value">{toRead}</div>
            <Link href="/policies">Read and confirm</Link>
          </div>
        )}
        {latest && (
          <div className="card stat">
            <div className="label">Latest net pay</div>
            <div className="value">{money(latest.net, latest.currency)}</div>
            <Link href={`/payslips/${latest.id}`}>
              {latest.run ? periodName(latest.run.periodYear, latest.run.periodMonth) : 'Open'} payslip
            </Link>
          </div>
        )}
        {annual && (
          <div className="card stat">
            <div className="label">Annual leave left this year</div>
            <div className="value">{annual.left} days</div>
            <Link href="/leave">Request leave</Link>
          </div>
        )}
        {can('HR', 'MANAGER') && (
          <div className="card stat">
            <div className="label">Leave waiting for you</div>
            <div className="value">{toApprove.length}</div>
            {toApprove.some((r) => r.overdue) && <div className="muted small">{toApprove.filter((r) => r.overdue).length} overdue</div>}
            <Link href="/leave/approvals">Open approvals</Link>
          </div>
        )}
        {owed && (
          <div className="card stat">
            <div className="label">Advances and loans you owe</div>
            <div className="value">{money(owed.amount, owed.currency)}</div>
            <Link href="/money">See repayments</Link>
          </div>
        )}
        {can('HR', 'MANAGER', 'PAYROLL', 'FINANCE') && (
          <div className="card stat">
            <div className="label">Loans and benefits waiting for you</div>
            <div className="value">{moneyQueue.length}</div>
            <Link href="/approvals">Open approvals</Link>
          </div>
        )}
        {can('PAYROLL') && (
          <div className="card stat">
            <div className="label">Payroll runs waiting</div>
            <div className="value">{waiting.length}</div>
            <Link href="/payroll">Open payroll</Link>
          </div>
        )}
      </div>

      {me.role === 'ADMIN' && waiting.length > 0 && (
        <>
          <h2>Needs your decision</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="num">Net pay</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {waiting.map((r) => (
                  <tr key={r.id}>
                    <td>{r.company.name}</td>
                    <td>{periodName(r.periodYear, r.periodMonth)}</td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td className="num">{money(r.totalNet, r.company.currency)}</td>
                    <td><Link href={`/payroll/${r.id}`}>{r.status === 'DRAFT' ? 'Review and approve' : 'Finalize'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
