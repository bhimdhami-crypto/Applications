'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';

type Status = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

interface Message {
  id: number;
  kind: string;
  toEmail: string;
  subject: string;
  text: string;
  status: Status;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  voucher: { voucherNo: string } | null;
}

interface Outbox {
  configured: boolean;
  counts: Partial<Record<Status, number>>;
  messages: Message[];
}

const STATUS_LABEL: Record<Status, string> = { PENDING: 'Waiting to send', SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Not sent' };
const STATUS_CLASS: Record<Status, string> = { PENDING: 'SUBMITTED', SENT: 'POSTED', FAILED: 'REJECTED', SKIPPED: 'DRAFT' };
const KIND_LABEL: Record<string, string> = {
  APPROVAL_NEEDED: 'Approval needed',
  REJECTED: 'Rejected',
  POSTED: 'Posted',
  DIGEST: 'Morning reminder',
  TEST: 'Test',
};

const when = (at: string) => new Date(at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** For administrators: every approval email, whether it went out, and why not if it did not */
export default function EmailOutboxPage() {
  const { user } = useSession();
  const [status, setStatus] = useState<Status | ''>('');
  const [box, setBox] = useState<Outbox | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<Outbox>(`/email/outbox${status ? `?status=${status}` : ''}`)
      .then(setBox)
      .catch((e) => setError(errorText(e)));
  }, [status]);
  useEffect(load, [load]);

  async function act(path: string, done: (r: { status: Status; lastError: string | null; toEmail?: string }) => string) {
    setError('');
    setNotice('');
    try {
      const r = await api<{ status: Status; lastError: string | null; toEmail?: string }>(path, { method: 'POST' });
      if (r.status === 'SENT') setNotice(done(r));
      else setError(r.lastError ?? STATUS_LABEL[r.status]);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (user.role !== 'ADMIN') return <div className="card muted">The email outbox is for administrators.</div>;

  return (
    <>
      <div className="page-head">
        <h1>Email outbox</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => act('/email/test', (r) => `Test email sent to ${r.toEmail}`)}>
          Send me a test email
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {box && !box.configured && (
        <div className="warning" style={{ marginTop: 0, marginBottom: 14 }}>
          Email is not set up on the server, so alerts are recorded here but not sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM for the API
          (see the README), restart it, then use Retry on anything you still want delivered.
        </div>
      )}
      <div className="outbox-tiles">
        {(['SENT', 'PENDING', 'FAILED', 'SKIPPED'] as Status[]).map((s) => (
          <button key={s} className={`outbox-tile${status === s ? ' active' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>
            <span>{STATUS_LABEL[s]}</span>
            <strong>{box?.counts[s] ?? 0}</strong>
          </button>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Queued</th>
              <th>To</th>
              <th>Email</th>
              <th>Voucher</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {box?.messages.map((m) => (
              <Fragment key={m.id}>
                <tr className="clickable" onClick={() => setOpen(open === m.id ? null : m.id)}>
                  <td className="muted">{when(m.createdAt)}</td>
                  <td>{m.toEmail}</td>
                  <td>
                    <div>{m.subject}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </div>
                  </td>
                  <td>{m.voucher ? <Link href={`/vouchers/${encodeURIComponent(m.voucher.voucherNo)}`} onClick={(e) => e.stopPropagation()}>{m.voucher.voucherNo}</Link> : ''}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                    {m.lastError && (
                      <div className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
                        {m.lastError}
                        {m.attempts > 1 && ` (${m.attempts} tries)`}
                      </div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    {(m.status === 'FAILED' || m.status === 'SKIPPED') && (
                      <button className="btn small" onClick={() => act(`/email/outbox/${m.id}/retry`, () => `Sent to ${m.toEmail}`)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
                {open === m.id && (
                  <tr>
                    <td colSpan={6}>
                      <pre className="email-body">{m.text}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {box?.messages.length === 0 && <div className="empty">No emails{status ? ` ${STATUS_LABEL[status].toLowerCase()}` : ''} yet.</div>}
      </div>
    </>
  );
}
