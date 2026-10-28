'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate, LibraryItem, openFile } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';

export default function PoliciesPage() {
  const { me, can } = useSession();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [kind, setKind] = useState<'POLICY' | 'FORM'>('POLICY');
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<LibraryItem[]>('/library').then(setItems).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const toRead = (items ?? []).filter((i) => i.kind === 'POLICY' && i.mustRead && i.active && !i.readAt);
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? [])
      .filter((i) => i.kind === kind)
      .filter((i) => !onlyUnread || (i.mustRead && !i.readAt))
      .filter((i) => words.every((w) => `${i.code} ${i.title} ${i.category} ${i.summary ?? ''}`.toLowerCase().includes(w)));
  }, [items, kind, search, onlyUnread]);
  const groups = [...new Set(shown.map((i) => i.category))].sort();

  async function open(i: LibraryItem) {
    setError('');
    try {
      await openFile(`/library/${i.id}/file`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirm(i: LibraryItem) {
    setBusy(i.id);
    setError('');
    setNotice('');
    try {
      await api(`/library/${i.id}/acknowledge`, { method: 'POST' });
      setNotice(`Thank you. We recorded that you read ${i.code} ${i.title}, version ${i.version}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        title="Policies and forms"
        sub="Mindspace group policies apply in every country; where local law gives you more, the law applies. Forms can be downloaded, filled in and sent to HR."
        actions={can('HR') && <Link className="button secondary" href="/policies/manage"><Settings2 size={16} /> Manage policies and forms</Link>}
      />
      {me.employee && toRead.length > 0 && (
        <div className="notice warn">
          You have {toRead.length} {toRead.length === 1 ? 'policy' : 'policies'} to read. Open each one, then press “I have read this policy”.{' '}
          {!onlyUnread && <button type="button" className="secondary small" onClick={() => { setKind('POLICY'); setOnlyUnread(true); }}>Show only these</button>}
        </div>
      )}
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="tabs">
        <button type="button" className={kind === 'POLICY' ? 'active' : ''} onClick={() => setKind('POLICY')}>Policies</button>
        <button type="button" className={kind === 'FORM' ? 'active' : ''} onClick={() => { setKind('FORM'); setOnlyUnread(false); }}>Forms</button>
      </div>
      <div className="toolbar">
        <label style={{ flex: 1 }}>
          Search
          <input placeholder="Code, title or topic" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {kind === 'POLICY' && me.employee && (
          <label className="inline-check"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Only policies I still need to read</label>
        )}
      </div>

      {groups.map((g) => (
        <section className="lib-group" key={g}>
          <h2 style={{ marginTop: 0 }}>{g}</h2>
          <div className="library">
            {shown.filter((i) => i.category === g).map((i) => (
              <div key={i.id} className={`doc${i.active ? '' : ' off'}`}>
                <div className="doc-head">
                  <span className="muted small">{i.code} · version {i.version}{i.owner && i.kind === 'POLICY' ? ` · ${i.owner}` : ''}</span>
                  {i.kind === 'POLICY' && i.mustRead && me.employee && (
                    i.readAt
                      ? <span className="badge CLOSED">Read {formatDate(i.readAt)}</span>
                      : <span className="badge DRAFT">{i.readEarlier ? 'Updated: read again' : 'Please read'}</span>
                  )}
                  {!i.active && <span className="badge">Hidden from staff</span>}
                </div>
                <h3>{i.title}</h3>
                {i.summary && <p className="small">{i.summary}</p>}
                <div className="doc-actions">
                  <button type="button" className="secondary small" onClick={() => open(i)}>{i.kind === 'FORM' ? 'Download form' : 'Open policy'}</button>
                  {i.kind === 'POLICY' && i.mustRead && me.employee && !i.readAt && i.active && (
                    <button type="button" className="small" disabled={busy === i.id} onClick={() => confirm(i)}>I have read this policy</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {items && shown.length === 0 && <div className="card muted">Nothing matches.</div>}
    </>
  );
}
