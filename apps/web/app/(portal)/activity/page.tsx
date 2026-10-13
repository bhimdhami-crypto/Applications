'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ActivityWeek, api, hoursAndMinutes, MODE_LABEL, timeIn, WorkLog, WorkMode, WorkSession, zonedIso } from '@/lib/api';
import { useSession } from '@/lib/session';

const MODES = Object.keys(MODE_LABEL) as WorkMode[];
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type LogForm = { id?: string; date: string; hours: string; project: string; description: string };
type SessionForm = { id: string; date: string; clockIn: string; clockOut: string; reason: string };

export default function MyDayPage() {
  const { me, can } = useSession();
  const [week, setWeek] = useState<string | undefined>();
  const [data, setData] = useState<ActivityWeek | null>(null);
  const [mode, setMode] = useState<WorkMode>('OFFICE');
  const [logForm, setLogForm] = useState<LogForm | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(() => {
    api<ActivityWeek>(`/activity/me${week ? `?week=${week}` : ''}`).then(setData).catch((e) => setError(e.message));
  }, [week]);
  useEffect(load, [load]);
  // Keeps the running timer fresh while clocked in
  useEffect(() => {
    if (!data?.open) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [data?.open]);

  if (!me.employee) return <><h1>My day</h1><div className="notice">Only employees record their working time.</div></>;
  if (!data) return <><h1>My day</h1>{error ? <div className="notice error">{error}</div> : <p className="muted">Loading…</p>}</>;

  const tz = data.timeZone;
  const editable = (date: string) => date >= data.editableFrom && date <= data.today;
  const runningMinutes = data.open ? Math.max(0, Math.round((Date.now() - Date.parse(data.open.clockIn)) / 60_000)) : 0;
  const isThisWeek = data.today >= data.week.start && data.today <= data.week.end;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      load();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const clockIn = () => run(() => api('/activity/clock-in', { method: 'POST', body: { mode } }));
  const clockOut = () => run(() => api('/activity/clock-out', { method: 'POST' }));

  async function saveLog(e: FormEvent) {
    e.preventDefault();
    if (!logForm) return;
    const body = { date: logForm.date, hours: Number(logForm.hours), project: logForm.project, description: logForm.description };
    const ok = await run(() => (logForm.id ? api(`/activity/logs/${logForm.id}`, { method: 'PATCH', body }) : api('/activity/logs', { method: 'POST', body })));
    if (ok) setLogForm(null);
  }

  async function removeLog(l: WorkLog) {
    if (!window.confirm(`Delete “${l.project}” (${l.hours}h)?`)) return;
    await run(() => api(`/activity/logs/${l.id}`, { method: 'DELETE' }));
  }

  async function saveSession(e: FormEvent) {
    e.preventDefault();
    if (!sessionForm) return;
    const { id, date, clockIn: from, clockOut: to, reason } = sessionForm;
    // A clock-out earlier than the clock-in means the shift ran past midnight
    const outDate = to <= from ? shift(date, 1) : date;
    const body = { clockIn: zonedIso(date, from, tz), clockOut: zonedIso(outDate, to, tz), reason };
    const ok = await run(() => api(`/activity/sessions/${id}`, { method: 'PATCH', body }));
    if (ok) setSessionForm(null);
  }

  const editSession = (s: WorkSession) =>
    setSessionForm({ id: s.id, date: s.date, clockIn: timeIn(s.clockIn, tz), clockOut: s.clockOut ? timeIn(s.clockOut, tz) : '', reason: '' });

  return (
    <>
      <h1>My day</h1>
      <p className="muted">
        Clock in when you start work and out when you finish, and note what you worked on.{' '}
        {can('MANAGER', 'HR', 'PAYROLL') && <Link href="/activity/team">See team activity</Link>}
      </p>
      {error && <div className="notice error">{error}</div>}

      <div className="grid">
        <div className="card stat">
          <div className="label">{data.open ? 'You are clocked in' : 'You are clocked out'}</div>
          {data.open ? (
            <>
              <div className="value">{hoursAndMinutes(runningMinutes)}</div>
              <div className="muted">Since {timeIn(data.open.clockIn, tz)} · {MODE_LABEL[data.open.mode]}</div>
              <button type="button" disabled={busy} onClick={clockOut}>Clock out</button>
            </>
          ) : (
            <>
              <label>
                Where are you working today?
                <select value={mode} onChange={(e) => setMode(e.target.value as WorkMode)}>
                  {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={clockIn}>Clock in</button>
            </>
          )}
        </div>
        <div className="card stat">
          <div className="label">This week</div>
          <div className="value">{hoursAndMinutes(data.totals.workedMinutes)}</div>
          <div className="muted">of {data.totals.expectedHours} hours expected · {data.totals.loggedHours} hours noted</div>
        </div>
      </div>

      <details className="card">
        <summary>What the portal records, and what it does not (POL-21)</summary>
        <p>We record the times you clock in and out, whether you worked in the office, remotely or on site, and the work notes you add. Your manager sees this for their direct reports; HR and Payroll see it for the company.</p>
        <p>We do not record your location, screen, keystrokes, websites or apps. Forgotten clock-outs are closed after {16} hours at a normal day’s length and shown to your manager. You can correct your own times and notes for the last 7 days; changes are marked as edited.</p>
      </details>

      <div className="toolbar">
        <button type="button" className="secondary" onClick={() => setWeek(shift(data.week.start, -7))}>Previous week</button>
        <strong style={{ alignSelf: 'center' }}>{dayName(data.week.start)} to {dayName(data.week.end)}</strong>
        <button type="button" className="secondary" disabled={isThisWeek} onClick={() => setWeek(shift(data.week.start, 7))}>Next week</button>
        {!isThisWeek && <button type="button" className="link" onClick={() => setWeek(undefined)}>Back to this week</button>}
      </div>

      {data.days.map((d) => {
        const quiet = !d.sessions.length && !d.logs.length;
        if (quiet && !d.working && d.date !== data.today) return null;
        return (
          <div key={d.date} className={`card day${d.date === data.today ? ' today' : ''}`}>
            <div className="day-head">
              <h3>{dayName(d.date)}{d.date === data.today && ' (today)'}</h3>
              <span className="muted">
                {d.holiday ? `Public holiday: ${d.holiday}` : d.onLeave ? 'On leave' : !d.working ? 'Not a working day' : ''}
                {d.workedMinutes > 0 && ` ${hoursAndMinutes(d.workedMinutes)} worked`}
                {d.loggedHours > 0 && ` · ${d.loggedHours}h noted`}
              </span>
            </div>
            {d.sessions.length > 0 && (
              <ul className="plain">
                {d.sessions.map((s) => (
                  <li key={s.id}>
                    {timeIn(s.clockIn, tz)} to {s.clockOut ? timeIn(s.clockOut, tz) : 'now'} · {MODE_LABEL[s.mode]} · {hoursAndMinutes(s.minutes)}
                    {s.autoClosed && <span className="badge warn">Forgot to clock out</span>}
                    {s.edited && <span className="badge" title={s.editReason ?? ''}>Edited</span>}
                    {s.clockOut && editable(d.date) && <> <button type="button" className="link" onClick={() => editSession(s)}>Correct times</button></>}
                  </li>
                ))}
              </ul>
            )}
            {sessionForm && d.sessions.some((s) => s.id === sessionForm.id) && (
              <form className="inline-form" onSubmit={saveSession}>
                <label>From<input type="time" required value={sessionForm.clockIn} onChange={(e) => setSessionForm({ ...sessionForm, clockIn: e.target.value })} /></label>
                <label>To<input type="time" required value={sessionForm.clockOut} onChange={(e) => setSessionForm({ ...sessionForm, clockOut: e.target.value })} /></label>
                <label style={{ flex: 1 }}>Reason<input required minLength={3} maxLength={200} placeholder="For example: forgot to clock out" value={sessionForm.reason} onChange={(e) => setSessionForm({ ...sessionForm, reason: e.target.value })} /></label>
                <button disabled={busy}>Save</button>
                <button type="button" className="secondary" onClick={() => setSessionForm(null)}>Cancel</button>
              </form>
            )}
            {d.logs.length > 0 && (
              <ul className="plain logs">
                {d.logs.map((l) => (
                  <li key={l.id}>
                    <strong>{l.hours}h {l.project}</strong>: {l.description}
                    {editable(d.date) && (
                      <>
                        {' '}<button type="button" className="link" onClick={() => setLogForm({ id: l.id, date: l.date, hours: String(l.hours), project: l.project, description: l.description })}>Edit</button>
                        {' '}<button type="button" className="link" onClick={() => removeLog(l)}>Delete</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {logForm?.date === d.date ? (
              <form className="inline-form" onSubmit={saveLog}>
                <label style={{ width: 90 }}>Hours<input type="number" required min={0.25} max={24} step={0.25} value={logForm.hours} onChange={(e) => setLogForm({ ...logForm, hours: e.target.value })} /></label>
                <label>Project<input required minLength={2} maxLength={80} value={logForm.project} onChange={(e) => setLogForm({ ...logForm, project: e.target.value })} /></label>
                <label style={{ flex: 1 }}>What you did<input required minLength={2} maxLength={1000} value={logForm.description} onChange={(e) => setLogForm({ ...logForm, description: e.target.value })} /></label>
                <button disabled={busy}>{logForm.id ? 'Save' : 'Add'}</button>
                <button type="button" className="secondary" onClick={() => setLogForm(null)}>Cancel</button>
              </form>
            ) : (
              editable(d.date) && <button type="button" className="link" onClick={() => setLogForm({ date: d.date, hours: '1', project: '', description: '' })}>Add a work note</button>
            )}
          </div>
        );
      })}
    </>
  );
}
