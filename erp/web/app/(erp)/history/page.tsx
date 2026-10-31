'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { HistoryEntry, HistoryPage, api, errorText } from '@/lib/api';
import { actionLabel, detailText, HistoryList, when } from '@/components/HistoryList';
import { downloadCsv } from '@/lib/csv';
import { useSession } from '@/lib/session';

const RECORD_TYPES = [
  ['', 'All records'],
  ['Voucher', 'Vouchers'],
  ['PostingBatch', 'Posted journals'],
  ['Party', 'Customers and suppliers'],
  ['GlAccount', 'Chart of accounts'],
  ['ApprovalRule', 'Approval rules'],
  ['IntercompanyLink', 'Intercompany links'],
] as const;

interface Filters {
  entity: string;
  userId: string;
  from: string;
  to: string;
  q: string;
}

/** Where an entry's record can be opened */
function recordHref(e: HistoryEntry) {
  if (e.entity === 'Voucher' && e.label) return `/vouchers/${encodeURIComponent(e.label)}`;
  if (e.entity === 'ApprovalRule') return '/approval-rules';
  if (e.entity === 'GlAccount') return '/accounts';
  if (e.entity === 'Party') return e.label?.startsWith('Supplier') ? '/suppliers' : '/customers';
  return null;
}

/**
 * The company's change history: every edit with its old and new values, every approval and posting,
 * who did it and when. Read from the append-only audit log, so nothing here can be altered.
 */
export default function HistoryPageView() {
  const { company, can } = useSession();
  const [tab, setTab] = useState<'changes' | 'sign-ins'>('changes');
  const [filters, setFilters] = useState<Filters>({ entity: '', userId: '', from: '', to: '', q: '' });
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = can('FINANCE_MANAGER', 'DIRECTOR');

  const path = useCallback(
    (f: Filters, before?: string) => {
      const params = new URLSearchParams();
      if (tab === 'changes') {
        for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
      } else {
        if (f.from) params.set('from', f.from);
        if (f.to) params.set('to', f.to);
      }
      if (before) params.set('before', before);
      return tab === 'changes' ? `/companies/${company.code}/history?${params}` : `/sign-ins?${params}`;
    },
    [company.code, tab],
  );

  const load = useCallback(
    (f: Filters, before?: string) => {
      setError('');
      setBusy(true);
      api<HistoryPage>(path(f, before))
        .then((page) => {
          setEntries((old) => (before && old ? [...old, ...page.items] : page.items));
          setNext(page.next);
        })
        .catch((e) => setError(errorText(e)))
        .finally(() => setBusy(false));
    },
    [path],
  );

  useEffect(() => {
    if (!allowed) return;
    load(filters);
    api<Array<{ id: number; name: string }>>(`/companies/${company.code}/history/people`)
      .then(setPeople)
      .catch(() => setPeople([]));
    // Filters are applied when the form is sent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.code, tab, allowed]);

  function submit(e: FormEvent) {
    e.preventDefault();
    load(filters);
  }

  async function exportCsv() {
    // Fetch every page that matches, not just those on screen
    setBusy(true);
    try {
      const all: HistoryEntry[] = [];
      let before: string | undefined;
      do {
        const page = await api<HistoryPage>(path(filters, before));
        all.push(...page.items);
        before = page.next ?? undefined;
      } while (before && all.length < 20_000);
      downloadCsv(`${tab === 'changes' ? 'change-history' : 'sign-ins'}-${company.code}.csv`, [
        ['When (Nairobi)', 'Who', 'Action', 'Record', 'Details'],
        ...all.map((e) => [when(e.at), e.user, actionLabel(e.action), e.label, detailText(e)]),
      ]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <>
        <div className="page-head">
          <h1>Change history</h1>
        </div>
        <div className="card muted">
          The full change history is open to finance managers, directors and administrators. Each voucher, customer, supplier and account shows its own
          history.
        </div>
      </>
    );
  }

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <h1>Change history</h1>
        <div className="spacer" />
        {can('ADMIN') && (
          <div className="tabs">
            <button className={`tab${tab === 'changes' ? ' active' : ''}`} onClick={() => setTab('changes')}>
              Changes in {company.code}
            </button>
            <button className={`tab${tab === 'sign-ins' ? ' active' : ''}`} onClick={() => setTab('sign-ins')}>
              Sign-ins
            </button>
          </div>
        )}
        <button className="btn" onClick={exportCsv} disabled={busy || !entries?.length}>
          <Download size={15} /> Export CSV
        </button>
      </div>
      <form className="card fields" onSubmit={submit} style={{ alignItems: 'end' }}>
        {tab === 'changes' && (
          <>
            <label className="field">
              Record
              <select value={filters.entity} onChange={set('entity')}>
                {RECORD_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Changed by
              <select value={filters.userId} onChange={set('userId')}>
                <option value="">Anyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          From
          <input type="date" value={filters.from} onChange={set('from')} />
        </label>
        <label className="field">
          To
          <input type="date" value={filters.to} onChange={set('to')} />
        </label>
        {tab === 'changes' && (
          <label className="field">
            Search
            <input value={filters.q} onChange={set('q')} placeholder="Voucher no., account, customer" maxLength={100} />
          </label>
        )}
        <div className="actions-bar">
          <button className="btn primary" disabled={busy}>
            Show
          </button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="card">
        {entries && <HistoryList entries={entries} showRecord linkFor={recordHref} />}
        {entries?.length ? (
          <div className="actions-bar" style={{ marginTop: 14 }}>
            <span className="muted">
              {entries.length} entries shown{next ? ', more available' : ''}. Entries cannot be changed or deleted.
            </span>
            {next && (
              <button className="btn small" onClick={() => load(filters, next)} disabled={busy}>
                Show older
              </button>
            )}
          </div>
        ) : null}
        {!entries && <div className="muted">Loading…</div>}
      </div>
      <p className="muted">
        Each record also shows its own history: open a <Link href="/vouchers">voucher</Link>, or use History beside a customer, supplier or account.
      </p>
    </>
  );
}
