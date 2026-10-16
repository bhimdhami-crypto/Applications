'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { DraftRulesNote, dateRange, leaveLabel, LeaveStatusBadge } from '@/components/LeaveBits';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, apiUpload } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { LeaveBalance, LeaveRequest, LeaveRulePack, LeaveType, LeaveTypeInfo } from '@/lib/types';

interface LeaveList {
  employee: { id: string; name: string; employeeNumber: string; countryCode: string; entity: { id: string; code: string; name: string }; self: boolean; hr: boolean };
  requests: LeaveRequest[];
  adjustments: Array<{ id: string; type: LeaveType; days: number; reason: string; createdAt: string }>;
}
type Preview = { days: number; holidays: Array<{ date: string; name: string }> };

const EMPTY = { type: 'ANNUAL' as LeaveType, startDate: '', endDate: '', reason: '', handoverTo: '', contactWhileAway: '' };
const thisYear = new Date().getFullYear();

function LeavePage() {
  const { t, lang } = usePrefs();
  const params = useSearchParams();
  const employmentId = params.get('employee') ?? undefined;
  const [year, setYear] = useState(thisYear);
  const q = `year=${year}${employmentId ? `&employmentId=${employmentId}` : ''}`;
  const types = useLoad(() => api<{ rulePack: LeaveRulePack; types: LeaveTypeInfo[] }>('/leave/types'), []);
  const balances = useLoad(() => api<{ rulePack: LeaveRulePack; balances: LeaveBalance[] }>(`/leave/balances?${q}`), [q]);
  const list = useLoad(() => api<LeaveList>(`/leave/requests?${q}`), [q]);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [adjust, setAdjust] = useState({ type: 'ANNUAL' as LeaveType, days: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const emp = list.data?.employee;
  const own = !employmentId || !!emp?.self;
  // Everyone asks for their own leave; HR records it for others in their companies
  const canRequest = !!emp && (emp.self || emp.hr);

  // Working-day count as the dates are picked
  useEffect(() => {
    setPreview(null);
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) return;
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ startDate: form.startDate, endDate: form.endDate, ...(employmentId ? { employmentId } : {}) });
      api<Preview>(`/leave/preview?${p}`).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.startDate, form.endDate, employmentId]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value, ...(key === 'startDate' && (!form.endDate || form.endDate < e.target.value) ? { endDate: e.target.value } : {}) });

  const reload = () => {
    balances.reload();
    list.reload();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const body = new FormData();
    for (const [k, v] of Object.entries(form)) if (v) body.append(k, v);
    if (!own && employmentId) body.append('employmentId', employmentId);
    const file = fileInput.current?.files?.[0];
    if (file) body.append('file', file);
    setBusy(true);
    try {
      const created = await apiUpload<LeaveRequest>('/leave/requests', body);
      setNotice(
        created.status === 'APPROVED'
          ? `Recorded ${created.days} working day${created.days === 1 ? '' : 's'} of leave.`
          : `Request sent: ${created.days} working day${created.days === 1 ? '' : 's'}, ${created.approver ? `waiting for ${created.approver.name}` : 'waiting for HR'}.`,
      );
      setForm(EMPTY);
      if (fileInput.current) fileInput.current.value = '';
      if (Number(created.startDate.slice(0, 4)) !== year) setYear(Number(created.startDate.slice(0, 4)));
      else reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: LeaveRequest) {
    if (!window.confirm(`Cancel ${leaveLabel(r.type).toLowerCase()} for ${dateRange(r.startDate, r.endDate, lang)}?`)) return;
    setError(null);
    try {
      await api(`/leave/requests/${r.id}/cancel`, { method: 'POST' });
      setNotice('Request cancelled.');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addAdjustment(e: FormEvent) {
    e.preventDefault();
    if (!emp) return;
    setError(null);
    try {
      await api('/leave/adjustments', { method: 'POST', body: { employmentId: emp.id, type: adjust.type, year, days: Number(adjust.days), reason: adjust.reason } });
      setNotice('Balance adjusted.');
      setAdjust({ type: 'ANNUAL', days: '', reason: '' });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const info = types.data?.types.find((x) => x.type === form.type);
  const all = balances.data?.balances ?? [];
  const annual = all.find((b) => b.type === 'ANNUAL');
  const others = all.filter((b) => b.type !== 'ANNUAL' && b.entitlement !== null);
  const needsCertificate = form.type === 'SICK' && (preview?.days ?? 0) > 2;

  return (
    <>
      <PageHead
        title={own ? t('nav.myLeave') : `Leave: ${emp?.name ?? ''}`}
        crumbs={!own && emp ? <Link href={`/people/${emp.id}`}>{emp.name}</Link> : undefined}
        sub={emp ? `${emp.employeeNumber} · ${emp.entity.name}` : undefined}
        actions={
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        }
      />
      <DraftRulesNote pack={balances.data?.rulePack} />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || list.error || balances.error} />

      {!balances.data ? (
        <Loading />
      ) : (
        <div className="grid stats">
          {annual && (
            <div className="card stat">
              <div className="label">Annual leave left in {year}</div>
              <div className="value">{annual.left}</div>
              <div className="muted" style={{ fontSize: '.8rem' }}>
                {annual.entitlement} for the year
                {annual.carriedOver ? ` + ${annual.carriedOver} carried over` : ''}
                {annual.adjustment ? ` ${annual.adjustment > 0 ? '+' : '−'} ${Math.abs(annual.adjustment)} adjusted by HR` : ''} · {annual.approved} taken or booked
                {annual.pending ? `, ${annual.pending} waiting` : ''}
              </div>
            </div>
          )}
          {others.map((b) => (
            <div className="card stat" key={b.type}>
              <div className="label">{b.label}</div>
              <div className="value">
                {b.left} <span className="muted" style={{ fontSize: '.9rem' }}>of {(b.entitlement ?? 0) + b.adjustment}</span>
              </div>
              <div className="muted" style={{ fontSize: '.8rem' }}>
                {b.type === 'SICK' ? 'First 30 days on full pay, next 30 on half pay' : `${b.approved} used${b.pending ? `, ${b.pending} waiting` : ''}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {canRequest && (
        <form className="card" onSubmit={submit}>
          <h2>{own ? 'Request leave' : 'Record leave'}</h2>
          {!own && <p className="muted">Leave you record here is approved straight away. Use it for staff without a portal account, or to correct the record.</p>}
          <div className="row">
            <label className="field">
              <span>Type</span>
              <select value={form.type} onChange={set('type')}>
                {types.data?.types.map((x) => (
                  <option key={x.type} value={x.type}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>First day</span>
              <input type="date" required value={form.startDate} onChange={set('startDate')} />
            </label>
            <label className="field">
              <span>Last day</span>
              <input type="date" required min={form.startDate} value={form.endDate} onChange={set('endDate')} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>Handover to (colleague)</span>
              <input value={form.handoverTo} onChange={set('handoverTo')} maxLength={120} />
            </label>
            <label className="field">
              <span>Contact while away</span>
              <input value={form.contactWhileAway} onChange={set('contactWhileAway')} maxLength={120} />
            </label>
            <label className="field">
              <span>{form.type === 'SICK' ? 'Medical certificate' : 'Supporting document (optional)'}</span>
              <input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={needsCertificate && own} />
            </label>
          </div>
          <label className="field">
            <span>Reason or notes (optional)</span>
            <textarea rows={2} value={form.reason} onChange={set('reason')} maxLength={500} />
          </label>
          {info && (
            <p className="muted">
              {info.note}
              {info.hrApproval ? ' Needs approval from the manager and then HR.' : ''}
            </p>
          )}
          {preview && (
            <p>
              <strong>
                {preview.days} working day{preview.days === 1 ? '' : 's'}
              </strong>
              {preview.holidays.length > 0 && <span className="muted"> (skips {preview.holidays.map((h) => `${h.name} on ${fmtDate(h.date, lang)}`).join(', ')})</span>}
            </p>
          )}
          {needsCertificate && <p className="muted">Sick leave over 2 days needs a medical certificate.</p>}
          <button className="btn" type="submit" disabled={busy}>
            {own ? 'Send request' : 'Record leave'}
          </button>
        </form>
      )}

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>Requests in {year}</h2>
          <Link href="/leave/holidays">Public holidays</Link>
        </div>
        {!list.data ? (
          <Loading />
        ) : list.data.requests.length === 0 ? (
          <Empty>No leave in {year}.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Dates</th>
                  <th className="num">Days</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.requests.map((r) => (
                  <tr key={r.id}>
                    <td>{leaveLabel(r.type)}</td>
                    <td>{dateRange(r.startDate, r.endDate, lang)}</td>
                    <td className="num">{r.days}</td>
                    <td>
                      <LeaveStatusBadge status={r.status} />
                      {r.status === 'PENDING_MANAGER' && r.approver && <div className="muted" style={{ fontSize: '.8rem' }}>{r.approver.name}</div>}
                    </td>
                    <td className="muted" style={{ fontSize: '.85rem' }}>
                      {[r.reason, r.managerNote && `Manager: ${r.managerNote}`, r.hrNote && `HR: ${r.hrNote}`].filter(Boolean).join(' · ')}
                    </td>
                    <td>
                      {r.canCancel && (
                        <button className="btn secondary small" onClick={() => cancel(r)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {emp?.hr && !emp.self && (
        <section className="card">
          <h2>Adjust a balance</h2>
          <p className="muted">For opening balances or anything agreed outside the rules. Use a negative number to take days off.</p>
          {list.data && list.data.adjustments.length > 0 && (
            <ul>
              {list.data.adjustments.map((a) => (
                <li key={a.id}>
                  {leaveLabel(a.type)}: {a.days > 0 ? '+' : ''}
                  {a.days} days, {a.reason} ({fmtDate(a.createdAt, lang)})
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addAdjustment} className="row">
            <label className="field">
              <span>Type</span>
              <select value={adjust.type} onChange={(e) => setAdjust({ ...adjust, type: e.target.value as LeaveType })}>
                {types.data?.types
                  .filter((x) => x.yearly)
                  .map((x) => (
                    <option key={x.type} value={x.type}>
                      {x.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Days</span>
              <input type="number" required min={-60} max={60} value={adjust.days} onChange={(e) => setAdjust({ ...adjust, days: e.target.value })} />
            </label>
            <label className="field">
              <span>Reason</span>
              <input required minLength={3} maxLength={200} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
            </label>
            <button type="submit" className="btn secondary" style={{ marginBottom: '.8rem' }}>
              Adjust {year} balance
            </button>
          </form>
        </section>
      )}
    </>
  );
}

export default function LeavePageWrapper() {
  return (
    <Suspense fallback={<Loading />}>
      <LeavePage />
    </Suspense>
  );
}
