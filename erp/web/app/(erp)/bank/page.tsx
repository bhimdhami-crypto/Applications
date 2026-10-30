'use client';

import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Account, BankAccountRow, api, errorText } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

const firstOfMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** The company's bank accounts, each with its ledger and statement balance and what is left to match */
export default function BankAccountsPage() {
  const { company, can } = useSession();
  const [accounts, setAccounts] = useState<BankAccountRow[] | null>(null);
  const [gl, setGl] = useState<Account[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ glAccountId: '', name: '', bankName: '', accountNumber: '', currencyCode: '', reconcileFrom: firstOfMonth() });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<BankAccountRow[]>(`/companies/${company.code}/bank-accounts`)
      .then(setAccounts)
      .catch((e) => setError(errorText(e)));
  }, [company.code]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!adding) return;
    api<Account[]>(`/companies/${company.code}/accounts`)
      .then((a) => setGl(a.filter((x) => x.isPostable && x.type === 'ASSET' && !x.subledger)))
      .catch((e) => setError(errorText(e)));
  }, [adding, company.code]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/companies/${company.code}/bank-accounts`, {
        method: 'POST',
        body: {
          glAccountId: Number(form.glAccountId),
          name: form.name,
          bankName: form.bankName || undefined,
          accountNumber: form.accountNumber || undefined,
          currencyCode: form.currencyCode || undefined,
          reconcileFrom: form.reconcileFrom,
        },
      });
      setAdding(false);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const taken = new Set(accounts?.map((a) => a.glAccount.id));

  return (
    <>
      <div className="page-head">
        <h1>Bank reconciliation</h1>
        <div className="spacer" />
        {can('FINANCE_MANAGER') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add bank account
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {adding && (
        <form className="card fields" onSubmit={add} style={{ alignItems: 'end' }}>
          <label className="field" style={{ gridColumn: 'span 2' }}>
            Ledger account
            <select
              value={form.glAccountId}
              required
              onChange={(e) => {
                const a = gl.find((x) => x.id === Number(e.target.value));
                setForm({ ...form, glAccountId: e.target.value, name: form.name || a?.description || '', currencyCode: /USD/i.test(a?.description ?? '') ? 'USD' : form.currencyCode });
              }}
            >
              <option value="">Choose the bank's GL account</option>
              {gl
                .filter((a) => !taken.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.description}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} />
          </label>
          <label className="field">
            Bank
            <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="Standard Chartered" maxLength={100} />
          </label>
          <label className="field">
            Account number
            <input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} maxLength={50} />
          </label>
          <label className="field">
            Currency
            <input value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })} placeholder={company.homeCurrency} maxLength={3} />
          </label>
          <label className="field" title="Ledger rows before this date were reconciled in Evolution and are left out">
            Reconcile from
            <input type="date" value={form.reconcileFrom} onChange={(e) => setForm({ ...form, reconcileFrom: e.target.value })} required />
          </label>
          <div className="actions-bar">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {accounts?.length === 0 && !adding && (
        <div className="card empty">
          No bank accounts set up for reconciliation yet.{can('FINANCE_MANAGER') ? ' Add one to start importing statements.' : ' A finance manager can add them.'}
        </div>
      )}
      <div className="bank-cards">
        {accounts?.map((a) => {
          const reviewed = a.lastReconciliation?.reviewedAt;
          return (
            <Link key={a.id} href={`/bank/${a.id}`} className="card bank-card">
              <div className="bank-card-head">
                <Landmark size={18} />
                <div>
                  <strong>{a.name}</strong>
                  <div className="muted">
                    {[a.bankName, a.accountNumber, `GL ${a.glAccount.code}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="bank-figures">
                <div>
                  <span>Ledger balance</span>
                  {a.currencyCode} {formatAmount(a.ledgerBalance)}
                </div>
                <div>
                  <span>Statement{a.statementDate ? ` at ${formatDate(a.statementDate)}` : ''}</span>
                  {a.statementBalance ? `${a.currencyCode} ${formatAmount(a.statementBalance)}` : <em className="muted">No statement yet</em>}
                </div>
                <div>
                  <span>To match</span>
                  {a.unmatchedLines} on the statement · {a.unmatchedEntries} in the ledger
                </div>
                <div>
                  <span>Last reconciliation</span>
                  {a.lastReconciliation ? (
                    <>
                      {formatDate(a.lastReconciliation.asAt)} {reviewed ? <span className="badge POSTED">Reviewed</span> : <span className="badge SUBMITTED">Awaiting review</span>}
                    </>
                  ) : (
                    <em className="muted">None</em>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
