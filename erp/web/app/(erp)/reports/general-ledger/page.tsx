'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Account, GeneralLedger, api, errorText } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatAmount, formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

const label = (a: { code: string; description: string }) => `${a.code} · ${a.description}`;

export default function GeneralLedgerPage() {
  const { company } = useSession();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [accountText, setAccountText] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Account[]>(`/companies/${company.code}/accounts`)
      .then((a) => setAccounts(a.filter((x) => x.isPostable)))
      .catch((e) => setError(errorText(e)));
  }, [company.code]);

  const load = useCallback(
    (accountCode?: string) => {
      setError('');
      setBusy(true);
      const params = new URLSearchParams({ from, to });
      if (accountCode) params.set('account', accountCode);
      api<GeneralLedger>(`/companies/${company.code}/reports/general-ledger?${params}`)
        .then(setGl)
        .catch((e) => {
          setGl(null);
          setError(errorText(e));
        })
        .finally(() => setBusy(false));
    },
    // Dates are read when the form is sent
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.code],
  );

  const accountCode = () => {
    const t = accountText.trim().toLowerCase();
    if (!t) return undefined;
    const a = accounts.find((x) => label(x).toLowerCase() === t) ?? accounts.find((x) => x.code.toLowerCase() === t);
    return a?.code ?? accountText.trim();
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    load(accountCode());
  }

  function exportCsv() {
    if (!gl) return;
    const rows: (string | null)[][] = [['Account', 'Description', 'Date', 'Audit no', 'Voucher', 'Reference', 'Line description', 'Customer or supplier', 'Currency', 'Foreign amount', 'Debit', 'Credit', 'Balance']];
    for (const a of gl.accounts) {
      rows.push([a.code, a.description, gl.from, '', '', '', 'Opening balance', '', '', '', '', '', a.opening]);
      for (const r of a.rows) {
        rows.push([a.code, a.description, r.txDate, r.auditNo, r.voucherNo, r.reference, r.description, r.party, r.currencyCode, r.foreignAmount, r.debit, r.credit, r.balance]);
      }
      rows.push([a.code, a.description, gl.to, '', '', '', 'Closing balance', '', '', '', a.debit, a.credit, a.closing]);
    }
    downloadCsv(`${company.code} general ledger ${gl.from} to ${gl.to}.csv`, rows);
  }

  return (
    <>
      <div className="page-head">
        <h1>General ledger</h1>
        <div className="spacer" />
        {gl && (
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
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="field">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          Account (leave empty for all)
          <input list="gl-accounts" value={accountText} onChange={(e) => setAccountText(e.target.value)} placeholder="Code or name" />
          <datalist id="gl-accounts">
            {accounts.map((a) => (
              <option key={a.id} value={label(a)} />
            ))}
          </datalist>
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Working…' : 'Show'}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="print-only">
        <h2>
          {company.name} · General ledger {gl && `${formatDate(gl.from)} to ${formatDate(gl.to)}`}
        </h2>
      </div>
      {gl && gl.accounts.length === 0 && <div className="card empty">Nothing posted to these accounts in this period.</div>}
      {gl?.accounts.map((a) => (
        <div className="card report-account" key={a.accountId}>
          <h3>
            {a.code} {a.description}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {a.rows.length} posting{a.rows.length === 1 ? '' : 's'}
            </span>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Audit no</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th>Customer or supplier</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance ({gl.currency})</th>
                </tr>
              </thead>
              <tbody>
                <tr className="opening">
                  <td>{formatDate(gl.from)}</td>
                  <td colSpan={6}>Opening balance</td>
                  <td className="num">{formatAmount(a.opening)}</td>
                </tr>
                {a.rows.map((r, i) => (
                  <tr key={`${r.auditNo}-${i}`}>
                    <td>{formatDate(r.txDate)}</td>
                    <td>{r.voucherNo ? <Link href={`/vouchers/${r.voucherNo}`}>{r.auditNo}</Link> : r.auditNo}</td>
                    <td>{r.reference}</td>
                    <td>
                      {r.description}
                      {r.foreignAmount && (
                        <span className="muted">
                          {' '}
                          ({r.currencyCode} {formatAmount(r.foreignAmount)})
                        </span>
                      )}
                    </td>
                    <td>{r.party}</td>
                    <td className="num">{r.debit !== '0.00' && formatAmount(r.debit)}</td>
                    <td className="num">{r.credit !== '0.00' && formatAmount(r.credit)}</td>
                    <td className="num">{formatAmount(r.balance)}</td>
                  </tr>
                ))}
                <tr className="closing">
                  <td>{formatDate(gl.to)}</td>
                  <td colSpan={4}>Closing balance</td>
                  <td className="num">{formatAmount(a.debit)}</td>
                  <td className="num">{formatAmount(a.credit)}</td>
                  <td className="num">{formatAmount(a.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {gl && gl.accounts.length > 1 && (
        <div className="card check">
          <strong>Movement in the period</strong>
          <span>Debits {formatAmount(gl.totalDebit)}</span>
          <span>Credits {formatAmount(gl.totalCredit)}</span>
          <span className={`badge ${gl.totalDebit === gl.totalCredit ? 'POSTED' : 'REJECTED'}`}>
            {gl.totalDebit === gl.totalCredit ? 'Debits equal credits' : 'Does not balance'}
          </span>
        </div>
      )}
    </>
  );
}
