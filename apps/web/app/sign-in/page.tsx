'use client';

import { BRAND } from '@gpp/shared';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { AccentSelect, LanguageSelect, ThemeSelect } from '@/components/Prefs';
import { ErrorAlert } from '@/components/ui';
import { login, verify } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';

const DEMO_ACCOUNTS = [
  ['admin@mindspace.test', 'Group administrator'],
  ['hr.global@mindspace.test', 'Global HR administrator'],
  ['hr.kenya@mindspace.test', 'HR administrator, Kenya'],
  ['hr.france@mindspace.test', 'HR officer, France'],
  ['hr.india@mindspace.test', 'HR officer, one Indian company'],
  ['payroll.kenya@mindspace.test', 'Payroll operator, Kenya'],
  ['approver.kenya@mindspace.test', 'Payroll approver, Kenya'],
  ['finance@mindspace.test', 'Group finance'],
  ['auditor@mindspace.test', 'Auditor'],
  ['ceo@mindspace.test', 'Executive'],
];

export default function SignIn() {
  const router = useRouter();
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<{ challengeId: string; sentTo: string; demoCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showDemo = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== 'false';

  async function step1(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChallenge(await login(email, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function step2(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verify(challenge!.challengeId, code.trim());
      router.replace('/home');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand" style={{ padding: 0 }}>
          <img src="/logo.svg" alt="" width={44} height={44} />
          <div>
            <strong>{BRAND.shortName}</strong>
            <span>{BRAND.productName}</span>
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>
            One platform for <span className="accent">people and payroll</span> in every country you operate.
          </h1>
          <ul>
            <li>15 countries, 18 companies, 14 currencies</li>
            <li>Strict company and country data boundaries</li>
            <li>Maker-checker payroll with full audit trail</li>
          </ul>
        </div>
        <div dir="ltr" lang="en" style={{ fontSize: '.8rem', opacity: 0.8, position: 'relative', zIndex: 1 }}>
          {BRAND.developerCredit}
          <br />
          {BRAND.copyright()}
        </div>
      </section>

      <section className="auth-form">
        <div style={{ width: 'min(420px, 100%)' }}>
          <div className="auth-tools">
            <LanguageSelect />
            <ThemeSelect />
            <AccentSelect />
          </div>
          <div className="card">
            {!challenge ? (
              <form onSubmit={step1}>
                <h2>{t('signin.title')}</h2>
                <ErrorAlert error={error} />
                <label className="field">
                  <span>{t('signin.email')}</span>
                  <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="field">
                  <span>{t('signin.password')}</span>
                  <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
                <button className="btn" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                  {t('signin.continue')}
                </button>
              </form>
            ) : (
              <form onSubmit={step2}>
                <h2>{t('signin.codeTitle')}</h2>
                <p className="muted">{t('signin.codeHelp', { email: challenge.sentTo })}</p>
                {challenge.demoCode && (
                  <div className="alert info">
                    Demo mode: your code is <strong className="mono">{challenge.demoCode}</strong>
                  </div>
                )}
                <ErrorAlert error={error} />
                <label className="field">
                  <span>{t('signin.code')}</span>
                  <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
                </label>
                <button className="btn" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                  {t('signin.verify')}
                </button>
                <p style={{ marginTop: '.8rem' }}>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => {
                      setChallenge(null);
                      setCode('');
                      setError(null);
                    }}
                  >
                    {t('signin.back')}
                  </button>
                </p>
              </form>
            )}
          </div>
          {showDemo && !challenge && (
            <details className="panel" style={{ marginTop: '1rem' }}>
              <summary>Demo accounts</summary>
              <div>
                <p className="muted">
                  Password for all: <span className="mono">Demo#Mindspace2026</span>. Sign-in codes go to the test inbox at <span className="mono">localhost:8025</span> unless demo codes are on.
                </p>
                <table>
                  <tbody>
                    {DEMO_ACCOUNTS.map(([e, r]) => (
                      <tr key={e}>
                        <td>
                          <button type="button" className="btn secondary small" onClick={() => setEmail(e)}>
                            Use
                          </button>
                        </td>
                        <td className="mono">{e}</td>
                        <td className="muted">{r}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
