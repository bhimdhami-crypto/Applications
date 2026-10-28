'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Briefcase, Plus, Users } from 'lucide-react';
import { Empty, Kpi, PageHeader, StatusBadge } from '@/components/ui';
import { PersonSearch } from '@/components/PersonSearch';
import { api, Company, EMPLOYMENT_TYPE_LABEL, JobOpening, LOCATION_LABEL, money, OpeningStatus, STAGE_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';

const EMPTY = {
  companyId: '',
  title: '',
  department: '',
  workLocation: 'ON_SITE',
  employmentType: 'PERMANENT',
  grade: '',
  city: '',
  positions: '1',
  salaryMin: '',
  salaryMax: '',
  closesOn: '',
  description: '',
};

const PIPE: Array<keyof NonNullable<JobOpening['pipeline']>> = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const PIPE_COLOR = ['var(--c7)', 'var(--c4)', 'var(--c1)', 'var(--c6)', 'var(--c5)'];

export default function RecruitmentPage() {
  const { can } = useSession();
  const router = useRouter();
  const isHr = can('HR');
  const [openings, setOpenings] = useState<JobOpening[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [status, setStatus] = useState<OpeningStatus | ''>('OPEN');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [manager, setManager] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setOpenings(null);
    api<JobOpening[]>(`/recruitment/openings${status ? `?status=${status}` : ''}`).then(setOpenings).catch((e) => setError(e.message));
  }, [status]);
  useEffect(() => {
    if (isHr) api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.payrollRules))).catch(() => setCompanies([]));
  }, [isHr]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const o = await api<JobOpening>('/recruitment/openings', {
        method: 'POST',
        body: {
          companyId: form.companyId,
          title: form.title,
          department: form.department,
          workLocation: form.workLocation,
          employmentType: form.employmentType,
          grade: form.grade || undefined,
          city: form.city || undefined,
          positions: Number(form.positions) || 1,
          salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined,
          salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined,
          closesOn: form.closesOn || undefined,
          description: form.description || undefined,
          hiringManagerId: manager?.id,
        },
      });
      router.push(`/recruitment/${o.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const all = openings ?? [];
  const active = all.reduce((s, o) => s + (o.pipeline ? o.pipeline.APPLIED + o.pipeline.SCREENING + o.pipeline.INTERVIEW + o.pipeline.OFFER : 0), 0);
  const offers = all.reduce((s, o) => s + (o.pipeline?.OFFER ?? 0), 0);
  const hired = all.reduce((s, o) => s + (o.pipeline?.HIRED ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Recruitment"
        sub={isHr ? 'Job openings and the candidate pipeline for every company. Hiring a candidate creates their employee record and portal login.' : 'Openings you are hiring for. Move candidates through the pipeline and score interviews; HR makes the offer and hires.'}
        actions={isHr && (
          <button className={showForm ? 'secondary' : ''} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : <><Plus size={16} /> New opening</>}
          </button>
        )}
      />
      {error && <div className="notice error">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={create}>
          <div className="card-head" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
            <div>
              <h2>New job opening</h2>
              <p className="sub">The pay range is visible to HR and the hiring manager only.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Company
              <select required value={form.companyId} onChange={(e) => { set('companyId')(e); setManager(null); }}>
                <option value="">Choose…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Job title<input required minLength={2} value={form.title} onChange={set('title')} /></label>
            <label>Department<input required value={form.department} onChange={set('department')} /></label>
            <label>
              Work location
              <select value={form.workLocation} onChange={set('workLocation')}>
                {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              Contract
              <select value={form.employmentType} onChange={set('employmentType')}>
                {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Grade<input value={form.grade} onChange={set('grade')} placeholder="e.g. G5" /></label>
            <label>City<input value={form.city} onChange={set('city')} /></label>
            <label>Positions<input type="number" min={1} max={200} value={form.positions} onChange={set('positions')} /></label>
            <label>Monthly pay from<input type="number" min={0} step="0.01" value={form.salaryMin} onChange={set('salaryMin')} /></label>
            <label>Monthly pay to<input type="number" min={0} step="0.01" value={form.salaryMax} onChange={set('salaryMax')} /></label>
            <label>Applications close<input type="date" value={form.closesOn} onChange={set('closesOn')} /></label>
            <label>
              Hiring manager
              <PersonSearch companyId={form.companyId} value={manager} onChange={setManager} />
            </label>
          </div>
          <label>About the role<textarea rows={3} value={form.description} onChange={set('description')} /></label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit"><Briefcase size={16} /> Create opening</button>
          </div>
        </form>
      )}

      <div className="grid">
        <Kpi icon={Briefcase} label={status ? `${status === 'OPEN' ? 'Open' : status === 'ON_HOLD' ? 'On hold' : status === 'FILLED' ? 'Filled' : 'Closed'} openings` : 'All openings'} value={all.length} note={`${all.reduce((s, o) => s + o.positions, 0)} positions`} />
        <Kpi icon={Users} tone="violet" label="Candidates in progress" value={active} note={`${offers} with an offer`} />
        <Kpi icon={Users} tone="teal" label="Hired" value={hired} note="From these openings" />
      </div>

      <div className="toolbar bare">
        <div className="segmented" role="group" aria-label="Status">
          {(['OPEN', 'ON_HOLD', 'FILLED', 'CLOSED', ''] as const).map((s) => (
            <button key={s || 'all'} type="button" className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {s === '' ? 'All' : s === 'ON_HOLD' ? 'On hold' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Opening</th>
              <th>Company</th>
              <th>Hiring manager</th>
              <th>Pipeline</th>
              <th className="num">Candidates</th>
              <th>Closes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!openings && <tr><td colSpan={7} className="loading"><span className="spinner" /></td></tr>}
            {all.map((o) => {
              const total = Math.max(1, PIPE.reduce((s, k) => s + (o.pipeline?.[k] ?? 0), 0));
              return (
                <tr key={o.id}>
                  <td>
                    <Link href={`/recruitment/${o.id}`}>{o.title}</Link>
                    <span className="muted small" style={{ display: 'block' }}>{o.reference} · {o.department} · {o.positions} position{o.positions === 1 ? '' : 's'}</span>
                  </td>
                  <td>
                    <span className="person">
                      <span className="cc">{o.company.countryCode}</span>
                      <span>{o.city ?? ''}<span className="sub">{LOCATION_LABEL[o.workLocation]}{o.salaryMin && o.salaryMax ? ` · ${money(o.salaryMin, o.company.currency).replace(/\.00$/, '')}–${money(o.salaryMax, o.company.currency).replace(/\.00$/, '')}` : ''}</span></span>
                    </span>
                  </td>
                  <td>{o.hiringManager ? `${o.hiringManager.firstName} ${o.hiringManager.lastName}` : <span className="muted">HR</span>}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="stack" title={PIPE.map((k) => `${STAGE_LABEL[k]} ${o.pipeline?.[k] ?? 0}`).join(', ')}>
                      {PIPE.map((k, i) => (o.pipeline?.[k] ?? 0) > 0 && <span key={k} style={{ width: `${((o.pipeline?.[k] ?? 0) / total) * 100}%`, background: PIPE_COLOR[i] }} />)}
                    </div>
                  </td>
                  <td className="num">{o.candidates ?? 0}</td>
                  <td>{o.closesOn ? new Date(o.closesOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : <span className="muted">Open-ended</span>}</td>
                  <td><StatusBadge status={o.status} /></td>
                </tr>
              );
            })}
            {openings && all.length === 0 && (
              <tr><td colSpan={7}><Empty icon={Briefcase} title="No openings here">{isHr ? 'Create an opening to start recruiting.' : 'Openings where you are the hiring manager appear here.'}</Empty></td></tr>
            )}
          </tbody>
        </table>
        <div className="legend" style={{ padding: '0 0 0.25rem' }}>
          {PIPE.map((k, i) => <span key={k}><i style={{ background: PIPE_COLOR[i] }} /> {STAGE_LABEL[k]}</span>)}
        </div>
      </div>
    </>
  );
}
