'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, COUNTRY_NAME, dateRange, formatDate, LEAVE_STATUS_LABEL, LeaveBalance, LeaveRequest, LeaveType, LeaveTypeInfo } from '@/lib/api';
import { useSession } from '@/lib/session';

interface LeaveList {
  employee: { id: string; name: string; employeeNo: string; countryCode: string; company: string };
  requests: LeaveRequest[];
  adjustments: Array<{ id: string; type: LeaveType; days: number; reason: string; createdAt: string }>;
}

const EMPTY = { type: 'ANNUAL' as LeaveType, startDate: '', endDate: '', reason: '', handoverTo: '', contactWhileAway: '' };
const thisYear = new Date().getFullYear();

function LeavePage() {
  const { me, can } = useSession();
  const params = useSearchParams();
  const employeeId = params.get('employeeId') ?? undefined;
  const [year, setYear] = useState(thisYear);
  const [types, setTypes] = useState<LeaveTypeInfo[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [data, setData] = useState<LeaveList | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState<{ days: number; holidays: Array<{ date: string; name: string }> } | null>(null);
  const [adjust, setAdjust] = useState({ type: 'ANNUAL' as LeaveType, days: '', reason: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isHr = can('HR');
  const own = !employeeId || employeeId === me.employee?.id;
  // HR records leave for others (approved at once); everyone requests their own
  const canRequest = own ? !!me.employee : isHr;
  const query = `year=${year}${employeeId ? `&employeeId=${employeeId}` : ''}`;

  const load = useCallback(() => {
    api<LeaveBalance[]>(`/leave/balances?${query}`).then(setBalances).catch((e) => setError(e.message));
    api<LeaveList>(`/leave/requests?${query}`).then(setData).catch((e) => setError(e.message));
  }, [query]);

  useEffect(load, [load]);
  useEffect(() => {
    api<LeaveTypeInfo[]>('/leave/types').then(setTypes).catch(() => setTypes([]));
  }, []);

  // Working-day count as the dates are picked
  useEffect(() => {
    setPreview(null);
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ startDate: form.startDate, endDate: form.endDate, ...(employeeId ? { employeeId } : {}) });
      api<{ days: number; holidays: Array<{ date: string; name: string }> }>(`/leave/preview?${q}`).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.startDate, form.endDate, employeeId]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value, ...(key === 'startDate' && (!form.endDate || form.endDate < e.target.value) ? { endDate: e.target.value } : {}) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    const body = new FormData();
    for (const [k, v] of Object.entries(form)) if (v) body.append(k, v);
    if (!own && employeeId) body.append('employeeId', employeeId);
    const file = fileInput.current?.files?.[0];
    if (file) body.append('file', file);
    setBusy(true);
    try {
      const created = await api<LeaveRequest>('/leave/requests', { method: 'POST', body });
      setNotice(
        created.status === 'APPROVED'
          ? `Recorded ${created.days} day${created.days === 1 ? '' : 's'} of leave.`
          : `Request sent: ${created.days} working day${created.days === 1 ? '' : 's'}. ${LEAVE_STATUS_LABEL[created.status]}.`,
      );
      setForm(EMPTY);
      if (fileInput.current) fileInput.current.value = '';
      if (Number(created.startDate.slice(0, 4)) !== year) setYear(Number(created.startDate.slice(0, 4)));
      else load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: LeaveRequest) {
    if (!window.confirm(`Cancel ${typeLabel(r.type).toLowerCase()} for ${dateRange(r.startDate, r.endDate)}?`)) return;
    setError('');
    try {
      await api(`/leave/requests/${r.id}/cancel`, { method: 'POST' });
      setNotice('Request cancelled.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addAdjustment(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError('');
    try {
      await api('/leave/adjustments', { method: 'POST', body: { employeeId: data.employee.id, type: adjust.type, year, days: Number(adjust.days), reason: adjust.reason } });
      setNotice('Balance adjusted.');
      setAdjust({ type: 'ANNUAL', days: '', reason: '' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const typeLabel = (t: LeaveType) => types.find((x) => x.type === t)?.label ?? t;
  const info = types.find((t) => t.type === form.type);
  const annual = balances.find((b) => b.type === 'ANNUAL');
  const others = balances.filter((b) => b.type !== 'ANNUAL' && b.entitlement !== null);
  const needsCertificate = form.type === 'SICK' && (preview?.days ?? 0) > 2;

  return (
    <>
      <div className="section-head">
        <h1>{own ? 'My leave' : `Leave: ${data?.employee.name ?? ''}`}</h1>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label style={{ marginBottom: 0 }}>
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
        </div>
      </div>
      {!own && data && (
        <p className="muted">
          <Link href={`/employees/${data.employee.id}`}>{data.employee.employeeNo}</Link> · {data.employee.company}
        </p>
      )}
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {annual && (
        <div className="grid">
          <div className="card stat">
            <div className="label">Annual leave left in {year}</div>
            <div className="value">{annual.left} days</div>
            <div className="muted small">
              {annual.entitlement} for the year
              {annual.carriedOver ? ` + ${annual.carriedOver} carried over` : ''}
              {annual.adjustment ? ` ${annual.adjustment > 0 ? '+' : '−'} ${Math.abs(annual.adjustment)} adjusted by HR` : ''}
              {' · '}{annual.approved} taken or booked{annual.pending ? `, ${annual.pending} waiting` : ''}
            </div>
          </div>
          {others.map((b) => (
            <div className="card stat" key={b.type}>
              <div className="label">{b.label}</div>
              <div className="value">{b.left} <span className="muted small">of {(b.entitlement ?? 0) + b.adjustment}</span></div>
              <div className="muted small">
                {b.type === 'SICK' ? 'First 30 days on full pay, next 30 on half pay' : `${b.approved} used${b.pending ? `, ${b.pending} waiting` : ''}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {canRequest && (
        <form className="card" onSubmit={submit}>
          <h2 style={{ marginTop: 0 }}>{own ? 'Request leave' : 'Record leave'}</h2>
          {!own && <p className="muted">Leave you record here is approved straight away. Use it for staff without a portal login, or to correct the record.</p>}
          <div className="form-grid">
            <label>
              Type
              <select value={form.type} onChange={set('type')}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </label>
            <label>First day<input type="date" required value={form.startDate} onChange={set('startDate')} /></label>
            <label>Last day<input type="date" required min={form.startDate} value={form.endDate} onChange={set('endDate')} /></label>
            <label>Handover to (colleague)<input value={form.handoverTo} onChange={set('handoverTo')} /></label>
            <label>Contact while away<input value={form.contactWhileAway} onChange={set('contactWhileAway')} /></label>
            <label>
              {form.type === 'SICK' ? 'Medical certificate' : 'Supporting document (optional)'}
              <input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={needsCertificate && own} />
            </label>
          </div>
          <label>Reason or notes (optional)<textarea rows={2} value={form.reason} onChange={set('reason')} /></label>
          {info && <p className="muted small">{info.note}{info.hrApproval ? ' Needs approval from your manager and then HR.' : ''}</p>}
          {preview && (
            <p>
              <strong>{preview.days} working day{preview.days === 1 ? '' : 's'}</strong>
              {preview.holidays.length > 0 && <span className="muted"> (skips {preview.holidays.map((h) => `${h.name} on ${formatDate(h.date)}`).join(', ')})</span>}
            </p>
          )}
          {needsCertificate && <p className="muted small">Sick leave over 2 days needs a medical certificate.</p>}
          <button type="submit" disabled={busy}>{own ? 'Send request' : 'Record leave'}</button>
        </form>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Requests in {year}</h2>
          <Link href="/leave/holidays">Public holidays{data ? ` in ${COUNTRY_NAME[data.employee.countryCode] ?? data.employee.countryCode}` : ''}</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Type</th><th>Dates</th><th className="num">Days</th><th>Status</th><th>Notes</th><th /></tr>
            </thead>
            <tbody>
              {data?.requests.map((r) => (
                <tr key={r.id}>
                  <td>{typeLabel(r.type)}</td>
                  <td>{dateRange(r.startDate, r.endDate)}</td>
                  <td className="num">{r.days}</td>
                  <td><span className={`badge ${r.status}`}>{LEAVE_STATUS_LABEL[r.status]}</span></td>
                  <td className="muted small">{[r.reason, r.managerNote && `Manager: ${r.managerNote}`, r.hrNote && `HR: ${r.hrNote}`].filter(Boolean).join(' · ')}</td>
                  <td className="actions">{r.canCancel && <button className="secondary small" onClick={() => cancel(r)}>Cancel</button>}</td>
                </tr>
              ))}
              {data && data.requests.length === 0 && <tr><td colSpan={6} className="muted">No leave in {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isHr && !own && data && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Adjust a balance</h2>
          <p className="muted">For opening balances or anything agreed outside the rules. Use a negative number to take days off.</p>
          {data.adjustments.length > 0 && (
            <ul>
              {data.adjustments.map((a) => (
                <li key={a.id}>{typeLabel(a.type)}: {a.days > 0 ? '+' : ''}{a.days} days, {a.reason} ({formatDate(a.createdAt)})</li>
              ))}
            </ul>
          )}
          <form onSubmit={addAdjustment}>
            <div className="form-grid">
              <label>
                Type
                <select value={adjust.type} onChange={(e) => setAdjust({ ...adjust, type: e.target.value as LeaveType })}>
                  {types.filter((t) => t.yearly).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </label>
              <label>Days<input type="number" required min={-60} max={60} value={adjust.days} onChange={(e) => setAdjust({ ...adjust, days: e.target.value })} /></label>
              <label>Reason<input required minLength={3} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} /></label>
            </div>
            <button type="submit" className="secondary">Adjust {year} balance</button>
          </form>
        </section>
      )}
    </>
  );
}

export default function LeavePageWrapper() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <LeavePage />
    </Suspense>
  );
}
