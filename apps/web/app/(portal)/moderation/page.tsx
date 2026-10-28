'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ContentReport, formatDate } from '@/lib/api';
import { PageHeader } from '@/components/ui';

const STATUS_LABEL = { OPEN: 'Waiting for review', REMOVED: 'Removed', DISMISSED: 'Kept' } as const;

export default function ModerationPage() {
  const [status, setStatus] = useState<'OPEN' | 'REMOVED' | 'DISMISSED'>('OPEN');
  const [rows, setRows] = useState<ContentReport[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<ContentReport[]>(`/reports?status=${status}`).then(setRows).catch((e) => setError(e.message));
  }, [status]);
  useEffect(load, [load]);

  async function review(r: ContentReport, remove: boolean) {
    setBusy(r.id);
    setError('');
    setNotice('');
    try {
      await api(`/reports/${r.id}/${remove ? 'remove' : 'dismiss'}`, { method: 'POST', body: { note: notes[r.id] || undefined } });
      setNotice(remove ? `Removed. ${r.author?.name ?? 'The author'} has been emailed.` : 'Kept. The report is closed.');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader title="Moderation" sub={<>Reported chat messages, posts and comments. Review each within 1 working day under <Link href="/policies">POL-20</Link>. Removed content is hidden but kept as a company record.</>} />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="tabs">
        {(['OPEN', 'REMOVED', 'DISMISSED'] as const).map((s) => (
          <button key={s} type="button" className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Reported</th><th>Content</th><th>Reason</th><th>{status === 'OPEN' ? 'Decision' : 'Outcome'}</th></tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="wrap">{formatDate(r.createdAt)}<div className="muted small">by {r.reporter.name}</div></td>
                <td className="wrap" style={{ minWidth: '18rem' }}>
                  <div className="muted small">{r.where}{r.author ? `, written by ${r.author.name}` : ''}</div>
                  <div className="quoted">{r.body ?? 'The content no longer exists.'}</div>
                  {r.removed && status === 'OPEN' && <div className="muted small">Already hidden by its author.</div>}
                </td>
                <td className="wrap">{r.reason}</td>
                <td className="decide">
                  {status === 'OPEN' ? (
                    <>
                      <input placeholder="Note for the author (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                      <div>
                        <button className="secondary danger small" disabled={busy === r.id} onClick={() => review(r, true)}>Remove</button>{' '}
                        <button className="secondary small" disabled={busy === r.id} onClick={() => review(r, false)}>Keep</button>
                      </div>
                    </>
                  ) : (
                    <span className="small">{STATUS_LABEL[r.status]}{r.reviewedAt ? ` on ${formatDate(r.reviewedAt)}` : ''}{r.note ? `: ${r.note}` : ''}</span>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={4} className="empty">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
