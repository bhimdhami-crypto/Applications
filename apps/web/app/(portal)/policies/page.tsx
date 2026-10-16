'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, openFile } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { LibraryItem, LibraryList } from '@/lib/types';

/** The group's policies to read and confirm, and HR forms to download */
export default function PoliciesPage() {
  const { t, lang } = usePrefs();
  const list = useLoad(() => api<LibraryList>('/library'), []);
  const [kind, setKind] = useState<'POLICY' | 'FORM'>('POLICY');
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = list.data?.items;
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
    setError(null);
    try {
      await openFile(`/library/${i.id}/file`, i.fileName);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirm(i: LibraryItem) {
    setBusy(i.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/library/${i.id}/acknowledge`, { method: 'POST' });
      setNotice(`Thank you. We recorded that you read ${i.code} ${i.title}, version ${i.version}.`);
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead
        title={t('nav.policies')}
        sub="Mindspace group policies apply in every country; where local law gives you more, the law applies. Forms can be downloaded, filled in and sent to HR."
        actions={list.data && (list.data.canEdit || list.data.canReport) ? <Link href="/policies/manage">{t('nav.policiesManage')}</Link> : undefined}
      />
      <div className="alert info" role="note">
        <strong>Draft policy pack (version 0.1), carried over from the first build.</strong> These documents have not been reviewed by lawyers in each country yet.
      </div>
      {toRead.length > 0 && (
        <div className="alert warn">
          You have {toRead.length} {toRead.length === 1 ? 'policy' : 'policies'} to read. Open each one, then press “I have read this policy”.{' '}
          {!onlyUnread && (
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setKind('POLICY');
                setOnlyUnread(true);
              }}
            >
              Show only these
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || list.error} />

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={kind === 'POLICY'} onClick={() => setKind('POLICY')}>
          Policies
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'FORM'}
          onClick={() => {
            setKind('FORM');
            setOnlyUnread(false);
          }}
        >
          Forms
        </button>
      </div>
      <div className="filters">
        <label className="field" style={{ flex: '1 1 240px' }}>
          <span>Search</span>
          <input placeholder="Code, title or topic" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {kind === 'POLICY' && (
          <label className="check" style={{ marginBottom: '.8rem' }}>
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Only policies I still need to read
          </label>
        )}
      </div>

      {!items ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        groups.map((g) => (
          <section className="card" key={g}>
            <h2>{g}</h2>
            <div className="library">
              {shown
                .filter((i) => i.category === g)
                .map((i) => (
                  <div key={i.id} className={`doc${i.active ? '' : ' off'}`}>
                    <div className="doc-head">
                      <span className="muted small">
                        {i.code} · version {i.version}
                        {i.owner && i.kind === 'POLICY' ? ` · ${i.owner}` : ''}
                      </span>
                      {i.kind === 'POLICY' &&
                        i.mustRead &&
                        (i.readAt ? <span className="badge ok">Read {fmtDate(i.readAt, lang)}</span> : <span className="badge warn">{i.readEarlier ? 'Updated: read again' : 'Please read'}</span>)}
                      {!i.active && <span className="badge">Hidden from staff</span>}
                    </div>
                    <h3>{i.title}</h3>
                    {i.summary && <p className="small" style={{ margin: 0 }}>{i.summary}</p>}
                    <div className="doc-actions">
                      <button type="button" className="btn secondary small" onClick={() => open(i)}>
                        {i.kind === 'FORM' ? 'Download form' : 'Open policy'}
                      </button>
                      {i.kind === 'POLICY' && i.mustRead && !i.readAt && i.active && (
                        <button type="button" className="btn small" disabled={busy === i.id} onClick={() => confirm(i)}>
                          I have read this policy
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
