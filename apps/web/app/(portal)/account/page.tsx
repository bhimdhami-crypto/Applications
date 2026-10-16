'use client';

import { FormEvent, useState } from 'react';
import { ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';

interface DeviceSession {
  id: string;
  client: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export default function Account() {
  const { me } = useSession();
  const { t, lang } = usePrefs();
  const sessions = useLoad(() => api<DeviceSession[]>('/auth/sessions'), []);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setPw({ currentPassword: '', newPassword: '' });
      setMsg({ ok: true, text: 'Password changed. Your other devices have been signed out.' });
      sessions.reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <>
      <PageHead title={t('nav.account')} sub={`${me.user.displayName} · ${me.user.email}`} />
      <div className="grid two">
        <section className="card">
          <h2>Signed-in devices</h2>
          <ErrorAlert error={sessions.error} />
          {!sessions.data ? (
            <Loading />
          ) : (
            <table>
              <tbody>
                {sessions.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.client === 'mobile' ? 'Mobile app' : 'Web browser'}</strong> {s.current && <span className="badge accent">This device</span>}
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {s.userAgent?.slice(0, 60)} · {s.ip}
                      </div>
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        Last used {fmtDate(s.lastUsedAt, lang, true)}
                      </div>
                    </td>
                    <td>
                      {!s.current && (
                        <button className="btn secondary small" onClick={() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(sessions.reload)}>
                          Sign out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <form className="card" onSubmit={change}>
          <h2>Change password</h2>
          {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
          <label className="field">
            <span>Current password</span>
            <input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </label>
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={12} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <small>At least 12 characters, with letters and numbers.</small>
          </label>
          <button className="btn">Change password</button>
        </form>
      </div>
    </>
  );
}
