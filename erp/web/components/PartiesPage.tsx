'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { HistoryButton } from '@/components/RecordHistory';
import { Party, PartyKind, api, errorText } from '@/lib/api';
import { cleanAmount, formatAmount } from '@/lib/money';
import { useSession } from '@/lib/session';

const blank = { code: '', name: '', termsDays: '30', creditLimit: '', email: '', phone: '', taxNumber: '' };

/** Customers or suppliers of the selected company: list, search, add, and open a statement */
export function PartiesPage({ kind }: { kind: PartyKind }) {
  const router = useRouter();
  const { company, canPrepare, can } = useSession();
  const [parties, setParties] = useState<Party[] | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const plural = kind === 'CUSTOMER' ? 'Customers' : 'Suppliers';
  const word = kind === 'CUSTOMER' ? 'customer' : 'supplier';

  const load = useCallback(() => {
    api<Party[]>(`/companies/${company.code}/parties?kind=${kind}`)
      .then(setParties)
      .catch((e) => setError(errorText(e)));
  }, [company.code, kind]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api(`/companies/${company.code}/parties`, {
        method: 'POST',
        body: {
          kind,
          code: form.code.trim(),
          name: form.name.trim(),
          termsDays: Number(form.termsDays || 0),
          creditLimit: form.creditLimit ? cleanAmount(form.creditLimit) : undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          taxNumber: form.taxNumber.trim() || undefined,
        },
      });
      setNotice(`${form.name} added`);
      setForm(blank);
      setAdding(false);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function setActive(p: Party, isActive: boolean) {
    try {
      await api(`/companies/${company.code}/parties/${p.id}`, { method: 'PATCH', body: { isActive } });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const shown = parties?.filter((p) => !filter || `${p.code} ${p.name} ${p.email ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head">
        <h1>{plural}</h1>
        <div className="spacer" />
        <input placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canPrepare && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add {word}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {adding && (
        <form className="card fields" onSubmit={add} style={{ alignItems: 'end' }}>
          <label className="field">
            Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required maxLength={50} autoFocus />
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} />
          </label>
          <label className="field">
            Payment terms (days)
            <input type="number" min={0} max={365} value={form.termsDays} onChange={(e) => setForm({ ...form, termsDays: e.target.value })} />
          </label>
          <label className="field">
            Credit limit
            <input inputMode="decimal" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="None" />
          </label>
          <label className="field">
            KRA PIN
            <input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} maxLength={50} />
          </label>
          <label className="field">
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} />
          </label>
          <label className="field">
            Phone
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={50} />
          </label>
          <div className="actions-bar">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Terms</th>
              <th className="num">Credit limit</th>
              <th>Contact</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown?.map((p) => (
              <tr
                key={p.id}
                className="clickable"
                style={p.isActive ? undefined : { opacity: 0.55 }}
                onClick={() => router.push(`/reports/statement?party=${p.id}&from=${year}-01-01&to=${today}`)}
                title="Open the statement"
              >
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td className="num">{p.termsDays} days</td>
                <td className="num">{p.creditLimit ? formatAmount(p.creditLimit) : <span className="muted">None</span>}</td>
                <td className="muted">{[p.email, p.phone].filter(Boolean).join(' · ')}</td>
                <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <HistoryButton entity="Party" id={p.id} title={`${p.code} ${p.name}`} />
                  {can('FINANCE_MANAGER') && (
                    <button className="btn small ghost" onClick={() => setActive(p, !p.isActive)}>
                      {p.isActive ? 'Make inactive' : 'Make active'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown?.length === 0 && (
          <div className="empty">No {plural.toLowerCase()} yet. Load them from Evolution with the migration tool, or add them here.</div>
        )}
      </div>
    </>
  );
}
