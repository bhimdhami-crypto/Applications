'use client';

import { COUNTRIES } from '@gpp/shared';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';

const PHASES = [
  ['1', 'Requirements, architecture, data model, security and UI design', 'done'],
  ['2', 'Sign-in, roles, organisation set-up, employee records, company isolation', 'done'],
  ['3', 'Self-service, manager workflows, documents, leave and attendance', 'done'],
  ['4', 'Payroll engine, controls, journals and synthetic payroll history', 'active'],
  ['5', 'Country statutory rules with verification status', 'next'],
  ['6', 'Dashboards, report builder, AI assistant, full translations', 'next'],
  ['7', 'Android and iOS apps with push notifications', 'next'],
  ['8', 'Oracle and SAP integration adapters', 'next'],
  ['9', 'Performance, security, accessibility and recovery testing', 'next'],
  ['10', 'Pilot, parallel payroll and go-live', 'next'],
] as const;

export default function Home() {
  const { me, entityId, can } = useSession();
  const { t } = usePrefs();
  const entities = entityId ? me.entities.filter((e) => e.id === entityId) : me.entities;
  const countries = [...new Set(entities.map((e) => e.countryCode))];
  const modulesOn = entities.reduce((n, e) => n + e.features.filter((f) => f.enabled).length, 0) + entities.length; // people is always on

  return (
    <>
      <PageHead title={t('home.welcome', { name: me.user.displayName.split(' ')[0] })} sub={me.group.name} />

      <div className="grid stats">
        <div className="card stat">
          <div className="value">{countries.length}</div>
          <div className="label">{t('home.countries')}</div>
        </div>
        <div className="card stat">
          <div className="value">{entities.length}</div>
          <div className="label">{t('home.companies')}</div>
        </div>
        <div className="card stat">
          <div className="value">{me.roles.length}</div>
          <div className="label">{t('home.roles')}</div>
        </div>
        <div className="card stat">
          <div className="value">{modulesOn}</div>
          <div className="label">{t('home.modules')}</div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: '1rem' }}>
        <section className="card" dir="auto">
          <h2>Your access</h2>
          <p className="muted">What you can see and do is limited to these roles and their scope.</p>
          <ul>
            {me.roles.map((r) => (
              <li key={r.id}>
                <strong>{r.label}</strong> · {r.scopeLabel}
              </li>
            ))}
          </ul>
          <h3 style={{ marginTop: '1rem' }}>Your companies</h3>
          <div className="chips">
            {entities.map((e) =>
              can('org.read', e.id) ? (
                <Link key={e.id} className="badge" href={`/organisation/${e.id}`}>
                  {COUNTRIES.find((c) => c.code === e.countryCode)?.name ?? e.countryCode} · {e.code}
                </Link>
              ) : (
                <span key={e.id} className="badge">
                  {e.countryCode} · {e.code}
                </span>
              ),
            )}
          </div>
        </section>

        <section className="card" dir="auto">
          <h2>Build progress</h2>
          <p className="muted">The platform is delivered in ten phases. Each ends with working code and passing tests.</p>
          <table>
            <tbody>
              {PHASES.map(([n, label, state]) => (
                <tr key={n}>
                  <td style={{ width: '2.5rem' }}>
                    <span className={`badge ${state === 'done' ? 'ok' : state === 'active' ? 'accent' : ''}`}>{n}</span>
                  </td>
                  <td>{label}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {state === 'done' ? 'Done' : state === 'active' ? 'In progress' : 'Planned'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
