'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, Me, setToken } from '@/lib/api';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA';
const CAPTCHA_ON = SITE_KEY !== 'disabled';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Step 1: email, password and CAPTCHA. Step 2: the 6-digit code sent by email. */
export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!CAPTCHA_ON || step !== 'password' || !scriptReady || !widgetRef.current || !window.turnstile) return;
    if (widgetId.current) return;
    widgetId.current = window.turnstile.render(widgetRef.current, {
      sitekey: SITE_KEY,
      callback: setCaptchaToken,
      'expired-callback': () => setCaptchaToken(''),
    });
  }, [scriptReady, step]);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ challengeId: string; message: string }>('/auth/login', {
        method: 'POST',
        body: { email, password, captchaToken: captchaToken || undefined },
      });
      setChallengeId(res.challengeId);
      setMessage(res.message);
      setStep('code');
      widgetId.current = null;
    } catch (err) {
      setError((err as Error).message);
      setCaptchaToken('');
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: Me }>('/auth/verify', { method: 'POST', body: { challengeId, code } });
      setToken(res.accessToken);
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      {CAPTCHA_ON && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setScriptReady(true)} />
      )}
      <div className="auth-card">
        <img src="/logo.svg" alt="Mindspace Artificial Intelligence" />
        {error && <div className="notice error">{error}</div>}
        {step === 'password' ? (
          <form onSubmit={submitPassword}>
            <label>
              Work email
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {CAPTCHA_ON && <div ref={widgetRef} style={{ marginBottom: '1rem', minHeight: 65 }} />}
            <button type="submit" disabled={busy || (CAPTCHA_ON && !captchaToken)} style={{ width: '100%' }}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <p>{message}. Enter it below to finish signing in.</p>
            <label>
              Sign-in code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button type="button" className="secondary" onClick={() => { setStep('password'); setCode(''); setCaptchaToken(''); }}>
                Start again
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
