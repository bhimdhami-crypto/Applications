'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { AppFooter } from '@/components/AppFooter';
import { api, Me, setToken } from '@/lib/api';

const ENTITIES = [
  ['KE', 'KES'], ['UG', 'UGX'], ['TZ', 'TZS'], ['ZA', 'ZAR'],
  ['EG', 'EGP'], ['NG', 'NGN'], ['MX', 'MXN'], ['NZ', 'NZD'],
];

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA';
const CAPTCHA_ON = SITE_KEY !== 'disabled';

interface DemoAccount {
  email: string;
  name: string;
  role: string;
  password: string;
}

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
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  // In demo mode the API lists the test accounts so visitors can sign in
  useEffect(() => {
    api<{ demo: boolean; accounts?: DemoAccount[] }>('/auth/demo')
      .then((res) => setDemoAccounts(res.accounts ?? []))
      .catch(() => undefined);
  }, []);

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
      const res = await api<{ challengeId: string; message: string; demoCode?: string }>('/auth/login', {
        method: 'POST',
        body: { email, password, captchaToken: captchaToken || undefined },
      });
      widgetId.current = null;
      if (res.demoCode) {
        // Demo mode: the API hands back the code, so finish signing in straight away
        setCode(res.demoCode);
        await finishSignIn(res.challengeId, res.demoCode);
        return;
      }
      setChallengeId(res.challengeId);
      setMessage(res.message);
      setStep('code');
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
      await finishSignIn(challengeId, code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finishSignIn(id: string, otp: string) {
    const res = await api<{ accessToken: string; user: Me }>('/auth/verify', { method: 'POST', body: { challengeId: id, code: otp } });
    setToken(res.accessToken);
    router.replace('/dashboard');
  }

  return (
    <div className="auth">
      {CAPTCHA_ON && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setScriptReady(true)} />
      )}
      <section className="auth-brand" aria-hidden="true">
        <div className="auth-logo">
          <span className="tile"><img src="/logo-mark.svg" alt="" /></span>
          <div>
            <strong>mindspace</strong>
            <span>HR and payroll</span>
          </div>
        </div>
        <div className="auth-pitch">
          <h1>People, pay and policy for every Mindspace company.</h1>
          <p>Employee records, leave, month-end payroll, loans and benefits for eight subsidiaries, each on its own country rules and currency.</p>
          <div className="entity-grid">
            {ENTITIES.map(([cc, cur]) => (
              <div className="entity-chip" key={cc}>
                <b>{cc}</b>
                <span>{cur}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="auth-foot">For authorised Mindspace staff only. Sign-ins and changes are logged (POL-09).</div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-steps" aria-hidden="true">
            <i className="on" />
            <i className={step === 'code' ? 'on' : ''} />
          </div>
          {step === 'password' ? (
            <>
              <h2>Sign in</h2>
              <p className="lede">Use your work email and password.</p>
            </>
          ) : (
            <>
              <h2>Check your email</h2>
              <p className="lede">{message}. Enter it below to finish signing in.</p>
            </>
          )}
          {error && <div className="notice error">{error}</div>}
          {step === 'password' ? (
            <form onSubmit={submitPassword}>
              <label>
                Work email
                <input type="email" autoComplete="username" required autoFocus placeholder="name@mindspace-ai.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Password
                <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {CAPTCHA_ON && <div ref={widgetRef} style={{ marginBottom: '1rem', minHeight: 65 }} />}
              <button type="submit" disabled={busy || (CAPTCHA_ON && !captchaToken)} style={{ width: '100%', minHeight: 42 }}>
                {busy ? 'Checking…' : demoAccounts.length ? 'Sign in' : 'Continue'}
              </button>
              <p className="auth-agree">
                By signing in you agree to the <Link href="/legal#terms">Terms of use</Link> and acknowledge the{' '}
                <Link href="/legal#disclaimer">Disclaimer</Link> and <Link href="/legal#privacy">Privacy notice</Link>.
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode}>
              <label>
                Sign-in code
                <input
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  placeholder="······"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button type="submit" disabled={busy || code.length !== 6} style={{ width: '100%', minHeight: 42 }}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button type="button" className="ghost" style={{ width: '100%', marginTop: '0.5rem' }} onClick={() => { setStep('password'); setCode(''); setCaptchaToken(''); setError(''); }}>
                Use a different account
              </button>
            </form>
          )}
          {step === 'password' && demoAccounts.length > 0 && (
            <div className="notice info" style={{ marginTop: '1.25rem', display: 'block' }}>
              <strong>Demo accounts</strong>
              <p style={{ margin: '0.25rem 0 0.6rem', fontSize: '0.8rem' }}>
                All data is fictional. Pick an account to fill in the form; the sign-in code is entered for you.
              </p>
              <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                <tbody>
                  {demoAccounts.map((a) => (
                    <tr key={a.email} style={{ borderTop: '1px solid color-mix(in srgb, currentColor 15%, transparent)' }}>
                      <td style={{ padding: '0.35rem 0.25rem 0.35rem 0' }}>
                        <b>{a.role}</b> · {a.name}
                        <br />
                        <code>{a.email}</code>
                        <br />
                        <code>{a.password}</code>
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.35rem 0' }}>
                        <button type="button" className="ghost" style={{ minHeight: 30 }} onClick={() => { setEmail(a.email); setPassword(a.password); setError(''); }}>
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="auth-secure">
            <ShieldCheck size={16} />
            <span>
              {demoAccounts.length
                ? 'Demo site: the 6-digit sign-in code is filled in for you instead of being emailed. Your session ends when you close this tab.'
                : 'Two-step sign-in: a 6-digit code is emailed to you each time. It expires after 5 minutes. Your session ends when you close this tab.'}
            </span>
          </div>
        </div>
        <AppFooter compact />
      </section>
    </div>
  );
}
