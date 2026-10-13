'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, Company, COUNTRY_NAME, Holiday, LeaveStatus, LeaveType, LeaveTypeInfo } from '@/lib/api';
import { useSession } from '@/lib/session';

interface CalendarData {
  month: string;
  countryCode: string;
  days: string[];
  holidays: Holiday[];
  entries: Array<{ id: string; employeeId: string; name: string; startDate: string; endDate: string; days: number; type: LeaveType | null; status: LeaveStatus }>;
}

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const shift = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

export default function LeaveCalendarPage() {
  const { can } = useSession();
  const seesCompanies = can('HR', 'PAYROLL');
  const [month, setMonth] = useState(currentMonth);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<CalendarData | null>(null);
  const [types, setTypes] = useState<LeaveTypeInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<LeaveTypeInfo[]>('/leave/types').then(setTypes).catch(() => setTypes([]));
    if (seesCompanies) api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.countryCode !== 'US'))).catch(() => setCompanies([]));
  }, [seesCompanies]);

  useEffect(() => {
    setError('');
    const q = new URLSearchParams({ month, ...(companyId ? { companyId } : {}) });
    api<CalendarData>(`/leave/calendar?${q}`).then(setData).catch((e) => setError(e.message));
  }, [month, companyId]);

  const people = useMemo(() => {
    const byPerson = new Map<string, { name: string; entries: CalendarData['entries'] }>();
    for (const e of data?.entries ?? []) {
      const p = byPerson.get(e.employeeId) ?? { name: e.name, entries: [] };
      p.entries.push(e);
      byPerson.set(e.employeeId, p);
    }
    return [...byPerson.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [data]);

  const weekend = data?.countryCode === 'EG' ? [5, 6] : [6, 0];
  const holidayOn = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]));
  const label = (t: LeaveType | null) => (t ? types.find((x) => x.type === t)?.label ?? t : 'Away');

  return (
    <>
      <h1>Leave calendar</h1>
      <div className="toolbar">
        <button className="secondary" onClick={() => setMonth(shift(month, -1))}>Previous</button>
        <strong style={{ alignSelf: 'center', minWidth: '9rem', textAlign: 'center' }}>{monthName(month)}</strong>
        <button className="secondary" onClick={() => setMonth(shift(month, 1))}>Next</button>
        {seesCompanies && (
          <label style={{ marginBottom: 0 }}>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">My company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <Link href="/leave/holidays" style={{ alignSelf: 'center' }}>Public holidays</Link>
      </div>
      {error && <div className="notice error">{error}</div>}

      {data && (
        <div className="card table-wrap">
          <table className="leave-cal">
            <thead>
              <tr>
                <th className="who">{people.length} {people.length === 1 ? 'person' : 'people'} away</th>
                {data.days.map((d) => (
                  <th key={d} className={weekend.includes(dow(d)) || holidayOn.has(d) ? 'off' : ''} title={holidayOn.get(d)}>
                    <div>{'SMTWTFS'[dow(d)]}</div>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map(([id, p]) => (
                <tr key={id}>
                  <td className="who">{p.name}</td>
                  {data.days.map((d) => {
                    const e = p.entries.find((x) => x.startDate <= d && x.endDate >= d);
                    const off = weekend.includes(dow(d)) || holidayOn.has(d);
                    return (
                      <td
                        key={d}
                        className={[off ? 'off' : '', e && !off ? `lt lt-${e.type ?? 'AWAY'}` : '', e && e.status !== 'APPROVED' ? 'pending' : ''].join(' ')}
                        title={e ? `${p.name}: ${label(e.type)}${e.status !== 'APPROVED' ? ' (waiting for approval)' : ''}` : holidayOn.get(d)}
                      />
                    );
                  })}
                </tr>
              ))}
              {people.length === 0 && (
                <tr><td className="muted" colSpan={data.days.length + 1}>Nobody is on leave in {monthName(month)}.</td></tr>
              )}
            </tbody>
          </table>
          <div className="legend">
            {types.filter((t) => people.some(([, p]) => p.entries.some((e) => e.type === t.type))).map((t) => (
              <span key={t.type}><i className={`lt lt-${t.type}`} /> {t.label}</span>
            ))}
            {people.some(([, p]) => p.entries.some((e) => e.type === null)) && <span><i className="lt lt-AWAY" /> Away</span>}
            <span><i className="lt lt-ANNUAL pending" /> Waiting for approval</span>
            <span><i className="off" /> Weekend or public holiday</span>
          </div>
          {data.holidays.length > 0 && (
            <p className="muted small">
              Public holidays in {COUNTRY_NAME[data.countryCode] ?? data.countryCode}: {data.holidays.map((h) => `${Number(h.date.slice(8))} ${h.name}`).join(', ')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
