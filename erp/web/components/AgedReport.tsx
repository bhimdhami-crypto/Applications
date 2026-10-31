'use client';

import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AgedReport as Aged, Buckets, PartyKind, api, errorText } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatAmount, formatDate, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

const COLUMNS: [keyof Buckets, string][] = [
  ['current', 'Current'],
  ['days1to30', '1–30 days'],
  ['days31to60', '31–60 days'],
  ['days61to90', '61–90 days'],
  ['over90', 'Over 90 days'],
];

/** Aged debtors (customers) or creditors (suppliers), checked against the control accounts */
export function AgedReport({ kind }: { kind: PartyKind }) {
  const router = useRouter();
  const { company } = useSession();
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Aged | null>(null);
  const [error, setError] = useState('');
  const title = kind === 'CUSTOMER' ? 'Aged debtors' : 'Aged creditors';
  const who = kind === 'CUSTOMER' ? 'Customer' : 'Supplier';

  const load = useCallback(() => {
    setError('');
    api<Aged>(`/companies/${company.code}/reports/aged?kind=${kind}&asAt=${asAt}`)
      .then(setReport)
      .catch((e) => setError(errorText(e)));
    // The date is read when the form is sent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.code, kind]);
  useEffect(load, [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    load();
  }

  function exportCsv() {
    if (!report) return;
    downloadCsv(`${company.code} ${title.toLowerCase()} ${report.asAt}.csv`, [
      [who, 'Name', 'Terms (days)', 'Credit limit', ...COLUMNS.map(([, l]) => l), 'Balance'],
      ...report.rows.map((r) => [r.code, r.name, r.termsDays, r.creditLimit, ...COLUMNS.map(([k]) => r[k]), r.balance]),
      ['Total', '', '', '', ...COLUMNS.map(([k]) => report.totals[k]), report.total],
      ['Control accounts', report.controlAccounts.join('; '), '', '', '', '', '', '', '', report.controlBalance],
      ['Difference', '', '', '', '', '', '', '', '', report.difference],
    ]);
  }

  const agrees = report && toUnits(report.difference) === 0n;
  const overdue = report ? COLUMNS.slice(1).reduce((sum, [k]) => sum + toUnits(report.totals[k]), 0n) : 0n;
  const statement = (partyId: number) => {
    const from = `${asAt.slice(0, 4)}-01-01`;
    router.push(`/reports/statement?party=${partyId}&from=${from}&to=${asAt}`);
  };

  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        <div className="spacer" />
        {report && (
          <>
            <button className="btn" onClick={exportCsv}>
              <Download size={15} /> Excel (CSV)
            </button>
            <button className="btn" onClick={() => window.print()}>
              Print
            </button>
          </>
        )}
      </div>
      <form className="card fields no-print" onSubmit={submit} style={{ alignItems: 'end' }}>
        <label className="field">
          As at
          <input type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} required />
        </label>
        <button className="btn primary">Show</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="print-only">
        <h2>
          {company.name} · {title} as at {report && formatDate(report.asAt)}
        </h2>
      </div>
      {report && (
        <>
          <div className="summary-strip">
            <div>
              <span>Total {kind === 'CUSTOMER' ? 'owed to us' : 'we owe'}</span>
              <strong>{formatAmount(report.total)}</strong>
            </div>
            <div className={overdue > 0n ? 'overdue' : ''}>
              <span>Overdue</span>
              <strong>{formatAmount(overdue)}</strong>
            </div>
            <div className={toUnits(report.totals.over90) > 0n ? 'overdue' : ''}>
              <span>Over 90 days</span>
              <strong>{formatAmount(report.totals.over90)}</strong>
            </div>
            <div>
              <span>{kind === 'CUSTOMER' ? 'Customers' : 'Suppliers'} with a balance</span>
              <strong>{report.rows.length}</strong>
            </div>
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{who}</th>
                  <th>Name</th>
                  {COLUMNS.map(([k, l]) => (
                    <th key={k} className="num">
                      {l}
                    </th>
                  ))}
                  <th className="num">Balance ({report.currency})</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.partyId} className="clickable" onClick={() => statement(r.partyId)} title="Open the statement">
                    <td>{r.code}</td>
                    <td>
                      {r.name}
                      {r.overLimit && <span className="tag" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Over limit</span>}
                    </td>
                    {COLUMNS.map(([k], i) => (
                      <td key={k} className={`num${i > 0 && toUnits(r[k]) > 0n ? ' overdue' : ''}`}>
                        {toUnits(r[k]) !== 0n && formatAmount(r[k])}
                      </td>
                    ))}
                    <td className="num">{formatAmount(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  {COLUMNS.map(([k]) => (
                    <td key={k} className="num">
                      {formatAmount(report.totals[k])}
                    </td>
                  ))}
                  <td className="num">{formatAmount(report.total)}</td>
                </tr>
              </tfoot>
            </table>
            {report.rows.length === 0 && <div className="empty">No {kind === 'CUSTOMER' ? 'customer' : 'supplier'} balances at this date.</div>}
          </div>

          <div className="card check">
            <strong>Check against the ledger</strong>
            {report.controlAccounts.length ? (
              <>
                <span>
                  {report.controlAccounts.join(', ')}: {formatAmount(report.controlBalance)}
                </span>
                <span className={`badge ${agrees ? 'POSTED' : 'REJECTED'}`}>
                  {agrees ? 'Agrees with the control account' : `Differs by ${formatAmount(report.difference)}`}
                </span>
              </>
            ) : (
              <span className="muted">
                No account is marked as {kind === 'CUSTOMER' ? 'Debtors' : 'Creditors'} Control yet. Set it on the Chart of accounts page.
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
}
