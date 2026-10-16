'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DraftPackNote, LoanBadge, money } from '@/components/MoneyBits';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Loan, RulePackInfo } from '@/lib/types';

type BookRow = Pick<
  Loan,
  'id' | 'kind' | 'title' | 'amount' | 'currency' | 'months' | 'interestRate' | 'instalment' | 'firstMonthLabel' | 'purpose' | 'status' | 'stageLabel' | 'createdAt' | 'settleBy' | 'settledAt' | 'outstanding'
> & {
  employee: { id: string; name: string; employeeNumber: string; entity: { code: string; name: string } };
  iouOverdue: boolean;
  leaverOwes: boolean;
  canAct: boolean;
};

/** Every advance, loan and IOU in the companies where the signed-in person is Payroll or Finance */
export default function LoanBookPage() {
  const { t, lang } = usePrefs();
  const { me, can, entityId } = useSession();
  const [filter, setFilter] = useState({ entityId: entityId ?? '', kind: '', status: '' });
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const book = useLoad(() => api<{ rulePack: RulePackInfo; rows: BookRow[]; totals: Record<string, string> }>(`/loans/book?${q}`), [q]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const companies = me.entities.filter((e) => can('payroll.read', e.id) || can('finance.read', e.id));
  const m = (v: string | null | undefined, c: string) => money(v, c, lang);

  async function recover(r: BookRow) {
    if (!window.confirm(`Recover the unsettled IOU from ${r.employee.name}'s next pay? They will be emailed a notice.`)) return;
    setError(null);
    try {
      await api(`/loans/${r.id}/recover`, { method: 'POST' });
      setNotice(`${r.employee.name}'s IOU will be recovered through payroll.`);
      book.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function repay(r: BookRow) {
    const value = window.prompt(`Amount ${r.employee.name} paid back in cash or by transfer (${r.currency}, up to ${r.outstanding}):`);
    if (!value) return;
    setError(null);
    try {
      await api(`/loans/${r.id}/repayments`, { method: 'POST', body: { amount: Number(value), note: 'Paid to Finance' } });
      setNotice(`Recorded ${m(value, r.currency)} from ${r.employee.name}.`);
      book.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const rows = book.data?.rows ?? [];
  const anyAct = rows.some((r) => r.canAct);

  return (
    <>
      <PageHead title={t('nav.loanBook')} sub="Every salary advance, staff loan and IOU. Payroll deducts instalments each month; Finance records cash repayments." />
      <DraftPackNote pack={book.data?.rulePack} />
      <div className="filters">
        <label className="field">
          <span>Company</span>
          <select value={filter.entityId} onChange={(e) => setFilter({ ...filter, entityId: e.target.value })}>
            <option value="">All my companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
            <option value="">All</option>
            <option value="ADVANCE">Salary advances</option>
            <option value="LOAN">Staff loans</option>
            <option value="IOU">IOUs</option>
          </select>
        </label>
        <label className="field">
          <span>Status</span>
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
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || book.error} />

      {book.data && Object.keys(book.data.totals).length > 0 && (
        <div className="grid stats">
          {Object.entries(book.data.totals).map(([c, total]) => (
            <div className="card stat" key={c}>
              <div className="label">Outstanding in {c}</div>
              <div className="value money">{m(total, c)}</div>
            </div>
          ))}
          <div className="card stat">
            <div className="label">Needs attention</div>
            <div className="value">{rows.filter((r) => r.iouOverdue || r.leaverOwes).length}</div>
            <div className="muted small">Overdue IOUs and leavers who still owe</div>
          </div>
        </div>
      )}

      {!book.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Nothing matches these filters.</Empty>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Request</th>
                <th className="num">Amount</th>
                <th className="num">Owed</th>
                <th>Status</th>
                {anyAct && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/money?employee=${r.employee.id}`}>{r.employee.name}</Link>
                    <div className="muted small">
                      {r.employee.employeeNumber} · {r.employee.entity.code}
                    </div>
                  </td>
                  <td>
                    {r.title}
                    <div className="muted small">
                      {r.purpose} · {fmtDate(r.createdAt, lang)}
                      {r.kind === 'LOAN' && ` · ${r.months} months at ${r.interestRate}%`}
                      {r.firstMonthLabel && r.kind !== 'IOU' && ` · from ${r.firstMonthLabel}`}
                    </div>
                  </td>
                  <td className="num">
                    {m(r.amount, r.currency)}
                    {r.status === 'APPROVED' && r.kind !== 'IOU' && Number(r.outstanding) > 0 && <div className="muted small">{m(r.instalment, r.currency)} a month</div>}
                  </td>
                  <td className="num">{r.status === 'APPROVED' ? m(r.outstanding, r.currency) : ''}</td>
                  <td>
                    <LoanBadge loan={r} />
                    {r.iouOverdue && (
                      <div>
                        <span className="badge bad">Settlement overdue since {fmtDate(r.settleBy, lang)}</span>
                      </div>
                    )}
                    {r.leaverOwes && (
                      <div>
                        <span className="badge bad">Left: needs a repayment agreement</span>
                      </div>
                    )}
                  </td>
                  {anyAct && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.canAct && r.iouOverdue && (
                        <button className="btn small" onClick={() => recover(r)}>
                          Recover through payroll
                        </button>
                      )}{' '}
                      {r.canAct && r.status === 'APPROVED' && Number(r.outstanding) > 0 && (
                        <button className="btn secondary small" onClick={() => repay(r)}>
                          Record repayment
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
