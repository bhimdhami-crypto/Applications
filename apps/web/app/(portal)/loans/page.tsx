'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, Company, formatDate, LoanKind, loanStatus, money, RequestStatus } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';

interface BookRow {
  id: string;
  kind: LoanKind;
  title: string;
  amount: string;
  currency: string;
  months: number;
  interestRate: number;
  instalment: string;
  firstMonthLabel: string | null;
  purpose: string;
  status: RequestStatus;
  stageLabel: string | null;
  createdAt: string;
  settleBy: string | null;
  settledAt: string | null;
  employee: { id: string; name: string; employeeNo: string; company: string };
  outstanding: string;
  iouOverdue: boolean;
  leaverOwes: boolean;
}

export default function LoanBookPage() {
  const { can } = useSession();
  const finance = can('FINANCE');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filter, setFilter] = useState({ companyId: '', kind: '', status: '' });
  const [data, setData] = useState<{ rows: BookRow[]; totals: Record<string, string> } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.countryCode !== 'US'))).catch(() => setCompanies([]));
  }, []);

  const load = useCallback(() => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    api<{ rows: BookRow[]; totals: Record<string, string> }>(`/loans/book?${q}`).then(setData).catch((e) => setError(e.message));
  }, [filter]);
  useEffect(load, [load]);

  async function recover(r: BookRow) {
    if (!window.confirm(`Recover ${money(r.amount, r.currency)} from ${r.employee.name}'s next pay? They will be emailed a notice.`)) return;
    setError('');
    try {
      await api(`/loans/${r.id}/recover`, { method: 'POST' });
      setNotice(`${r.employee.name}'s IOU will be recovered through payroll.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function repay(r: BookRow) {
    const value = window.prompt(`Amount ${r.employee.name} paid back in cash or by transfer (${r.currency}, up to ${r.outstanding}):`);
    if (!value) return;
    setError('');
    try {
      await api(`/loans/${r.id}/repayments`, { method: 'POST', body: { amount: Number(value), note: 'Paid to Finance' } });
      setNotice(`Recorded ${money(value, r.currency)} from ${r.employee.name}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Loan book" sub={<>Every salary advance, staff loan and IOU. Payroll deducts instalments automatically; repayments are recorded when a payroll run is finalized.</>} />
      <div className="toolbar">
        <label>
          Company
          <select value={filter.companyId} onChange={(e) => setFilter({ ...filter, companyId: e.target.value })}>
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Type
          <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
            <option value="">All</option>
            <option value="ADVANCE">Salary advances</option>
            <option value="LOAN">Staff loans</option>
            <option value="IOU">IOUs</option>
          </select>
        </label>
        <label>
          Status
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">Open (waiting or repaying)</option>
            <option value="PENDING">Waiting for approval</option>
            <option value="APPROVED">Repaying or issued</option>
            <option value="CLOSED">Repaid or settled</option>
            <option value="DECLINED">Declined</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
      </div>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {data && Object.keys(data.totals).length > 0 && (
        <div className="grid">
          {Object.entries(data.totals).map(([c, total]) => (
            <div className="card stat" key={c}>
              <div className="label">Outstanding in {c}</div>
              <div className="value">{money(total, c)}</div>
            </div>
          ))}
          <div className="card stat">
            <div className="label">Needs attention</div>
            <div className="value">{data.rows.filter((r) => r.iouOverdue || r.leaverOwes).length}</div>
            <div className="muted small">Overdue IOUs and leavers who still owe</div>
          </div>
        </div>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th><th>Request</th><th className="num">Amount</th><th className="num">Owed</th><th>Status</th>{finance && <th />}</tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="wrap">
                  {can('PAYROLL') ? <Link href={`/employees/${r.employee.id}`}>{r.employee.name}</Link> : r.employee.name}
                  <div className="muted small">{r.employee.employeeNo}{filter.companyId ? '' : ` · ${r.employee.company.replace(/^Mindspace (Artificial Intelligence|Inteligencia Artificial) /, '')}`}</div>
                </td>
                <td className="wrap">
                  {r.title}
                  <div className="muted small">
                    {r.purpose} · {formatDate(r.createdAt)}
                    {r.kind === 'LOAN' && ` · ${r.months} months at ${r.interestRate}%`}
                    {r.firstMonthLabel && ` · from ${r.firstMonthLabel}`}
                  </div>
                </td>
                <td className="num">
                  {money(r.amount, r.currency)}
                  {r.status === 'APPROVED' && Number(r.outstanding) > 0 && <div className="muted small">{money(r.instalment, r.currency)} a month</div>}
                </td>
                <td className="num">{r.status === 'APPROVED' && (r.kind !== 'IOU' || r.settledAt) ? money(r.outstanding, r.currency) : ''}</td>
                <td>
                  <span className={`badge ${r.status}`}>{loanStatus(r)}</span>
                  {r.iouOverdue && <div><span className="badge DECLINED">Settlement overdue since {formatDate(r.settleBy)}</span></div>}
                  {r.leaverOwes && <div><span className="badge DECLINED">Left: needs a repayment agreement</span></div>}
                </td>
                {finance && (
                  <td className="actions">
                    {r.iouOverdue && <button className="small" onClick={() => recover(r)}>Recover through payroll</button>}
                    {r.status === 'APPROVED' && Number(r.outstanding) > 0 && <button className="secondary small" onClick={() => repay(r)}>Record repayment</button>}
                  </td>
                )}
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={finance ? 6 : 5} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
