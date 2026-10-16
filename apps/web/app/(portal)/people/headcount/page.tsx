'use client';

import { COUNTRIES } from '@gpp/shared';
import { ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Headcount } from '@/lib/types';

/** Active headcount by country, company and department, from the live records */
export default function HeadcountPage() {
  const { t, lang } = usePrefs();
  const { entityId } = useSession();
  const h = useLoad(() => api<Headcount>(`/employees/headcount${entityId ? `?entityId=${entityId}` : ''}`), [entityId]);
  const n = (v: number) => v.toLocaleString(lang);

  return (
    <>
      <PageHead title={t('nav.headcount')} sub={h.data ? `Active employees on ${fmtDate(h.data.asOf, lang)}, counted from the employee records in your scope.` : undefined} />
      <ErrorAlert error={h.error} />
      {!h.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid stats">
            <div className="card stat">
              <div className="label">Active employees</div>
              <div className="value">{n(h.data.total)}</div>
            </div>
            <div className="card stat">
              <div className="label">Countries</div>
              <div className="value">{h.data.countries.length}</div>
            </div>
            <div className="card stat">
              <div className="label">Companies</div>
              <div className="value">{h.data.companies.length}</div>
            </div>
            <div className="card stat">
              <div className="label">Leavers on record</div>
              <div className="value">{n(h.data.countries.reduce((s, c) => s + c.left, 0))}</div>
            </div>
          </div>
          <section className="card">
            <h2>By country</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Country</th>
                    <th style={{ textAlign: 'end' }}>Active</th>
                    <th style={{ textAlign: 'end' }}>Left</th>
                  </tr>
                </thead>
                <tbody>
                  {h.data.countries.map((c) => (
                    <tr key={c.countryCode}>
                      <td>{COUNTRIES.find((x) => x.code === c.countryCode)?.name ?? c.countryCode}</td>
                      <td style={{ textAlign: 'end' }}>{n(c.active)}</td>
                      <td style={{ textAlign: 'end' }} className="muted">
                        {n(c.left)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>By company and department</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th style={{ textAlign: 'end' }}>Active</th>
                    <th>Departments</th>
                  </tr>
                </thead>
                <tbody>
                  {h.data.companies.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.code}</strong> {c.name}
                      </td>
                      <td style={{ textAlign: 'end' }}>{n(c.active)}</td>
                      <td className="muted">{c.departments.map((d) => `${d.name} ${n(d.active)}`).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
