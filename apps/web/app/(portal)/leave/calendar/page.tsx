'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { leaveLabel } from '@/components/LeaveBits';
import { ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { LeaveStatus, LeaveType } from '@/lib/types';

interface CalendarData {
  month: string;
  scope: 'company' | 'team' | 'colleagues';
  entity: { id: string; code: string; name: string; countryCode: string; weekendDays: number[] };
  days: string[];
  holidays: Array<{ date: string; name: string }>;
  entries: Array<{ id: string; employmentId: string; name: string; startDate: string; endDate: string; days: number; type: LeaveType | null; status: LeaveStatus }>;
}

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const shift = (month: string, by: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const SCOPE = { company: 'Everyone in the company', team: 'You and everyone below you', colleagues: 'You, your manager and your teammates. Teammates show as away, without the reason.' };

/** Who is away in a month: HR sees a company, managers their team, everyone else their colleagues */
export default function LeaveCalendar() {
  const { t, lang } = usePrefs();
  const { me, can, entityId } = useSession();
  const companies = me.entities.filter((e) => can('people.read', e.id));
  const [month, setMonth] = useState(currentMonth);
  const [pick, setPick] = useState<string>(entityId && companies.some((c) => c.id === entityId) ? entityId : '');
  const cal = useLoad(() => api<CalendarData>(`/leave/calendar?month=${month}${pick ? `&entityId=${pick}` : ''}`), [month, pick]);
  const data = cal.data;

  const people = useMemo(() => {
    const byPerson = new Map<string, { name: string; entries: CalendarData['entries'] }>();
    for (const e of data?.entries ?? []) {
      const p = byPerson.get(e.employmentId) ?? { name: e.name, entries: [] };
      p.entries.push(e);
      byPerson.set(e.employmentId, p);
    }
    return [...byPerson.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [data]);

  const weekend = data?.entity.weekendDays ?? [6, 0];
  const holidayOn = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]));
  const label = (x: LeaveType | null) => (x ? leaveLabel(x) : 'Away');
  const monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const dayLetter = (d: string) => new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const used = new Set((data?.entries ?? []).map((e) => e.type ?? 'AWAY'));

  return (
    <>
      <PageHead
        title={t('nav.leaveCalendar')}
        sub={data ? `${data.entity.name}. ${SCOPE[data.scope]}` : undefined}
        actions={
          <>
            <button className="btn secondary" onClick={() => setMonth(shift(month, -1))}>
              {t('common.previous')}
            </button>
            <strong style={{ alignSelf: 'center', minWidth: '9rem', textAlign: 'center' }}>{monthName}</strong>
            <button className="btn secondary" onClick={() => setMonth(shift(month, 1))}>
              {t('common.next')}
            </button>
            {companies.length > 0 && (
              <select aria-label="Company" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 260 }}>
                <option value="">My company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />
      <ErrorAlert error={cal.error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="leave-cal">
              <thead>
                <tr>
                  <th className="who">
                    {people.length} {people.length === 1 ? 'person' : 'people'} away
                  </th>
                  {data.days.map((d) => (
                    <th key={d} className={weekend.includes(dow(d)) || holidayOn.has(d) ? 'off' : ''} title={holidayOn.get(d)}>
                      <div>{dayLetter(d)}</div>
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
                  <tr>
                    <td className="muted" colSpan={data.days.length + 1} style={{ textAlign: 'start', padding: '.75rem' }}>
                      Nobody is on leave in {monthName}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="legend">
            {[...used].map((k) => (
              <span key={k}>
                <i className={`lt lt-${k}`} /> {k === 'AWAY' ? 'Away' : leaveLabel(k as LeaveType)}
              </span>
            ))}
            <span>
              <i className="lt lt-ANNUAL pending" /> Waiting for approval
            </span>
            <span>
              <i className="off" /> Weekend or public holiday
            </span>
          </div>
          <p className="muted" style={{ fontSize: '.85rem' }}>
            {data.holidays.length > 0 ? (
              <>Public holidays: {data.holidays.map((h) => `${Number(h.date.slice(8))} ${h.name}`).join(', ')}. </>
            ) : (
              <>No public holidays entered for this month. </>
            )}
            <Link href="/leave/holidays">See the holiday calendar</Link>
          </p>
        </div>
      )}
    </>
  );
}
