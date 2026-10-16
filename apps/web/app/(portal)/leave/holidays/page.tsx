'use client';

import { COUNTRIES } from '@gpp/shared';
import { FormEvent, useState } from 'react';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Holiday } from '@/lib/types';

const thisYear = new Date().getFullYear();

/** Public holidays per country. Drafts come from the first build's generator; HR checks and maintains them. */
export default function Holidays() {
  const { t, lang } = usePrefs();
  const { me, can, entityId } = useSession();
  const countries = [...new Set(me.entities.map((e) => e.countryCode))].sort();
  const start = me.entities.find((e) => e.id === entityId)?.countryCode ?? countries[0] ?? 'KE';
  const [country, setCountry] = useState(start);
  const [year, setYear] = useState(thisYear);
  const list = useLoad(() => api<{ drafted: boolean; holidays: Holiday[] }>(`/leave/holidays?countryCode=${country}&year=${year}`), [country, year]);
  const editor = me.entities.some((e) => e.countryCode === country && can('people.manage', e.id));
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const name = COUNTRIES.find((c) => c.code === country)?.name ?? country;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/leave/holidays', { method: 'POST', body: { countryCode: country, ...form } });
      setForm({ date: '', name: '' });
    });
  };

  const drafts = list.data?.holidays.filter((h) => h.source === 'DRAFT').length ?? 0;

  return (
    <>
      <PageHead
        title={t('nav.holidays')}
        sub="Leave skips these days, so they change how many days a request uses."
        actions={
          <>
            <select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {COUNTRIES.find((x) => x.code === c)?.name ?? c}
                </option>
              ))}
            </select>
            <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </>
        }
      />
      {list.data && !list.data.drafted && (
        <div className="alert info" role="note">
          The portal does not draft holidays for {name}. HR enters them from the official gazette.
        </div>
      )}
      {drafts > 0 && (
        <div className="alert info" role="note">
          {drafts} of these days are drafts worked out by the portal. Islamic holidays are estimates. HR should check each one against the official gazette and confirm it.
        </div>
      )}
      <ErrorAlert error={error || list.error} />
      {editor && (
        <form className="card row" onSubmit={add}>
          <label className="field">
            <span>Date</span>
            <input type="date" required min={`${year}-01-01`} max={`${year}-12-31`} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="field">
            <span>Name</span>
            <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <button className="btn" type="submit" style={{ marginBottom: '.8rem' }}>
            Add holiday
          </button>
        </form>
      )}
      {!list.data ? (
        <Loading />
      ) : list.data.holidays.length === 0 ? (
        <Empty>
          No public holidays entered for {name} in {year}.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday</th>
                <th>Source</th>
                {editor && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.holidays.map((h) => (
                <tr key={h.id}>
                  <td>{new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${h.date}T00:00:00Z`))} {fmtDate(h.date, lang)}</td>
                  <td>{h.name}</td>
                  <td>{h.source === 'DRAFT' ? <span className="badge warn">Draft, not checked</span> : <span className="badge ok">Confirmed by HR</span>}</td>
                  {editor && (
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: '.4rem' }}>
                        {h.source === 'DRAFT' && (
                          <button className="btn secondary small" onClick={() => run(() => api(`/leave/holidays/${h.id}/confirm`, { method: 'POST' }))}>
                            Confirm
                          </button>
                        )}
                        <button
                          className="btn danger small"
                          onClick={() => window.confirm(`Remove ${h.name}?`) && run(() => api(`/leave/holidays/${h.id}`, { method: 'DELETE' }))}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
