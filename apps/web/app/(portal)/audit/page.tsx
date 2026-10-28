'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { History, Search } from 'lucide-react';
import { Empty, PageHeader } from '@/components/ui';
import { api, AuditEntry, ROLE_LABEL } from '@/lib/api';

interface AuditPage { items: AuditEntry[]; total: number; page: number; pageSize: number; entities: string[] }

const EMPTY = { q: '', entity: '', actor: '', from: '', to: '' };

/** Read-only audit trail for administrators: who did what, and when. */
export default function AuditPageView() {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    for (const [k, v] of Object.entries(applied)) if (v) params.set(k, v);
    setData(null);
    api<AuditPage>(`/audit?${params}`).then(setData).catch((e) => setError(e.message));
  }, [applied, page]);
  useEffect(load, [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY);

  return (
    <>
      <PageHeader title="Audit trail" sub="Every sign-in, change and approval the portal records. Entries cannot be edited or deleted." />
      {error && <div className="notice error">{error}</div>}
      <form className="toolbar" onSubmit={submit}>
        <label style={{ flex: '2 1 200px' }}>Action or record ID<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="e.g. payroll. or leave.approve" /></label>
        <label style={{ flex: '1 1 160px' }}>
          Record type
          <select value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
            <option value="">All</option>
            {data?.entities.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label style={{ flex: '1 1 180px' }}>By (email)<input value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} /></label>
        <label style={{ flex: '0 1 150px', minWidth: 140 }}>From<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label style={{ flex: '0 1 150px', minWidth: 140 }}>To<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <button type="submit"><Search size={16} /> Filter</button>
        {filtered && <button type="button" className="ghost" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); setPage(1); }}>Clear</button>}
      </form>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th /></tr></thead>
          <tbody>
            {!data && !error && <tr><td colSpan={5} className="loading"><span className="spinner" /></td></tr>}
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td className="tnum">{when(a.createdAt)}</td>
                <td>
                  {a.actor ? (
                    <span>{a.actor.name ?? a.actor.email}<span className="muted small" style={{ display: 'block' }}>{a.actor.email} · {ROLE_LABEL[a.actor.role]}</span></span>
                  ) : <span className="muted">System</span>}
                </td>
                <td><code>{a.action}</code></td>
                <td>{a.entity}<span className="muted small" style={{ display: 'block' }}>{a.entityId}</span></td>
                <td className="wrap">
                  {a.details != null && (
                    <>
                      <button className="link small" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide details' : 'Details'}</button>
                      {open === a.id && <pre className="json">{JSON.stringify(a.details, null, 2)}</pre>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={5}><Empty icon={History} title="No entries match">Try a wider date range or clear the filters.</Empty></td></tr>}
          </tbody>
        </table>
        {data && data.total > 0 && (
          <div className="pager">
            <span className="muted">{data.total.toLocaleString('en-GB')} {data.total === 1 ? 'entry' : 'entries'}</span>
            <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted small">Page {page} of {pages.toLocaleString('en-GB')}</span>
            <button className="secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
