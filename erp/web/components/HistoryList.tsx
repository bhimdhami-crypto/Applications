'use client';

import Link from 'next/link';
import { HistoryEntry } from '@/lib/api';

/** What each action is called in the change history */
export const ACTION_LABEL: Record<string, string> = {
  'voucher.created': 'Created voucher',
  'voucher.created_from_files': 'Created voucher from files',
  'voucher.updated': 'Edited voucher',
  'voucher.submitted': 'Submitted for approval',
  'voucher.approved': 'Approved',
  'voucher.rejected': 'Rejected',
  'voucher.recalled': 'Recalled for changes',
  'voucher.cancelled': 'Cancelled voucher',
  'voucher.reversal_drafted': 'Drafted a reversal',
  'gl.journal_posted': 'Posted journal',
  'gl.reversal_posted': 'Posted reversal',
  'gl.intercompany_posted': 'Posted intercompany journal',
  'gl.account_created': 'Added account',
  'gl.account_updated': 'Changed account',
  'party.created': 'Added',
  'party.updated': 'Changed',
  'archive.attached': 'Attached files',
  'archive.removed': 'Removed a file',
  'approval.matrix_changed': 'Changed approval rules',
  'ic.link_created': 'Linked intercompany account',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
};

export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

export const when = (at: string) =>
  new Date(at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One line of plain text per entry, for the CSV export */
export function detailText(e: HistoryEntry): string {
  const d = e.detail;
  if (!d) return '';
  const parts: string[] = [];
  for (const c of d.changes ?? []) parts.push(`${c.field}: ${c.from ?? '(blank)'} → ${c.to ?? '(blank)'}`);
  for (const l of d.removedLines ?? []) parts.push(`Removed line: ${l}`);
  for (const l of d.addedLines ?? []) parts.push(`Added line: ${l}`);
  if (d.stage) parts.push(`Stage ${d.stage}`);
  if (d.comment) parts.push(`Comment: ${d.comment}`);
  if (d.reason) parts.push(`Reason: ${d.reason}`);
  if (d.files) parts.push(d.files.join(', '));
  if (d.file) parts.push(d.file);
  if (d.auditNo && e.action.startsWith('voucher.')) parts.push(`Journal ${d.auditNo}`);
  return parts.join('; ');
}

function Detail({ e }: { e: HistoryEntry }) {
  const d = e.detail;
  if (!d) return null;
  return (
    <div className="history-detail">
      {!!d.changes?.length && (
        <table className="changes">
          <tbody>
            {d.changes.map((c) => (
              <tr key={c.field}>
                <td className="muted">{c.field}</td>
                <td>
                  <del>{c.from ?? 'blank'}</del>
                </td>
                <td>
                  <ins>{c.to ?? 'blank'}</ins>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.removedLines?.map((l, i) => (
        <div key={`r${i}`} className="line-change removed">
          − {l}
        </div>
      ))}
      {d.addedLines?.map((l, i) => (
        <div key={`a${i}`} className="line-change added">
          + {l}
        </div>
      ))}
      {(d.comment || d.reason) && <div>“{d.comment ?? d.reason}”</div>}
      {d.files && <div className="muted">{d.files.join(', ')}</div>}
      {d.file && <div className="muted">{d.file}</div>}
    </div>
  );
}

/** Entries in the order given. Pass showRecord on the company-wide trail, where entries are for many records. */
export function HistoryList({
  entries,
  showRecord = false,
  linkFor,
}: {
  entries: HistoryEntry[];
  showRecord?: boolean;
  linkFor?: (e: HistoryEntry) => string | null;
}) {
  if (!entries.length) return <div className="empty">Nothing recorded yet.</div>;
  return (
    <ul className="history">
      {entries.map((e) => (
        <li key={e.id} className={e.action.replace('.', '-')}>
          <div>
            <strong>{actionLabel(e.action)}</strong>
            {showRecord && e.label && (
              <>
                {' · '}
                {linkFor?.(e) ? <Link href={linkFor(e)!}>{e.label}</Link> : e.label}
              </>
            )}
            {e.detail?.stage ? ` (stage ${e.detail.stage})` : ''}
          </div>
          <div className="muted history-meta">
            {e.user ?? 'Unknown user'} · {when(e.at)}
          </div>
          <Detail e={e} />
        </li>
      ))}
    </ul>
  );
}
