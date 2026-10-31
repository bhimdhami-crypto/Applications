'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Buckets, Party, Statement, api, errorText } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatAmount, formatDate, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

const AGES: [keyof Buckets, string][] = [
  ['current', 'Current'],
  ['days1to30', '1–30 days'],
  ['days31to60', '31–60 days'],
  ['days61to90', '61–90 days'],
  ['over90', 'Over 90 days'],
];

const partyLabel = (p: { code: string; name: string }) => `${p.code} · ${p.name}`;

function StatementView() {
  const router = useRouter();
  const params = useSearchParams();
  const { company } = useSession();
  const year = new Date().getFullYear();
  const [parties, setParties] = useState<Party[]>([]);
  const [partyText, setPartyText] = useState('');
  const [from, setFrom] = useState(params.get('from') ?? `${year}-01-01`);
  const [to, setTo] = useState(params.get('to') ?? new Date().toISOString().slice(0, 10));
  const [st, setSt] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const partyId = params.get('party');

  useEffect(() => {
    api<Party[]>(`/companies/${company.code}/parties`)
      .then(setParties)
      .catch((e) => setError(errorText(e)));
  }, [company.code]);

  useEffect(() => {
    if (!partyId) return;
    setError('');
    api<Statement>(`/companies/${company.code}/reports/statement?party=${partyId}&from=${params.get('from') ?? from}&to=${params.get('to') ?? to}`)
      .then((s) => {
        setSt(s);
        setPartyText(partyLabel(s.party));
      })
      .catch((e) => setError(errorText(e)));
    // Only the address decides what is shown, so a statement can be bookmarked or shared
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.code, params]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = partyText.trim().toLowerCase();
    const p = parties.find((x) => partyLabel(x).toLowerCase() === t) ?? parties.find((x) => x.code.toLowerCase() === t);
    if (!p) {
      setError('Pick a customer or supplier from the list');
      return;
    }
    router.replace(`/reports/statement?party=${p.id}&from=${from}&to=${to}`);
  }

  function exportCsv() {
    if (!st) return;
    downloadCsv(`${company.code} statement ${st.party.code} ${st.from} to ${st.to}.csv`, [
      ['Date', 'Due', 'Audit no', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      [st.from, '', '', '', 'Opening balance', '', '', st.opening],
      ...st.rows.map((r) => [r.txDate, r.dueDate, r.auditNo, r.reference, r.description, r.debit, r.credit, r.balance]),
      [st.to, '', '', '', 'Closing balance', '', '', st.closing],
      [],
      AGES.map(([, l]) => l),
      AGES.map(([k]) => st.ageing[k]),
    ]);
  }

  const isCustomer = st?.party.kind === 'CUSTOMER';
  const listHref = isCustomer ? '/customers' : '/suppliers';

  return (
    <>
      <div className="page-head">
        {st && (
          <>
            <Link href={listHref} className="muted">
              {isCustomer ? 'Customers' : 'Suppliers'}
            </Link>
            <span className="muted">/</span>
          </>
        )}
        <h1>{st ? `${st.party.name}` : 'Statement'}</h1>
        {st && <span className="muted">{st.party.code}</span>}
        <div className="spacer" />
        {st && (
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
        <label className="field" style={{ gridColumn: 'span 2' }}>
          Customer or supplier
          <input list="statement-parties" value={partyText} onChange={(e) => setPartyText(e.target.value)} placeholder="Code or name" required />
          <datalist id="statement-parties">
            {parties.map((p) => (
              <option key={p.id} value={partyLabel(p)}>
                {p.kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}
              </option>
            ))}
          </datalist>
        </label>
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

      {st && (
        <>
          <div className="print-only" style={{ marginBottom: 16 }}>
            <h2>{company.name}</h2>
            <div>
              Statement for {st.party.name} ({st.party.code}), {formatDate(st.from)} to {formatDate(st.to)}
            </div>
          </div>
          <div className="summary-strip">
            {AGES.map(([k, l], i) => (
              <div key={k} className={i > 0 && toUnits(st.ageing[k]) > 0n ? 'overdue' : ''}>
                <span>{l}</span>
                <strong>{formatAmount(st.ageing[k])}</strong>
              </div>
            ))}
            <div>
              <span>{isCustomer ? 'Owed to us' : 'We owe'}</span>
              <strong>{formatAmount(st.closing)}</strong>
            </div>
          </div>

          <div className="card table-wrap">
            <h2>Transactions</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Audit no</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance ({st.currency})</th>
                </tr>
              </thead>
              <tbody>
                <tr className="opening">
                  <td>{formatDate(st.from)}</td>
                  <td colSpan={6}>Opening balance</td>
                  <td className="num">{formatAmount(st.opening)}</td>
                </tr>
                {st.rows.map((r, i) => (
                  <tr key={`${r.auditNo}-${i}`}>
                    <td>{formatDate(r.txDate)}</td>
                    <td>{formatDate(r.dueDate)}</td>
                    <td>{r.voucherNo ? <Link href={`/vouchers/${r.voucherNo}`}>{r.auditNo}</Link> : r.auditNo}</td>
                    <td>{r.reference}</td>
                    <td>{r.description}</td>
                    <td className="num">{r.debit !== '0.00' && formatAmount(r.debit)}</td>
                    <td className="num">{r.credit !== '0.00' && formatAmount(r.credit)}</td>
                    <td className="num">{formatAmount(r.balance)}</td>
                  </tr>
                ))}
                <tr className="closing">
                  <td>{formatDate(st.to)}</td>
                  <td colSpan={6}>Closing balance</td>
                  <td className="num">{formatAmount(st.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card table-wrap">
            <h2>Open items at {formatDate(st.to)}</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th className="num">Original</th>
                  <th className="num">Still open</th>
                  <th className="num">Days overdue</th>
                </tr>
              </thead>
              <tbody>
                {st.openItems.map((o, i) => (
                  <tr key={`${o.auditNo}-${i}`}>
                    <td>{formatDate(o.txDate)}</td>
                    <td>{formatDate(o.dueDate)}</td>
                    <td>{o.reference ?? o.auditNo}</td>
                    <td>{o.description}</td>
                    <td className="num">{formatAmount(o.amount)}</td>
                    <td className="num">{formatAmount(o.open)}</td>
                    <td className={`num${o.daysOverdue > 0 ? ' overdue' : ''}`}>{o.daysOverdue > 0 ? o.daysOverdue : 'Not due'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {st.openItems.length === 0 && <div className="empty">Nothing outstanding.</div>}
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Payments and credits are set against the oldest amounts first.
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function StatementPage() {
  return (
    <Suspense fallback={<div className="loading-page">Loading…</div>}>
      <StatementView />
    </Suspense>
  );
}
