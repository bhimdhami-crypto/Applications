'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, UserPlus, UserRoundCheck, X } from 'lucide-react';
import { PageHeader, Stars, StatusBadge } from '@/components/ui';
import { api, Candidate, CandidateStage, EMPLOYMENT_TYPE_LABEL, JobOpening, LOCATION_LABEL, STAGE_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';

type Opening = JobOpening & { candidates: Candidate[] };
const FLOW: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const BLANK = { firstName: '', lastName: '', email: '', phone: '', source: 'Careers site', notes: '' };

export default function OpeningPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const isHr = can('HR');
  const [o, setO] = useState<Opening | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [hiring, setHiring] = useState<Candidate | null>(null);
  const [hire, setHire] = useState({ hireDate: '', monthlyBasic: '', workEmail: '' });
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    api<Opening>(`/recruitment/openings/${id}`).then(setO).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      load();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (c: Candidate, stage: CandidateStage) =>
    run(() => api(`/recruitment/candidates/${c.id}`, { method: 'PATCH', body: { stage } }), `${c.firstName} ${c.lastName} moved to ${STAGE_LABEL[stage]}.`);
  const rate = (c: Candidate, rating: number) => run(() => api(`/recruitment/candidates/${c.id}`, { method: 'PATCH', body: { rating } }), `Score saved for ${c.firstName}.`);

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => api(`/recruitment/openings/${id}/candidates`, { method: 'POST', body: { ...form, phone: form.phone || undefined, notes: form.notes || undefined } }),
      `${form.firstName} ${form.lastName} added.`,
    );
    if (ok) {
      setForm(BLANK);
      setAdding(false);
    }
  }

  async function doHire(e: FormEvent) {
    e.preventDefault();
    if (!hiring) return;
    const ok = await run(
      () => api(`/recruitment/candidates/${hiring.id}/hire`, { method: 'POST', body: { hireDate: hire.hireDate, monthlyBasic: Number(hire.monthlyBasic), workEmail: hire.workEmail || undefined } }),
      `${hiring.firstName} ${hiring.lastName} is hired. Their employee record and portal login are ready, and a welcome email was sent.`,
    );
    if (ok) setHiring(null);
  }

  const setStatus = (status: JobOpening['status']) => run(() => api(`/recruitment/openings/${id}`, { method: 'PATCH', body: { status } }), `Opening marked ${status.toLowerCase().replace('_', ' ')}.`);

  if (!o) return error ? <div className="notice error">{error}</div> : <div className="loading"><span className="spinner" /> Loading opening…</div>;
  const cur = o.company.currency;
  const closed = o.candidates.filter((c) => c.stage === 'REJECTED' || c.stage === 'WITHDRAWN');

  return (
    <>
      <PageHeader
        back={{ href: '/recruitment', label: 'Recruitment' }}
        title={<>{o.title} <StatusBadge status={o.status} /></>}
        sub={<>{o.reference} · {o.company.name} · {o.department} · {LOCATION_LABEL[o.workLocation]}{o.city ? `, ${o.city}` : ''} · {EMPLOYMENT_TYPE_LABEL[o.employmentType]}</>}
        actions={
          <>
            {o.status === 'OPEN' && <button onClick={() => setAdding(!adding)} className={adding ? 'secondary' : ''}>{adding ? 'Cancel' : <><UserPlus size={16} /> Add candidate</>}</button>}
            {isHr && o.status === 'OPEN' && <button className="secondary" disabled={busy} onClick={() => setStatus('ON_HOLD')}><Pause size={16} /> Put on hold</button>}
            {isHr && o.status === 'ON_HOLD' && <button className="secondary" disabled={busy} onClick={() => setStatus('OPEN')}><Play size={16} /> Reopen</button>}
            {isHr && (o.status === 'OPEN' || o.status === 'ON_HOLD') && <button className="secondary danger" disabled={busy} onClick={() => window.confirm('Close this opening? Candidates stay on record.') && setStatus('CLOSED')}><X size={16} /> Close</button>}
          </>
        }
      />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="grid">
        <div className="card stat"><div className="label">Positions</div><div className="value">{o.positions}</div><div className="muted">{o.candidates.filter((c) => c.stage === 'HIRED').length} hired so far</div></div>
        <div className="card stat"><div className="label">Hiring manager</div><div className="value" style={{ fontSize: '1.15rem' }}>{o.hiringManager ? `${o.hiringManager.firstName} ${o.hiringManager.lastName}` : 'HR'}</div><div className="muted">{o.hiringManager?.jobTitle ?? 'No hiring manager set'}</div></div>
        <div className="card stat"><div className="label">Monthly pay range</div><div className="value" style={{ fontSize: '1.15rem' }}>{o.salaryMin && o.salaryMax ? `${cur} ${Number(o.salaryMin).toLocaleString('en-GB')} – ${Number(o.salaryMax).toLocaleString('en-GB')}` : 'Not set'}</div><div className="muted">Visible to HR and the hiring manager</div></div>
        <div className="card stat"><div className="label">Applications close</div><div className="value" style={{ fontSize: '1.15rem' }}>{o.closesOn ? new Date(o.closesOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Open-ended'}</div><div className="muted">{o.grade ? `Grade ${o.grade}` : ''}</div></div>
      </div>
      {o.description && <div className="card"><h3>About the role</h3><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{o.description}</p></div>}

      {adding && (
        <form className="card" onSubmit={add}>
          <h2>Add a candidate</h2>
          <div className="form-grid">
            <label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>
              Source
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {['Careers site', 'Referral', 'LinkedIn', 'Agency', 'University', 'Internal'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>Notes<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" disabled={busy}><UserPlus size={16} /> Add candidate</button>
          </div>
        </form>
      )}

      {hiring && (
        <form className="card" onSubmit={doHire} style={{ borderColor: 'var(--success)' }}>
          <h2>Hire {hiring.firstName} {hiring.lastName}</h2>
          <p className="muted">Creates an employee in {o.company.name} as {o.title}, reporting to {o.hiringManager ? `${o.hiringManager.firstName} ${o.hiringManager.lastName}` : 'nobody yet'}, with a portal login and a welcome email.</p>
          <div className="form-grid">
            <label>Start date<input type="date" required value={hire.hireDate} onChange={(e) => setHire({ ...hire, hireDate: e.target.value })} /></label>
            <label>Monthly basic pay ({cur})<input type="number" min={0} step="0.01" required value={hire.monthlyBasic} onChange={(e) => setHire({ ...hire, monthlyBasic: e.target.value })} /></label>
            <label>Work email<input type="email" placeholder={hiring.email} value={hire.workEmail} onChange={(e) => setHire({ ...hire, workEmail: e.target.value })} /><span className="hint">Leave blank to use their own email for the login</span></label>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setHiring(null)}>Cancel</button>
            <button type="submit" disabled={busy}><UserRoundCheck size={16} /> Hire and create employee</button>
          </div>
        </form>
      )}

      <div className="kanban">
        {FLOW.map((stage, i) => {
          const list = o.candidates.filter((c) => c.stage === stage);
          return (
            <section className="lane" key={stage} aria-label={STAGE_LABEL[stage]}>
              <div className="lane-head"><span>{STAGE_LABEL[stage]}</span><span className="tag">{list.length}</span></div>
              {list.map((c) => (
                <article className="ticket" key={c.id}>
                  <strong>{c.firstName} {c.lastName}</strong>
                  <span className="muted">{c.source}</span>
                  <span className="muted ticket-email" title={c.email}>{c.email}</span>
                  {stage !== 'HIRED' ? (
                    <span className="rating-row" aria-label="Interview score">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" className={`star${(c.rating ?? 0) >= n ? ' on' : ''}`} disabled={busy} onClick={() => rate(c, n)} aria-label={`Score ${n}`}>★</button>
                      ))}
                    </span>
                  ) : (
                    c.rating ? <Stars value={c.rating} /> : null
                  )}
                  {c.notes && <span className="muted">{c.notes}</span>}
                  {stage === 'HIRED' && c.employee && <Link className="small" href={`/employees/${c.employee.id}`}>Employee {c.employee.employeeNo}</Link>}
                  {stage !== 'HIRED' && (
                    <div className="ticket-tools">
                      {i > 0 && <button className="secondary small" disabled={busy} onClick={() => move(c, FLOW[i - 1])} aria-label="Move back"><ArrowLeft size={14} /></button>}
                      {stage !== 'OFFER' && <button className="secondary small" disabled={busy} onClick={() => move(c, FLOW[i + 1])}>{STAGE_LABEL[FLOW[i + 1]]} <ArrowRight size={14} /></button>}
                      {stage === 'OFFER' && isHr && <button className="small" disabled={busy} onClick={() => { setHiring(c); setHire({ hireDate: '', monthlyBasic: o.salaryMin ?? '', workEmail: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><UserRoundCheck size={14} /> Hire</button>}
                      <button className="ghost small" disabled={busy} onClick={() => move(c, 'REJECTED')} title="Not progressing"><X size={14} /></button>
                    </div>
                  )}
                </article>
              ))}
              {list.length === 0 && <p className="muted small" style={{ textAlign: 'center', margin: '1rem 0' }}>No one here</p>}
            </section>
          );
        })}
      </div>

      {closed.length > 0 && (
        <section className="card" style={{ marginTop: '1rem' }}>
          <div className="section-head">
            <h2>Not progressing ({closed.length})</h2>
            <button className="secondary small" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide' : 'Show'}</button>
          </div>
          {showClosed && (
            <ul className="plain">
              {closed.map((c) => (
                <li key={c.id}>
                  <strong style={{ fontWeight: 550 }}>{c.firstName} {c.lastName}</strong>
                  <StatusBadge status={c.stage} label={STAGE_LABEL[c.stage]} />
                  <span className="muted small">{c.notes}</span>
                  <span className="spacer" />
                  {o.status === 'OPEN' && <button className="secondary small" disabled={busy} onClick={() => move(c, 'SCREENING')}>Reconsider</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
