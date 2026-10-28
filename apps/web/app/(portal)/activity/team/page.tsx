'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActivityReport, api, Company, downloadFile, hoursAndMinutes, MODE_LABEL, TeamActivity, timeIn } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';

const STATUS = { IN: 'Working now', OUT: 'Finished', ON_LEAVE: 'On leave', NOT_STARTED: 'Not clocked in' } as const;
const STATUS_BADGE = { IN: 'APPROVED', OUT: 'FINALIZED', ON_LEAVE: 'PENDING', NOT_STARTED: 'CANCELLED' } as const;

export default function TeamActivityPage() {
  const { can } = useSession();
  const wholeCompany = can('HR', 'PAYROLL');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TeamActivity | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (wholeCompany) api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.countryCode !== 'US'))).catch(() => setCompanies([]));
  }, [wholeCompany]);

  const query = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries(extra).filter(([, v]) => v));
    if (companyId) p.set('companyId', companyId);
    return p.toString();
  }, [companyId]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<TeamActivity>(`/activity/team?${query({ date, q: search })}`)
        .then((d) => { setData(d); setError(''); if (!date) setDate(d.date); })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [query, date, search]);

  useEffect(() => {
    if (!wholeCompany) return;
    api<ActivityReport>(`/activity/report?${query({ month })}`).then(setReport).catch((e) => setError(e.message));
  }, [wholeCompany, query, month]);

  async function csv() {
    try {
      await downloadFile(`/activity/report?${query({ month, format: 'csv' })}`, `activity-${month}.csv`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tz = data?.timeZone ?? 'UTC';
  // A whole company is long; HR starts with the people who recorded time, unless searching
  const rows = (data?.rows ?? []).filter((r) => !wholeCompany || everyone || search.trim() || r.status !== 'NOT_STARTED');
  return (
    <>
      <PageHeader title="Team activity" sub={<> {wholeCompany ? 'Who is working today across the company, and what they noted.' : 'Who in your team is working today, and what they noted.'} Times are local to the company. </>} />
      {error && <div className="notice error">{error}</div>}

      <div className="toolbar">
        {wholeCompany && (
          <label>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">My company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label>
          Day
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {wholeCompany && (
          <label className="inline-check">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show people who have not clocked in
          </label>
        )}
        <label style={{ flex: 1 }}>
          Search
          <input placeholder="Name or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {data && (
        <>
          <div className="grid">
            <div className="card stat"><div className="label">People</div><div className="value">{data.summary.people}</div></div>
            <div className="card stat"><div className="label">Working now</div><div className="value">{data.summary.in}</div></div>
            <div className="card stat"><div className="label">Finished for the day</div><div className="value">{data.summary.out}</div></div>
            <div className="card stat"><div className="label">On leave</div><div className="value">{data.summary.onLeave}</div></div>
          </div>
          <div className="card table-wrap">
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
                      <div className="muted small">{r.employeeNo} · {r.jobTitle}{!r.hasLogin && ' · no portal login'}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS[r.status]}</span>
                      {r.mode && <div className="muted small">{MODE_LABEL[r.mode]}</div>}
                      {r.flags.map((f) => <div key={f} className="badge warn">{f}</div>)}
                    </td>
                    <td>{r.firstIn ? `${timeIn(r.firstIn, tz)} to ${r.lastOut ? timeIn(r.lastOut, tz) : 'now'}` : ''}</td>
                    <td className="num">{r.workedMinutes ? hoursAndMinutes(r.workedMinutes) : ''}</td>
                    <td className="num">{r.weekMinutes ? hoursAndMinutes(r.weekMinutes) : ''}</td>
                    <td className="wrap">
                      {r.logs.map((l) => <div key={l.id}><strong>{l.hours}h {l.project}</strong>: {l.description}</div>)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="empty">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
          {data.truncated && (everyone || !wholeCompany) && <p className="muted small">Showing the first 200 people. Search to find someone else.</p>}
        </>
      )}

      {wholeCompany && (
        <>
          <div className="section-head">
            <h2>Monthly report</h2>
            <div className="actions">
              <input type="month" style={{ width: 'auto', margin: 0 }} value={month} onChange={(e) => setMonth(e.target.value)} />
              <button type="button" className="secondary" onClick={csv}>Download CSV</button>
            </div>
          </div>
          {report && (
            <div className="card table-wrap">
              <p className="muted">Expected hours this month: {report.expectedHours}</p>
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
                  {report.rows.map((r) => (
                    <tr key={r.employeeNo}>
                      <td>{r.name} <span className="muted small">{r.employeeNo}</span></td>
                      <td className="num">{r.daysPresent}</td>
                      <td className="num">{r.hoursWorked}</td>
                      <td className="num">{r.hoursLogged}</td>
                      <td className="num">{r.overExpected || ''}</td>
                      <td className="num">{r.forgotClockOut || ''}</td>
                      <td className="num">{r.edited || ''}</td>
                    </tr>
                  ))}
                  {report.rows.length === 0 && <tr><td colSpan={7} className="empty">No time recorded this month.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
