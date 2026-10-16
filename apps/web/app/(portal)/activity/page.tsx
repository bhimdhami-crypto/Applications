'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { hoursAndMinutes, MODE_LABEL, timeIn, zonedIso } from '@/components/WorkplaceBits';
import { api, ApiError } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { ActivityWeek, WorkLog, WorkMode, WorkSession } from '@/lib/types';

const MODES = Object.keys(MODE_LABEL) as WorkMode[];
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type LogForm = { id?: string; date: string; hours: string; project: string; description: string };
type SessionForm = { id: string; date: string; clockIn: string; clockOut: string; reason: string };

/** Clock in and out, and note what you worked on (POL-21) */
export default function MyDayPage() {
  const { t, lang } = usePrefs();
  const { can } = useSession();
  const [week, setWeek] = useState<string | undefined>();
  const data = useLoad(() => api<ActivityWeek>(`/activity/me${week ? `?week=${week}` : ''}`), [week]);
  const [mode, setMode] = useState<WorkMode>('OFFICE');
  const [logForm, setLogForm] = useState<LogForm | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const w = data.data;

  // Keeps the running timer fresh while clocked in
  useEffect(() => {
    if (!w?.open) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [w?.open]);

  const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const head = (
    <PageHead
      title={t('nav.myDay')}
      sub="Clock in when you start work and out when you finish, and note what you worked on."
      actions={can('team.read') || can('people.read') || can('payroll.read') ? <Link href="/activity/team">{t('nav.teamActivity')}</Link> : undefined}
    />
  );
  if (!w) {
    return (
      <>
        {head}
        {data.error ? <div className={`alert ${/employees/.test(data.error) ? 'info' : 'error'}`}>{data.error}</div> : <Loading />}
      </>
    );
  }

  const tz = w.timeZone;
  const editable = (date: string) => date >= w.editableFrom && date <= w.today;
  const runningMinutes = w.open ? Math.max(0, Math.round((Date.now() - Date.parse(w.open.clockIn)) / 60_000)) : 0;
  const isThisWeek = w.today >= w.week.start && w.today <= w.week.end;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      data.reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
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
    if (await run(() => (logForm.id ? api(`/activity/logs/${logForm.id}`, { method: 'PATCH', body }) : api('/activity/logs', { method: 'POST', body })))) setLogForm(null);
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
    if (await run(() => api(`/activity/sessions/${id}`, { method: 'PATCH', body }))) setSessionForm(null);
  }

  const editSession = (s: WorkSession) => setSessionForm({ id: s.id, date: s.date, clockIn: timeIn(s.clockIn, tz), clockOut: s.clockOut ? timeIn(s.clockOut, tz) : '', reason: '' });

  return (
    <>
      {head}
      {!w.enabled && <div className="alert warn">Time and attendance is switched off for {w.company}, so new times and notes cannot be added. Your history stays visible.</div>}
      <ErrorAlert error={error} />

      <div className="grid stats">
        <div className="card stat">
          <div className="label">{w.open ? 'You are clocked in' : 'You are clocked out'}</div>
          {w.open ? (
            <>
              <div className="value money">{hoursAndMinutes(runningMinutes)}</div>
              <p className="muted small">
                Since {timeIn(w.open.clockIn, tz)} · {MODE_LABEL[w.open.mode]}
              </p>
              <button type="button" className="btn" disabled={busy} onClick={clockOut}>
                Clock out
              </button>
            </>
          ) : (
            <>
              <label className="field" style={{ marginTop: '.5rem' }}>
                <span>Where are you working today?</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as WorkMode)}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" disabled={busy || !w.enabled} onClick={clockIn}>
                Clock in
              </button>
            </>
          )}
        </div>
        <div className="card stat">
          <div className="label">This week</div>
          <div className="value money">{hoursAndMinutes(w.totals.workedMinutes)}</div>
          <p className="muted small">
            of {w.totals.expectedHours} hours expected · {w.totals.loggedHours} hours noted
          </p>
        </div>
      </div>

      <details className="card" style={{ marginTop: '1rem' }}>
        <summary>What the portal records, and what it does not (POL-21)</summary>
        <p style={{ marginTop: '.6rem' }}>
          We record the times you clock in and out, whether you worked in the office, remotely or on site, and the work notes you add. Your manager sees this for their team; HR and Payroll see it for the company.
        </p>
        <p>
          We do not record your location, screen, keystrokes, websites or apps. A clock-out you forget is closed after {w.limits.autoCloseAfterHours} hours at a normal day’s length and shown to your manager. You can correct your own times and notes for the
          last {w.limits.editDays} days; changes are marked as edited. Times are shown in {tz.replace('_', ' ')} time.
        </p>
      </details>

      <div className="toolbar">
        <button type="button" className="btn secondary small" onClick={() => setWeek(shift(w.week.start, -7))}>
          Previous week
        </button>
        <strong>
          {dayName(w.week.start)} to {dayName(w.week.end)}
        </strong>
        <button type="button" className="btn secondary small" disabled={isThisWeek} onClick={() => setWeek(shift(w.week.start, 7))}>
          Next week
        </button>
        {!isThisWeek && (
          <button type="button" className="linkish" onClick={() => setWeek(undefined)}>
            Back to this week
          </button>
        )}
      </div>

      {w.days.map((d) => {
        const quiet = !d.sessions.length && !d.logs.length;
        if (quiet && !d.working && d.date !== w.today) return null;
        return (
          <section key={d.date} className={`card day${d.date === w.today ? ' today' : ''}`} aria-label={dayName(d.date)}>
            <div className="day-head">
              <h3>
                {dayName(d.date)}
                {d.date === w.today && ' (today)'}
              </h3>
              <span className="muted small">
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
                    {s.edited && (
                      <span className="badge" title={s.editReason ?? ''}>
                        Edited
                      </span>
                    )}
                    {s.clockOut && editable(d.date) && (
                      <>
                        {' '}
                        <button type="button" className="linkish" onClick={() => editSession(s)}>
                          Correct times
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sessionForm && d.sessions.some((s) => s.id === sessionForm.id) && (
              <form className="inline-form" onSubmit={saveSession}>
                <label className="field">
                  <span>From</span>
                  <input type="time" required value={sessionForm.clockIn} onChange={(e) => setSessionForm({ ...sessionForm, clockIn: e.target.value })} />
                </label>
                <label className="field">
                  <span>To</span>
                  <input type="time" required value={sessionForm.clockOut} onChange={(e) => setSessionForm({ ...sessionForm, clockOut: e.target.value })} />
                </label>
                <label className="field" style={{ flex: 1, minWidth: '12rem' }}>
                  <span>Reason</span>
                  <input required minLength={3} maxLength={200} placeholder="For example: forgot to clock out" value={sessionForm.reason} onChange={(e) => setSessionForm({ ...sessionForm, reason: e.target.value })} />
                </label>
                <button className="btn" disabled={busy}>
                  Save
                </button>
                <button type="button" className="btn secondary" onClick={() => setSessionForm(null)}>
                  Cancel
                </button>
              </form>
            )}
            {d.logs.length > 0 && (
              <ul className="plain">
                {d.logs.map((l) => (
                  <li key={l.id}>
                    <strong>
                      {l.hours}h {l.project}
                    </strong>
                    : {l.description}
                    {editable(d.date) && (
                      <>
                        {' '}
                        <button type="button" className="linkish" onClick={() => setLogForm({ id: l.id, date: l.date, hours: String(l.hours), project: l.project, description: l.description })}>
                          Edit
                        </button>{' '}
                        <button type="button" className="linkish" onClick={() => removeLog(l)}>
                          Delete
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {logForm?.date === d.date ? (
              <form className="inline-form" onSubmit={saveLog}>
                <label className="field" style={{ width: 90 }}>
                  <span>Hours</span>
                  <input type="number" required min={0.25} max={24} step={0.25} value={logForm.hours} onChange={(e) => setLogForm({ ...logForm, hours: e.target.value })} />
                </label>
                <label className="field">
                  <span>Project</span>
                  <input required minLength={2} maxLength={80} value={logForm.project} onChange={(e) => setLogForm({ ...logForm, project: e.target.value })} />
                </label>
                <label className="field" style={{ flex: 1, minWidth: '12rem' }}>
                  <span>What you did</span>
                  <input required minLength={2} maxLength={1000} value={logForm.description} onChange={(e) => setLogForm({ ...logForm, description: e.target.value })} />
                </label>
                <button className="btn" disabled={busy}>
                  {logForm.id ? 'Save' : 'Add'}
                </button>
                <button type="button" className="btn secondary" onClick={() => setLogForm(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              editable(d.date) &&
              w.enabled && (
                <button type="button" className="linkish small" onClick={() => setLogForm({ date: d.date, hours: '1', project: '', description: '' })}>
                  Add a work note
                </button>
              )
            )}
          </section>
        );
      })}
    </>
  );
}
