'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Account, api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';

const TYPES: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const TYPE_LABEL: Record<string, string> = { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' };
const CONTROL_LABEL: Record<string, string> = { AR: 'Debtors Control', AP: 'Creditors Control' };

export default function Accounts() {
  const { company, canPrepare, can } = useSession();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ code: '', description: '', type: 'EXPENSE' as Account['type'], isPostable: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<Account[]>(`/companies/${company.code}/accounts`)
      .then(setAccounts)
      .catch((e) => setError(errorText(e)));
  }, [company.code]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api(`/companies/${company.code}/accounts`, { method: 'POST', body: form });
      setNotice(`Account ${form.code} added`);
      setForm({ ...form, code: '', description: '' });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  // A control account's lines must name a customer (AR) or supplier (AP); the server refuses a change that posted rows contradict
  async function setControl(a: Account, subledger: string) {
    setError('');
    setNotice('');
    try {
      await api(`/companies/${company.code}/accounts/${a.id}`, { method: 'PATCH', body: { subledger: subledger || null } });
      setNotice(subledger ? `${a.code} is now ${CONTROL_LABEL[subledger]}` : `${a.code} is a plain account again`);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const shown = accounts?.filter((a) => !filter || `${a.code} ${a.description}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <h1>Chart of accounts</h1>
        <div className="spacer" />
        <input placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {canPrepare && (
        <form className="card fields" onSubmit={add} style={{ alignItems: 'end' }}>
          <label className="field">
            Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required maxLength={50} />
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}>
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required maxLength={200} />
          </label>
          <label className="field">
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Use
            <select value={form.isPostable ? 'post' : 'header'} onChange={(e) => setForm({ ...form, isPostable: e.target.value === 'post' })}>
              <option value="post">Takes postings</option>
              <option value="header">Header (groups others)</option>
            </select>
          </label>
          <button className="btn primary">Add account</button>
        </form>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Type</th>
              <th>Use</th>
              <th>Control account</th>
            </tr>
          </thead>
          <tbody>
            {shown?.map((a) => (
              <tr key={a.id} style={a.isActive ? undefined : { opacity: 0.55 }}>
                <td>{a.code}</td>
                <td>{a.description}</td>
                <td>{TYPE_LABEL[a.type] ?? a.type}</td>
                <td className="muted">{a.isPostable ? 'Takes postings' : 'Header'}</td>
                <td>
                  {can('FINANCE_MANAGER') && a.isPostable ? (
                    <select value={a.subledger ?? ''} onChange={(e) => setControl(a, e.target.value)} aria-label={`Control account setting for ${a.code}`}>
                      <option value="">No</option>
                      <option value="AR">Debtors Control (customers)</option>
                      <option value="AP">Creditors Control (suppliers)</option>
                    </select>
                  ) : (
                    <span className="muted">{a.subledger ? CONTROL_LABEL[a.subledger] : ''}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown?.length === 0 && <div className="empty">No accounts yet. Load them from Evolution with the migration tool, or add them here.</div>}
      </div>
    </>
  );
}
