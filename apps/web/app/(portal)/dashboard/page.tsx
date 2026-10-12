'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, LOCATION_LABEL, money, Payslip, PayrollRun, periodName } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function DashboardPage() {
  const { me, can } = useSession();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [latest, setLatest] = useState<Payslip | null>(null);

  useEffect(() => {
    if (can('PAYROLL')) api<PayrollRun[]>('/payroll/runs').then(setRuns).catch(() => setRuns([]));
    if (me.employee) api<Payslip[]>('/payslips/me').then((p) => setLatest(p[0] ?? null)).catch(() => setLatest(null));
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
        {latest && (
          <div className="card stat">
            <div className="label">Latest net pay</div>
            <div className="value">{money(latest.net, latest.currency)}</div>
            <Link href={`/payslips/${latest.id}`}>
              {latest.run ? periodName(latest.run.periodYear, latest.run.periodMonth) : 'Open'} payslip
            </Link>
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
