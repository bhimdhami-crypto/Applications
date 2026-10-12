'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { amount, api, money, PayLine, PayrollRun, periodName } from '@/lib/api';
import { useSession } from '@/lib/session';

const line = (lines: PayLine[], code: string) => lines.find((l) => l.code === code)?.amount;

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<PayrollRun>(`/payroll/runs/${id}`).then(setRun).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function act(action: 'recalculate' | 'approve' | 'finalize', confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/payroll/runs/${id}/${action}`, { method: 'POST' });
      setNotice(
        { recalculate: 'Recalculated from current employee pay.', approve: 'Approved. Finalize it to publish payslips.', finalize: 'Finalized. Payslips are published and employees were emailed.' }[action],
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!run) return error ? <div className="notice error">{error}</div> : <div className="loading">Loading…</div>;
  const cur = run.company.currency;
  const period = periodName(run.periodYear, run.periodMonth);
  const isAdmin = me.role === 'ADMIN';

  return (
    <>
      <p><Link href="/payroll">← All payroll runs</Link></p>
      <h1>
        {run.company.name}, {period} <span className={`badge ${run.status}`}>{run.status}</span>
      </h1>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      {!run.rulesVerified && (
        <div className="notice warn">
          Tax rules {run.rulesVersion} are a draft that a local payroll adviser has not signed off yet. Use this run for testing, not real pay.
        </div>
      )}

      <div className="grid">
        <div className="card stat"><div className="label">Gross pay</div><div className="value">{money(run.totalGross, cur)}</div></div>
        <div className="card stat"><div className="label">Deductions</div><div className="value">{money(run.totalDeductions, cur)}</div></div>
        <div className="card stat"><div className="label">Net pay</div><div className="value">{money(run.totalNet, cur)}</div></div>
        <div className="card stat"><div className="label">Employer cost</div><div className="value">{money(run.totalEmployerCost, cur)}</div></div>
      </div>

      <div className="actions" style={{ marginBottom: '1rem' }}>
        {run.status === 'DRAFT' && (
          <button className="secondary" disabled={busy} onClick={() => act('recalculate')}>Recalculate</button>
        )}
        {isAdmin && run.status === 'DRAFT' && (
          <button disabled={busy} onClick={() => act('approve', `Approve ${period} payroll for ${run.company.name}?`)}>Approve</button>
        )}
        {isAdmin && run.status === 'APPROVED' && (
          <button disabled={busy} onClick={() => act('finalize', `Finalize ${period}? Payslips are published and every employee is emailed. This cannot be undone.`)}>
            Finalize and publish payslips
          </button>
        )}
        {!isAdmin && run.status !== 'FINALIZED' && <span className="muted">Waiting for the administrator to approve and finalize.</span>}
      </div>

      <div className="card table-wrap">
        <p className="muted" style={{ marginTop: 0 }}>Amounts in {cur}</p>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th className="num">Gross</th>
              <th className="num">PAYE</th>
              <th className="num">NSSF</th>
              <th className="num">SHIF</th>
              <th className="num">Housing levy</th>
              <th className="num">Net</th>
              <th className="num">Employer cost</th>
            </tr>
          </thead>
          <tbody>
            {run.payslips?.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/payslips/${p.id}`}>{p.employee?.firstName} {p.employee?.lastName}</Link> <span className="muted">{p.employee?.employeeNo}</span></td>
                <td className="num">{amount(p.gross)}</td>
                <td className="num">{amount(line(p.lines, 'PAYE'))}</td>
                <td className="num">{amount(line(p.lines, 'NSSF'))}</td>
                <td className="num">{amount(line(p.lines, 'SHIF'))}</td>
                <td className="num">{amount(line(p.lines, 'AHL'))}</td>
                <td className="num">{amount(p.net)}</td>
                <td className="num">{amount(p.employerCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
