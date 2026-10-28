'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Flag, Plus, Target, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Empty, PageHeader, StatusBadge } from '@/components/ui';
import { api, Company, Goal, RATING_LABEL, Review, ReviewCycle, ReviewPerson } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'mine' | 'team' | 'cycles';
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

export default function PerformancePage() {
  return (
    <Suspense>
      <Performance />
    </Suspense>
  );
}

/** 1 to 5 picker with the label of the chosen score */
function RatingPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="rating" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)} title={RATING_LABEL[n]}>{n}</button>
        ))}
      </div>
      <div className="hint">{value ? RATING_LABEL[value] : '1 is below expectations, 5 is exceptional'}</div>
    </div>
  );
}

function ReviewForm({ onSubmit, cta, busy }: { onSubmit: (rating: number, comments: string) => void; cta: string; busy: boolean }) {
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');
  return (
    <form
      className="inline-form"
      style={{ display: 'block' }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (rating) onSubmit(rating, comments);
      }}
    >
      <div className="field-label">Overall rating</div>
      <RatingPicker value={rating} onChange={setRating} />
      <label style={{ marginTop: '0.85rem' }}>Comments<textarea rows={4} required minLength={10} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="What went well, what to improve, and examples" /></label>
      <button type="submit" disabled={busy || !rating}>{cta}</button>
    </form>
  );
}

function Person({ p }: { p: ReviewPerson }) {
  return (
    <span className="person">
      <Avatar employeeId={p.id} name={`${p.firstName} ${p.lastName}`} hasPhoto={false} size={32} />
      <span>{p.firstName} {p.lastName}<span className="sub">{p.jobTitle}</span></span>
    </span>
  );
}

