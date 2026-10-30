'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { User, api, errorText, getToken, setToken } from '@/lib/api';
import { NAME_KEY } from '@/lib/session';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/approvals');
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
      setToken(res.accessToken);
      window.sessionStorage.setItem(NAME_KEY, res.user.name ?? res.user.email);
      router.replace('/approvals');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/logo-mark.svg" alt="" />
          <h1>Mindspace ERP</h1>
          <div className="muted">Sign in with your work email</div>
        </div>
        {error && <div className="error">{error}</div>}
        <label className="field">
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
