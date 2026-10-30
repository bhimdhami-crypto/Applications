'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { TrialBalance, api, errorText } from '@/lib/api';
import { formatAmount, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

const TYPE_LABEL: Record<string, string> = { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' };

export default function TrialBalancePage() {
  const { company } = useSession();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<TrialBalance>(`/companies/${company.code}/trial-balance?from=${from}&to=${to}`)
      .then(setTb)
      .catch((e) => setError(errorText(e)));
    // Dates are read when the form is sent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.code]);
  useEffect(load, [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    load();
  }

  const agrees = tb && toUnits(tb.totalDebit) === toUnits(tb.totalCredit);

  return (
    <>
      <div className="page-head">
        <h1>Trial balance</h1>
        <div className="spacer" />
        {tb && <span className={`badge ${agrees ? 'POSTED' : 'REJECTED'}`}>{agrees ? 'Debits equal credits' : 'Does not balance'}</span>}
      </div>
      <form className="card fields" onSubmit={submit} style={{ alignItems: 'end' }}>
        <label className="field">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="field">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <button className="btn primary">Show</button>
      </form>
      {error && <div className="error">{error}</div>}
      {tb && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                <th>Type</th>
                <th className="num">Debit ({tb.currency})</th>
                <th className="num">Credit ({tb.currency})</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.accountId}>
                  <td>{r.code}</td>
                  <td>{r.description}</td>
                  <td className="muted">{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="num">{formatAmount(r.debit)}</td>
                  <td className="num">{formatAmount(r.credit)}</td>
                  <td className="num">{formatAmount(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num">{formatAmount(tb.totalDebit)}</td>
                <td className="num">{formatAmount(tb.totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {tb.rows.length === 0 && <div className="empty">Nothing posted in this period.</div>}
        </div>
      )}
    </>
  );
}