function Goals({ employeeId, editable }: { employeeId?: string; editable: boolean }) {
  const [data, setData] = useState<{ employee: ReviewPerson; goals: Goal[]; summary: { count: number; weight: number; progress: number } } | null>(null);
  const [form, setForm] = useState({ title: '', weight: '', dueOn: '' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<typeof data>(`/performance/goals${employeeId ? `?employeeId=${employeeId}` : ''}`).then(setData).catch((e) => setError(e.message));
  }, [employeeId]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/performance/goals', { method: 'POST', body: { employeeId, title: form.title, weight: form.weight ? Number(form.weight) : undefined, dueOn: form.dueOn || undefined } });
      setForm({ title: '', weight: '', dueOn: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const update = (g: Goal, body: Partial<Goal>) => api(`/performance/goals/${g.id}`, { method: 'PATCH', body }).then(load).catch((e) => setError(e.message));
  const remove = (g: Goal) => window.confirm(`Delete the goal "${g.title}"?`) && api(`/performance/goals/${g.id}`, { method: 'DELETE' }).then(load).catch((e) => setError(e.message));

  if (!data) return error ? <div className="notice error">{error}</div> : <div className="loading"><span className="spinner" /></div>;
  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2 style={{ marginBottom: '0.2rem' }}>{employeeId ? `${data.employee.firstName} ${data.employee.lastName}'s goals` : 'My goals'}</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.summary.count} active · weighted progress {data.summary.progress}%{data.summary.weight !== 100 && data.summary.count ? ` · weights add up to ${data.summary.weight}%` : ''}</p>
        </div>
        {editable && <button className={adding ? 'secondary small' : 'small'} onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : <><Plus size={14} /> Add goal</>}</button>}
      </div>
      {error && <div className="notice error">{error}</div>}
      {adding && (
        <form className="inline-form" onSubmit={add}>
          <label style={{ flex: '3 1 260px' }}>Goal<input required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Specific and measurable" /></label>
          <label style={{ flex: '1 1 90px' }}>Weight %<input type="number" min={0} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></label>
          <label style={{ flex: '1 1 150px' }}>Due<input type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></label>
          <button type="submit">Add</button>
        </form>
      )}
      <div className="progress teal" style={{ margin: '0.75rem 0 1rem' }}><span style={{ width: `${data.summary.progress}%` }} /></div>
      {data.goals.length === 0 && <Empty icon={Flag} title="No goals yet">{editable ? 'Add two to five goals for this review period.' : 'Goals appear here once they are set.'}</Empty>}
      <ul className="goal-list">
        {data.goals.map((g) => (
          <li key={g.id} className={g.status === 'CANCELLED' ? 'off' : ''}>
            <div className="goal-main">
              <strong>{g.status === 'COMPLETED' && <CheckCircle2 size={15} color="var(--success)" style={{ verticalAlign: -2, marginRight: 4 }} />}{g.title}</strong>
              <span className="muted small">{g.weight ? `${g.weight}% weight` : 'No weight'}{g.dueOn ? ` · due ${day(g.dueOn)}` : ''}{g.cycle ? ` · ${g.cycle.name}` : ''}</span>
            </div>
            <div className="goal-progress">
              <div className="progress"><span style={{ width: `${g.progress}%`, background: g.status === 'COMPLETED' ? 'var(--success)' : undefined }} /></div>
              <span className="tnum small">{g.progress}%</span>
            </div>
            {editable && g.status !== 'CANCELLED' && (
              <div className="actions" style={{ gap: '0.3rem' }}>
                <select aria-label="Progress" value={g.progress} onChange={(e) => update(g, { progress: Number(e.target.value) })} style={{ width: 88, margin: 0, minHeight: 30, padding: '0.2rem 1.6rem 0.2rem 0.5rem' }}>
                  {[...new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, g.progress])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}%</option>)}
                </select>
                <button className="ghost small" onClick={() => remove(g)} aria-label="Delete goal"><Trash2 size={14} /></button>
              </div>
            )}
            {g.status !== 'IN_PROGRESS' && <StatusBadge status={g.status} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Performance() {
  const { me, can } = useSession();
  const params = useSearchParams();
  const focusId = params.get('employeeId') ?? '';
  const isHr = can('HR');
  const [tab, setTab] = useState<Tab>(focusId ? 'team' : me.employee ? 'mine' : 'cycles');
  const [mine, setMine] = useState<{ own: Review[]; toGive: Review[] } | null>(null);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [openCycle, setOpenCycle] = useState<string>('');
  const [cycleReviews, setCycleReviews] = useState<Review[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [newCycle, setNewCycle] = useState({ name: '', companyId: '', periodStart: '', periodEnd: '', selfDueOn: '', managerDueOn: '' });
  const [showNew, setShowNew] = useState(false);
  const [teamPerson, setTeamPerson] = useState(focusId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (me.employee) api<{ own: Review[]; toGive: Review[] }>('/performance/reviews/mine').then(setMine).catch((e) => setError(e.message));
    api<ReviewCycle[]>('/performance/cycles').then(setCycles).catch(() => setCycles([]));
  }, [me.employee]);
  useEffect(load, [load]);
  useEffect(() => {
    if (isHr) api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.payrollRules))).catch(() => setCompanies([]));
  }, [isHr]);
  useEffect(() => {
    if (!openCycle) return;
    setCycleReviews(null);
    api<Review[]>(`/performance/cycles/${openCycle}/reviews`).then(setCycleReviews).catch((e) => setError(e.message));
  }, [openCycle]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      load();
      if (openCycle) api<Review[]>(`/performance/cycles/${openCycle}/reviews`).then(setCycleReviews).catch(() => undefined);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const current = mine?.own.find((r) => r.cycle.status === 'OPEN');
  const past = mine?.own.filter((r) => r.cycle.status === 'CLOSED' || r.status === 'COMPLETED') ?? [];
  const toGive = mine?.toGive ?? [];
  const team = Array.from(new Map(toGive.map((r) => [r.employee.id, r.employee])).values());
  const showTeam = team.length > 0 || !!focusId;

  return (
    <>
      <PageHeader
        title="Performance"
        sub="Goals through the year, then a self review and your manager's review each cycle. Ratings run from 1 (below expectations) to 5 (exceptional)."
        actions={isHr && <button className={showNew ? 'secondary' : ''} onClick={() => { setShowNew(!showNew); setTab('cycles'); }}>{showNew ? 'Cancel' : <><Plus size={16} /> Open a review cycle</>}</button>}
      />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <nav className="tabs">
        {me.employee && <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}><Target size={15} /> My performance</button>}
        {showTeam && <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Users size={15} /> My team{toGive.filter((r) => r.status === 'MANAGER_REVIEW').length ? ` (${toGive.filter((r) => r.status === 'MANAGER_REVIEW').length} to review)` : ''}</button>}
        {(isHr || cycles.length > 0) && <button className={tab === 'cycles' ? 'active' : ''} onClick={() => setTab('cycles')}><ClipboardList size={15} /> Review cycles</button>}
      </nav>

      {tab === 'mine' && me.employee && (
        <>
          <section className="card">
            {current ? (
              <>
                <div className="section-head">
                  <div>
                    <h2 style={{ marginBottom: '0.2rem' }}>{current.cycle.name}</h2>
                    <p className="muted small" style={{ margin: 0 }}>Covers {day(current.cycle.periodStart)} to {day(current.cycle.periodEnd)} · self review due {day(current.cycle.selfDueOn)} · manager review due {day(current.cycle.managerDueOn)}</p>
                  </div>
                  <StatusBadge status={current.status} />
                </div>
                {current.status === 'SELF_REVIEW' ? (
                  <ReviewForm busy={busy} cta="Send self review" onSubmit={(rating, comments) => run(() => api(`/performance/reviews/${current.id}/self`, { method: 'POST', body: { rating, comments } }), 'Self review sent to your manager.')} />
                ) : (
                  <div className="grid-2" style={{ marginTop: '1rem', marginBottom: 0 }}>
                    <div className="quote" style={{ margin: 0 }}>
                      <strong>Your self review: {current.selfRating} · {RATING_LABEL[current.selfRating ?? 0]}</strong>
                      <p className="small" style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>{current.selfComments}</p>
                    </div>
                    <div className="quote" style={{ margin: 0, borderLeftColor: current.status === 'COMPLETED' ? 'var(--success)' : 'var(--border-strong)', background: current.status === 'COMPLETED' ? 'var(--success-soft)' : 'var(--surface-2)' }}>
                      {current.status === 'COMPLETED' ? (
                        <>
                          <strong>Final rating: {current.managerRating} · {RATING_LABEL[current.managerRating ?? 0]}</strong>
                          <p className="small" style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>{current.managerComments}</p>
                        </>
                      ) : (
                        <span className="muted">Waiting for {current.reviewer ? `${current.reviewer.firstName} ${current.reviewer.lastName}` : 'HR'} to add their review.</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Empty icon={ClipboardList} title="No review cycle is open">HR opens review cycles twice a year. Keep your goals up to date in the meantime.</Empty>
            )}
          </section>

          <Goals editable />

          {past.filter((r) => r.id !== current?.id).length > 0 && (
            <section className="card">
              <h2>Past reviews</h2>
              <ul className="plain">
                {past.filter((r) => r.id !== current?.id).map((r) => (
                  <li key={r.id}>
                    <strong style={{ fontWeight: 550 }}>{r.cycle.name}</strong>
                    <StatusBadge status={r.status} />
                    {r.managerRating && <span className="muted">Final rating {r.managerRating} · {RATING_LABEL[r.managerRating]}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {tab === 'team' && (
        <>
          {toGive.length > 0 && (
            <div className="card table-wrap">
              <div className="card-head"><h2>Reviews you give</h2></div>
              <table>
                <thead><tr><th>Employee</th><th>Cycle</th><th>Status</th><th>Self rating</th><th /></tr></thead>
                <tbody>
                  {toGive.map((r) => (
                    <ReviewRow key={r.id} r={r} busy={busy} onSubmit={(rating, comments) => run(() => api(`/performance/reviews/${r.id}/manager`, { method: 'POST', body: { rating, comments } }), `Review for ${r.employee.firstName} completed.`)} onGoals={() => setTeamPerson(r.employee.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {team.length > 0 && (
            <div className="toolbar bare">
              <div className="segmented" role="group" aria-label="Team member">
                {team.map((p) => (
                  <button key={p.id} type="button" className={teamPerson === p.id ? 'active' : ''} onClick={() => setTeamPerson(p.id)}>{p.firstName} {p.lastName}</button>
                ))}
              </div>
            </div>
          )}
          {teamPerson ? <Goals key={teamPerson} employeeId={teamPerson} editable /> : team.length > 0 && <p className="muted">Pick someone to see and set their goals.</p>}
        </>
      )}

      {tab === 'cycles' && (
        <>
          {isHr && showNew && (
            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api('/performance/cycles', { method: 'POST', body: newCycle }), `${newCycle.name} is open. Everyone in the company with a portal login was emailed.`).then((ok) => ok && setShowNew(false));
              }}
            >
              <h2>Open a review cycle</h2>
              <p className="muted">Creates a review for everyone in the company who has a portal login, with their current manager as reviewer, and emails them.</p>
              <div className="form-grid">
                <label>Name<input required minLength={3} value={newCycle.name} onChange={(e) => setNewCycle({ ...newCycle, name: e.target.value })} placeholder="2026 year-end review" /></label>
                <label>
                  Company
                  <select required value={newCycle.companyId} onChange={(e) => setNewCycle({ ...newCycle, companyId: e.target.value })}>
                    <option value="">Choose…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>Period from<input type="date" required value={newCycle.periodStart} onChange={(e) => setNewCycle({ ...newCycle, periodStart: e.target.value })} /></label>
                <label>Period to<input type="date" required value={newCycle.periodEnd} onChange={(e) => setNewCycle({ ...newCycle, periodEnd: e.target.value })} /></label>
                <label>Self reviews due<input type="date" required value={newCycle.selfDueOn} onChange={(e) => setNewCycle({ ...newCycle, selfDueOn: e.target.value })} /></label>
                <label>Manager reviews due<input type="date" required value={newCycle.managerDueOn} onChange={(e) => setNewCycle({ ...newCycle, managerDueOn: e.target.value })} /></label>
              </div>
              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" disabled={busy}>Open cycle</button>
              </div>
            </form>
          )}
          {cycles.length === 0 && <div className="card"><Empty icon={ClipboardList} title="No review cycles yet">{isHr ? 'Open the first cycle above.' : 'HR has not opened a review cycle yet.'}</Empty></div>}
          {cycles.map((c) => {
            const pct = c.progress.total ? Math.round((c.progress.completed / c.progress.total) * 100) : 0;
            const maxRating = Math.max(1, ...c.ratings.map((r) => r.count));
            return (
              <section className="card" key={c.id}>
                <div className="section-head">
                  <div>
                    <h2 style={{ marginBottom: '0.2rem' }}>{c.name} <StatusBadge status={c.status === 'OPEN' ? 'IN_PROGRESS' : 'CLOSED'} label={c.status === 'OPEN' ? 'Open' : 'Closed'} /></h2>
                    <p className="muted small" style={{ margin: 0 }}>{c.company.name} · {day(c.periodStart)} to {day(c.periodEnd)} · self reviews due {day(c.selfDueOn)}, manager reviews {day(c.managerDueOn)}</p>
                  </div>
                  <div className="actions">
                    {(isHr || me.role === 'MANAGER') && <button className="secondary small" onClick={() => setOpenCycle(openCycle === c.id ? '' : c.id)}>{openCycle === c.id ? 'Hide reviews' : 'See reviews'}</button>}
                    {isHr && c.status === 'OPEN' && <button className="secondary danger small" disabled={busy} onClick={() => window.confirm(`Close ${c.name}? Reviews can no longer be sent.`) && run(() => api(`/performance/cycles/${c.id}/close`, { method: 'POST' }), `${c.name} closed.`)}>Close cycle</button>}
                  </div>
                </div>
                <div className="grid-2" style={{ margin: '1rem 0 0' }}>
                  <div>
                    <div className="track-label" style={{ marginBottom: '0.4rem' }}><span>{c.progress.completed} of {c.progress.total} complete</span><b>{pct}%</b></div>
                    <div className="progress teal"><span style={{ width: `${pct}%` }} /></div>
                    <div className="stack-legend">
                      <span><i style={{ background: 'var(--c3)' }} />Self review <b>{c.progress.selfReview}</b></span>
                      <span><i style={{ background: 'var(--c1)' }} />Manager review <b>{c.progress.managerReview}</b></span>
                      <span><i style={{ background: 'var(--success)' }} />Complete <b>{c.progress.completed}</b></span>
                    </div>
                  </div>
                  <div>
                    <div className="muted small" style={{ marginBottom: '0.4rem' }}>Final ratings</div>
                    <div className="colchart" style={{ height: 80 }}>
                      {c.ratings.map((r) => (
                        <div className="col" key={r.rating} title={`${r.label}: ${r.count}`}>
                          <div className="col-bars"><span className="col-bar" style={{ height: `${(r.count / maxRating) * 100}%`, maxWidth: 28, background: 'var(--c4)' }} /></div>
                          <span className="col-label">{r.rating}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {openCycle === c.id && (
                  <div className="table-wrap" style={{ marginTop: '1rem' }}>
                    {!cycleReviews ? <div className="loading"><span className="spinner" /></div> : (
                      <table>
                        <thead><tr><th>Employee</th><th>Reviewer</th><th>Status</th><th>Self</th><th>Final</th><th /></tr></thead>
                        <tbody>
                          {cycleReviews.map((r) => (
                            <tr key={r.id}>
                              <td><Person p={r.employee} /></td>
                              <td>{r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}` : <span className="muted">HR</span>}</td>
                              <td><StatusBadge status={r.status} /></td>
                              <td className="tnum">{r.selfRating ?? ''}</td>
                              <td className="tnum">{r.managerRating ? <b>{r.managerRating}</b> : ''}</td>
                              <td className="actions">{(isHr || r.reviewer?.id === me.employee?.id) && <Link className="small" href={`/performance?employeeId=${r.employee.id}`}>Goals</Link>}</td>
                            </tr>
                          ))}
                          {cycleReviews.length === 0 && <tr><td colSpan={6} className="empty">No reviews in this cycle.</td></tr>}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {isHr && <p className="muted small">HR completes reviews for people without a manager. Nobody can complete their own manager review.</p>}
        </>
      )}
    </>
  );
}

function ReviewRow({ r, busy, onSubmit, onGoals }: { r: Review; busy: boolean; onSubmit: (rating: number, comments: string) => void; onGoals: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td><Person p={r.employee} /></td>
        <td>{r.cycle.name}</td>
        <td><StatusBadge status={r.status} /></td>
        <td>{r.selfRating ? `${r.selfRating} · ${RATING_LABEL[r.selfRating]}` : <span className="muted">Not sent yet</span>}</td>
        <td className="actions">
          <button className="ghost small" onClick={onGoals}>Goals</button>
          {r.status === 'MANAGER_REVIEW' && <button className="small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Review'}</button>}
        </td>
      </tr>
      {open && r.status === 'MANAGER_REVIEW' && (
        <tr>
          <td colSpan={5} style={{ whiteSpace: 'normal', background: 'var(--surface-2)' }}>
            <div className="quote" style={{ marginTop: 0 }}>
              <strong>{r.employee.firstName}&apos;s self review: {r.selfRating} · {RATING_LABEL[r.selfRating ?? 0]}</strong>
              <p className="small" style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>{r.selfComments}</p>
            </div>
            <ReviewForm busy={busy} cta="Complete review" onSubmit={onSubmit} />
          </td>
        </tr>
      )}
    </>
  );
}
