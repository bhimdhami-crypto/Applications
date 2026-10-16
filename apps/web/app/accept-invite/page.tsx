'use client';

import { BRAND } from '@gpp/shared';
import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErrorAlert } from '@/components/ui';

function AcceptInvite() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords do not match');
    const res = await fetch('/api/auth/accept-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? 'Something went wrong'));
    setDone(body.email);
  }

  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <div className="card" style={{ width: 'min(440px, 100%)' }}>
        <h2>Set your password</h2>
        <p className="muted">{BRAND.shortName}</p>
        {done ? (
          <div className="alert success">
            Your password is set for {done}. <Link href="/sign-in">Sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <ErrorAlert error={error} />
            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <small>At least 12 characters, with letters and numbers.</small>
            </label>
            <label className="field">
              <span>Type it again</span>
              <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn">Set password</button>
          </form>
        )}
        <p className="muted" style={{ fontSize: '.78rem', marginTop: '1rem' }}>
          {BRAND.developerCredit} · {BRAND.copyright()}
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
