'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { ContentReport } from '@/lib/types';

const STATUS_LABEL = { OPEN: 'Waiting for review', REMOVED: 'Removed', DISMISSED: 'Kept' } as const;
type Status = keyof typeof STATUS_LABEL;

/** Reported chat messages, posts and comments by staff of the companies this HR user looks after */
export default function ModerationPage() {
  const { t, lang } = usePrefs();
  const [status, setStatus] = useState<Status>('OPEN');
  const rows = useLoad(() => api<ContentReport[]>(`/community/reports?status=${status}`), [status]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function review(r: ContentReport, remove: boolean) {
    setBusy(r.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/community/reports/${r.id}/${remove ? 'remove' : 'dismiss'}`, { method: 'POST', body: { note: notes[r.id] || undefined } });
      setNotice(remove ? `Removed. ${r.author?.name ?? 'The author'} has been emailed.` : 'Kept. The report is closed.');
      rows.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHead
        title={t('nav.moderation')}
        crumbs={<Link href="/community">{t('nav.community')}</Link>}
        sub={
          <>
            Review each report within 1 working day under <Link href="/policies">POL-20</Link>. Removed content is hidden but kept as a company record. You see reports about staff of the companies you look after.
          </>
        }
      />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || rows.error} />
      <div className="tabs" role="tablist">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {!rows.data ? (
        <Loading />
      ) : rows.data.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reported</th>
                <th>Content</th>
                <th>Reason</th>
                <th>{status === 'OPEN' ? 'Decision' : 'Outcome'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.id}>
                  <td className="wrap" style={{ minWidth: '9rem' }}>
                    {fmtDate(r.createdAt, lang, true)}
                    <div className="muted small">by {r.reporter.name}</div>
                  </td>
                  <td className="wrap" style={{ minWidth: '18rem' }}>
                    <div className="muted small">
                      {r.where}
                      {r.author ? `, written by ${r.author.name}${r.author.company ? ` (${r.author.company})` : ''}` : ''}
                    </div>
                    <div className="quoted">{r.body ?? 'The content no longer exists.'}</div>
                    {r.removed && status === 'OPEN' && <div className="muted small">Already hidden.</div>}
                  </td>
                  <td className="wrap">{r.reason}</td>
                  <td className="wrap">
                    {status === 'OPEN' ? (
                      <>
                        <input aria-label="Note for the author" placeholder="Note for the author (optional)" maxLength={500} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                        <div className="chat-new" style={{ marginTop: '.4rem' }}>
                          <button type="button" className="btn danger small" disabled={busy === r.id} onClick={() => review(r, true)}>
                            Remove
                          </button>
                          <button type="button" className="btn secondary small" disabled={busy === r.id} onClick={() => review(r, false)}>
                            Keep
                          </button>
                        </div>
                      </>
                    ) : (
                      <span className="small">
                        {STATUS_LABEL[r.status]}
                        {r.reviewedAt ? ` on ${fmtDate(r.reviewedAt, lang)}` : ''}
                        {r.note ? `: ${r.note}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
