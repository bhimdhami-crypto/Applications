'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { hoursAndMinutes, MODE_LABEL, timeIn } from '@/components/WorkplaceBits';
import { api, openFile } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { ActivityReport, PresenceStatus, TeamActivity } from '@/lib/types';

const STATUS: Record<PresenceStatus, { label: string; badge: string }> = {
  IN: { label: 'Working now', badge: 'ok' },
  OUT: { label: 'Finished', badge: '' },
  ON_LEAVE: { label: 'On leave', badge: 'warn' },
  NOT_STARTED: { label: 'Not clocked in', badge: '' },
};

/** Who is working today and what they noted: managers for their team, HR and Payroll for a company */
export default function TeamActivityPage() {
  const { t } = usePrefs();
  const { me, can, entityId: chosen } = useSession();
  const companies = me.entities.filter((e) => can('people.read', e.id) || can('payroll.read', e.id));
  const wholeCompany = companies.length > 0;
  // Starts on the company picked in the top bar, when it is one this person can see
  const [entityId, setEntityId] = useState(chosen && companies.some((c) => c.id === chosen) ? chosen : '');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [everyone, setEveryone] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries(extra).filter(([, v]) => v));
    if (entityId) p.set('entityId', entityId);
    return p.toString();
  };
  const team = useLoad(() => api<TeamActivity>(`/activity/team?${params({ date, q: query })}`), [entityId, date, query]);
  const report = useLoad(() => (wholeCompany ? api<ActivityReport>(`/activity/report?${params({ month })}`) : Promise.resolve(null)), [wholeCompany, entityId, month]);
  const data = team.data;

  const csv = () => openFile(`/activity/report?${params({ month, format: 'csv' })}`, `activity-${data?.entity.code ?? ''}-${month}.csv`).catch((e) => setError(e.message));

  const tz = data?.timeZone ?? 'UTC';
  // A whole company is long; HR starts with the people who recorded time, unless searching
  const rows = (data?.rows ?? []).filter((r) => !data?.wholeCompany || everyone || query || r.status !== 'NOT_STARTED');

  return (
    <>
      <PageHead
        title={t('nav.teamActivity')}
        crumbs={<Link href="/activity">{t('nav.myDay')}</Link>}
        sub={`${(data?.wholeCompany ?? wholeCompany) ? 'Who is working today across the company, and what they noted.' : 'Who in your team is working today, and what they noted.'} Times are local to the company${data ? ` (${tz.replace('_', ' ')})` : ''}.`}
      />
      <ErrorAlert error={error || team.error || report.error} />

      <div className="filters">
        {wholeCompany && (
          <label className="field">
            <span>Company</span>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">{data?.wholeCompany ? data.entity.name : 'My company'}</option>
              {companies
                .filter((c) => c.id !== data?.entity.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Day</span>
          <input type="date" value={date || data?.date || ''} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: '1 1 220px' }}>
          <span>Search</span>
          <input placeholder="Name or employee number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {data?.wholeCompany && (
          <label className="check" style={{ marginBottom: '.8rem' }}>
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show people who have not clocked in
          </label>
        )}
      </div>

      {!data ? (
        !team.error && <Loading />
      ) : (
        <>
          <div className="grid stats">
            <div className="card stat">
              <div className="label">People</div>
              <div className="value">{data.summary.people}</div>
            </div>
            <div className="card stat">
              <div className="label">Working now</div>
              <div className="value">{data.summary.in}</div>
            </div>
            <div className="card stat">
              <div className="label">Finished for the day</div>
              <div className="value">{data.summary.out}</div>
            </div>
            <div className="card stat">
              <div className="label">On leave</div>
              <div className="value">{data.summary.onLeave}</div>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Hours</th>
                  <th className="num">Today</th>
                  <th className="num">This week</th>
                  <th>Work notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      <div className="muted small">
                        {r.employeeNumber}
                        {r.jobTitle ? ` · ${r.jobTitle}` : ''}
                        {!r.hasLogin && ' · no portal account'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS[r.status].badge}`}>{STATUS[r.status].label}</span>
                      {r.mode && <div className="muted small">{MODE_LABEL[r.mode]}</div>}
                      {r.flags.map((f) => (
                        <div key={f}>
                          <span className="badge warn">{f}</span>
                        </div>
                      ))}
                    </td>
                    <td>{r.firstIn ? `${timeIn(r.firstIn, tz)} to ${r.lastOut ? timeIn(r.lastOut, tz) : 'now'}` : ''}</td>
                    <td className="num">{r.workedMinutes ? hoursAndMinutes(r.workedMinutes) : ''}</td>
                    <td className="num">{r.weekMinutes ? hoursAndMinutes(r.weekMinutes) : ''}</td>
                    <td className="wrap">
                      {r.logs.map((l) => (
                        <div key={l.id}>
                          <strong>
                            {l.hours}h {l.project}
                          </strong>
                          : {l.description}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Nobody matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.truncated && <p className="muted small">Showing the first 200 people. Search to find someone else.</p>}
        </>
      )}

      {wholeCompany && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <div className="day-head">
            <h2>Monthly report{report.data ? `: ${report.data.entity.name}` : ''}</h2>
            <div className="chat-new">
              <input type="month" aria-label="Month" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} />
              <button type="button" className="btn secondary small" onClick={csv}>
                Download CSV
              </button>
            </div>
          </div>
          {!report.data ? (
            <Loading />
          ) : (
            <>
              <p className="muted small">
                Expected hours this month: {report.data.expectedHours} (working days at {8} hours, a planning figure for the tracker, not a contractual or legal rule).
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="num">Days present</th>
                      <th className="num">Hours worked</th>
                      <th className="num">Hours noted</th>
                      <th className="num">Above expected</th>
                      <th className="num">Forgot to clock out</th>
                      <th className="num">Edited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.rows.slice(0, 100).map((r) => (
                      <tr key={r.employeeNumber}>
                        <td>
                          {r.name} <span className="muted small">{r.employeeNumber}</span>
                        </td>
                        <td className="num">{r.daysPresent}</td>
                        <td className="num">{r.hoursWorked}</td>
                        <td className="num">{r.hoursLogged}</td>
                        <td className="num">{r.overExpected || ''}</td>
                        <td className="num">{r.forgotClockOut || ''}</td>
                        <td className="num">{r.edited || ''}</td>
                      </tr>
                    ))}
                    {report.data.rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">
                          No time recorded this month.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {report.data.rows.length > 100 && <p className="muted small">Showing the first 100 of {report.data.rows.length} people. Download the CSV for everyone.</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
