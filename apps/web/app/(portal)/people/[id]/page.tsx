'use client';

import { COUNTRIES, formatMoney } from '@gpp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, ReactNode, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { RequestStatus } from '@/components/RequestStatus';
import { Empty, ErrorAlert, fmtDate, Loading, useLoad } from '@/components/ui';
import { api, apiBlob, apiUpload } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { ChangeRequest, EmployeeDocument, EmployeeProfile, EntityDetail, Job, PayInfo, PersonContact } from '@/lib/types';

type Tab = 'overview' | 'personal' | 'history' | 'pay' | 'documents';

const LABEL: Record<string, string> = {
  PERMANENT: 'Permanent',
  FIXED_TERM: 'Fixed-term contract',
  INTERN: 'Intern',
  ON_SITE: 'On site',
  HYBRID: 'Hybrid',
  FULLY_REMOTE: 'Fully remote',
  HIRE: 'Hired',
  PROMOTION: 'Promotion',
  TRANSFER: 'Transfer',
  CHANGE: 'Change',
  CORRECTION: 'Correction',
  ANNUAL_REVIEW: 'Annual review',
  MARKET_ADJUSTMENT: 'Market adjustment',
  NATIONAL_ID: 'National ID',
  PASSPORT: 'Passport',
  TAX_ID: 'Tax number',
  SOCIAL_SECURITY: 'Social security number',
  WORK_PERMIT: 'Work permit',
};
const label = (v: string | null | undefined) => (v ? (LABEL[v] ?? v) : '—');
const countryName = (code: string | null | undefined) => (code ? (COUNTRIES.find((c) => c.code === code)?.name ?? code) : '—');

/** Runs an action and keeps its error next to the form that started it */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  const { lang } = usePrefs();
  const [tab, setTab] = useState<Tab>('overview');
  const [photoVersion, setPhotoVersion] = useState(0);
  const p = useLoad(() => api<EmployeeProfile>(`/employees/${id}`), [id]);

  if (p.error) return <ErrorAlert error={p.error} />;
  if (!p.data) return <Loading />;
  const d = p.data;
  const name = `${d.person.firstName} ${d.person.lastName}`;
  const tabs: [Tab, string][] = [
    ['overview', 'Job'],
    ...(d.can.viewPersonal ? ([['personal', 'Personal details']] as [Tab, string][]) : []),
    ...(d.can.viewPersonal ? ([['history', 'History']] as [Tab, string][]) : []),
    ...(d.can.viewPay ? ([['pay', 'Pay and bank']] as [Tab, string][]) : []),
    ...(d.can.viewDocuments ? ([['documents', 'Documents']] as [Tab, string][]) : []),
  ];

  return (
    <>
      <div className="crumbs">
        {d.relation === 'SELF' ? 'My profile' : d.relation === 'MANAGER' ? <Link href="/team">My team</Link> : <Link href="/people">Staff directory</Link>}
      </div>
      <div className="profile-head">
        <Avatar employmentId={d.id} name={name} size={72} version={photoVersion} />
        <div>
          <h1>
            {name}
            {d.person.preferredName && <span className="muted"> ({d.person.preferredName})</span>}
          </h1>
          {d.person.localName && (
            <div className="local" dir="auto" lang={d.entity.countryCode === 'EG' ? 'ar' : undefined}>
              {d.person.localName}
            </div>
          )}
          <div className="muted">
            {d.job?.jobTitle ?? 'No job record'} · {d.entity.name}
          </div>
          <div className="chips" style={{ marginTop: '.35rem' }}>
            <span className="badge mono">{d.employeeNumber}</span>
            {d.status === 'ACTIVE' ? <span className="badge ok">Active</span> : <span className="badge">Left {fmtDate(d.endDate, lang)}</span>}
            {d.status === 'ACTIVE' && d.endDate && <span className="badge warn">Leaving {fmtDate(d.endDate, lang)}</span>}
            {d.relation === 'SELF' && <span className="badge">This is you</span>}
          </div>
        </div>
      </div>
      {d.can.editPersonal && <PhotoControls id={d.id} hasPhoto={d.person.hasPhoto} onChange={() => (setPhotoVersion((v) => v + 1), p.reload())} />}

      <div className="tabs" role="tablist" style={{ marginTop: '1rem' }}>
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview d={d} onChange={p.reload} />}
      {tab === 'personal' && d.personal && <Personal d={d} onChange={p.reload} />}
      {tab === 'history' && <History d={d} onChange={p.reload} />}
      {tab === 'pay' && <Pay d={d} />}
      {tab === 'documents' && <Documents d={d} />}
    </>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function PhotoControls({ id, hasPhoto, onChange }: { id: string; hasPhoto: boolean; onChange: () => void }) {
  const a = useAction();
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    if (await a.run(() => apiUpload(`/employees/${id}/photo`, form, 'PUT'))) onChange();
  };
  return (
    <div className="row">
      <label className="btn secondary small">
        {hasPhoto ? 'Change photo' : 'Add a photo'}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {hasPhoto && (
        <button className="btn secondary small" disabled={a.busy} onClick={async () => (await a.run(() => api(`/employees/${id}/photo`, { method: 'DELETE' }))) && onChange()}>
          Remove photo
        </button>
      )}
      <ErrorAlert error={a.error} />
    </div>
  );
}

// ───── Job ─────

function Overview({ d, onChange }: { d: EmployeeProfile; onChange: () => void }) {
  const { lang } = usePrefs();
  const j = d.job;
  return (
    <div className="grid">
      <section className="card">
        <h2>Current job</h2>
        {!j ? (
          <Empty>No job record yet.</Empty>
        ) : (
          <Facts
            items={[
              ['Job title', j.jobTitle],
              ['Grade', j.grade ? `${j.grade.code} · ${j.grade.name}` : '—'],
              ['Department', j.department?.name],
              ['Business unit', j.businessUnit?.name],
              ['Office', j.branch ? `${j.branch.name}, ${j.branch.city}` : '—'],
              ['Cost centre', j.costCentre ? <span className="mono">{j.costCentre.code}</span> : '—'],
              ['Reports to', j.manager ? <Link href={`/people/${j.manager.id}`}>{j.manager.name}</Link> : '—'],
              ['Direct reports', d.directReports],
              ['Since', fmtDate(j.effectiveFrom, lang)],
            ]}
          />
        )}
      </section>
      <section className="card">
        <h2>Employment</h2>
        <Facts
          items={[
            ['Company', d.entity.name],
            ['Employee number', <span className="mono">{d.employeeNumber}</span>],
            ['Work email', d.workEmail ? <span className="mono">{d.workEmail}</span> : '—'],
            ['Contract', label(d.employmentType)],
            ['Works', label(d.workLocation)],
            ['Hired', fmtDate(d.hireDate, lang)],
            ...(d.probationEndDate ? ([['Probation ends', fmtDate(d.probationEndDate, lang)]] as [string, ReactNode][]) : []),
            ...(d.endDate ? ([['Leaving date', fmtDate(d.endDate, lang)]] as [string, ReactNode][]) : []),
            ...(d.exitReason ? ([['Reason for leaving', d.exitReason]] as [string, ReactNode][]) : []),
            ['Portal account', d.hasAccount ? 'Yes' : 'No'],
          ]}
        />
      </section>
      {d.can.terminate && <Terminate d={d} onChange={onChange} />}
    </div>
  );
}

function Terminate({ d, onChange }: { d: EmployeeProfile; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ endDate: '', exitReason: '' });
  const [note, setNote] = useState<string | null>(null);
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let reports = 0;
    const ok = await a.run(async () => {
      reports = (await api<{ reportsNeedingManager: number }>(`/employees/${d.id}/terminate`, { method: 'POST', body: form })).reportsNeedingManager;
    });
    if (ok) {
      setNote(reports ? `${reports} people report to ${d.person.firstName}. Give them a new manager from their History tab.` : null);
      setOpen(false);
      onChange();
    }
  };
  return (
    <section className="card">
      <h2>Leaving</h2>
      {note && <div className="alert">{note}</div>}
      {!open ? (
        <button className="btn secondary" onClick={() => setOpen(true)}>
          Record that {d.person.firstName} is leaving
        </button>
      ) : (
        <form onSubmit={submit} className="row">
          <label className="field">
            <span>Last day</span>
            <input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            <span>Reason</span>
            <input required minLength={3} value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} placeholder="For example: Resignation - relocation" />
          </label>
          <button className="btn danger" disabled={a.busy}>
            Confirm
          </button>
          <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      <ErrorAlert error={a.error} />
    </section>
  );
}

// ───── Personal ─────

function Personal({ d, onChange }: { d: EmployeeProfile; onChange: () => void }) {
  const { lang } = usePrefs();
  const p = d.personal!;
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>About</h2>
          {d.can.editPersonal && !editing && (
            <button className="btn secondary small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <PersonalForm
            d={d}
            onDone={(changed) => {
              setEditing(false);
              if (changed) onChange();
            }}
          />
        ) : (
          <Facts
            items={[
              ['Mobile', p.mobilePhone],
              ['Personal email', p.personalEmail],
              ['Date of birth', fmtDate(p.dateOfBirth, lang)],
              ['Gender', p.gender],
              ['Nationality', countryName(p.nationality)],
              ['Marital status', p.maritalStatus],
              ['Dependants', p.dependants],
              ['Highest qualification', p.highestQualification],
              ['Institution', p.institution],
              ['Year', p.qualificationYear],
              ['Person number', <span className="mono">{d.person.personNumber}</span>],
            ]}
          />
        )}
      </section>
      <Contacts d={d} contacts={p.contacts} onChange={onChange} />
    </div>
  );
}

function PersonalForm({ d, onDone }: { d: EmployeeProfile; onDone: (changed: boolean) => void }) {
  const p = d.personal!;
  const [f, setF] = useState({
    preferredName: d.person.preferredName ?? '',
    mobilePhone: p.mobilePhone ?? '',
    personalEmail: p.personalEmail ?? '',
    maritalStatus: p.maritalStatus ?? '',
    dependants: String(p.dependants),
    highestQualification: p.highestQualification ?? '',
    institution: p.institution ?? '',
    qualificationYear: p.qualificationYear ? String(p.qualificationYear) : '',
    firstName: d.person.firstName,
    lastName: d.person.lastName,
    localName: d.person.localName ?? '',
    dateOfBirth: p.dateOfBirth?.slice(0, 10) ?? '',
  });
  const a = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      preferredName: f.preferredName || undefined,
      mobilePhone: f.mobilePhone || undefined,
      personalEmail: f.personalEmail || undefined,
      maritalStatus: f.maritalStatus || undefined,
      dependants: Number(f.dependants),
      highestQualification: f.highestQualification || undefined,
      institution: f.institution || undefined,
      qualificationYear: f.qualificationYear ? Number(f.qualificationYear) : undefined,
    };
    if (d.can.editNames) Object.assign(body, { firstName: f.firstName, lastName: f.lastName, localName: f.localName || undefined, dateOfBirth: f.dateOfBirth || undefined });
    if (await a.run(() => api(`/employees/${d.id}/personal`, { method: 'PATCH', body }))) onDone(true);
  };
  return (
    <form onSubmit={submit}>
      <div className="row">
        {d.can.editNames && (
          <>
            <label className="field">
              <span>First name</span>
              <input required value={f.firstName} onChange={set('firstName')} />
            </label>
            <label className="field">
              <span>Last name</span>
              <input required value={f.lastName} onChange={set('lastName')} />
            </label>
            <label className="field">
              <span>Name in local script</span>
              <input dir="auto" value={f.localName} onChange={set('localName')} />
            </label>
            <label className="field">
              <span>Date of birth</span>
              <input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
            </label>
          </>
        )}
        <label className="field">
          <span>Preferred name</span>
          <input value={f.preferredName} onChange={set('preferredName')} />
        </label>
        <label className="field">
          <span>Mobile</span>
          <input type="tel" value={f.mobilePhone} onChange={set('mobilePhone')} />
        </label>
        <label className="field">
          <span>Personal email</span>
          <input type="email" value={f.personalEmail} onChange={set('personalEmail')} />
        </label>
        <label className="field">
          <span>Marital status</span>
          <select value={f.maritalStatus} onChange={set('maritalStatus')}>
            <option value="">Not given</option>
            {['Single', 'Married', 'Civil partnership', 'Divorced', 'Widowed', 'Not stated'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Dependants</span>
          <input type="number" min={0} max={30} value={f.dependants} onChange={set('dependants')} style={{ width: 90 }} />
        </label>
        <label className="field">
          <span>Highest qualification</span>
          <input value={f.highestQualification} onChange={set('highestQualification')} />
        </label>
        <label className="field">
          <span>Institution</span>
          <input value={f.institution} onChange={set('institution')} />
        </label>
        <label className="field">
          <span>Year</span>
          <input type="number" min={1950} max={2100} value={f.qualificationYear} onChange={set('qualificationYear')} style={{ width: 100 }} />
        </label>
      </div>
      {!d.can.editNames && <p className="muted">To change your name, date of birth or nationality, ask HR: they check the documents first.</p>}
      <ErrorAlert error={a.error} />
      <div className="row">
        <button className="btn" disabled={a.busy}>
          Save
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Contacts({ d, contacts, onChange }: { d: EmployeeProfile; contacts: PersonContact[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(contacts.map(({ id, ...c }) => ({ ...c, email: c.email ?? '' })));
  const a = useAction();
  const blank = { name: '', relationship: '', phone: '', email: '', isEmergencyContact: true, isBeneficiary: false };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { contacts: rows.map((r) => ({ ...r, email: r.email || undefined })) };
    if (await a.run(() => api(`/employees/${d.id}/contacts`, { method: 'PUT', body }))) {
      setEditing(false);
      onChange();
    }
  };
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Next of kin and emergency contacts</h2>
        {d.can.editPersonal && !editing && (
          <button className="btn secondary small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        contacts.length === 0 ? (
          <Empty>No contacts on file.</Empty>
        ) : (
          <ul style={{ paddingInlineStart: '1.1rem', margin: 0 }}>
            {contacts.map((c) => (
              <li key={c.id} style={{ marginBottom: '.5rem' }}>
                <strong>{c.name}</strong> · {c.relationship}
                <div className="muted">
                  {c.phone}
                  {c.email && ` · ${c.email}`}
                </div>
                <div className="chips">
                  {c.isEmergencyContact && <span className="badge">Emergency contact</span>}
                  {c.isBeneficiary && <span className="badge">Beneficiary</span>}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form onSubmit={save}>
          {rows.map((r, i) => {
            const set = (patch: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <fieldset key={i} className="row" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.5rem', marginBottom: '.5rem' }}>
                <label className="field">
                  <span>Name</span>
                  <input required value={r.name} onChange={(e) => set({ name: e.target.value })} />
                </label>
                <label className="field">
                  <span>Relationship</span>
                  <input required value={r.relationship} onChange={(e) => set({ relationship: e.target.value })} />
                </label>
                <label className="field">
                  <span>Phone</span>
                  <input required type="tel" minLength={4} value={r.phone} onChange={(e) => set({ phone: e.target.value })} />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={r.email} onChange={(e) => set({ email: e.target.value })} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={r.isEmergencyContact} onChange={(e) => set({ isEmergencyContact: e.target.checked })} /> Emergency contact
                </label>
                <label className="check">
                  <input type="checkbox" checked={r.isBeneficiary} onChange={(e) => set({ isBeneficiary: e.target.checked })} /> Beneficiary
                </label>
                <button type="button" className="btn secondary small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </fieldset>
            );
          })}
          <ErrorAlert error={a.error} />
          <div className="row">
            {rows.length < 5 && (
              <button type="button" className="btn secondary" onClick={() => setRows([...rows, blank])}>
                Add a contact
              </button>
            )}
            <button className="btn" disabled={a.busy}>
              Save
            </button>
            <button type="button" className="btn secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ───── History ─────

function History({ d, onChange }: { d: EmployeeProfile; onChange: () => void }) {
  const { lang } = usePrefs();
  const h = useLoad(() => api<{ assignments: Job[] }>(`/employees/${d.id}/history`), [d.id]);
  const [adding, setAdding] = useState(false);
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Job history</h2>
        {d.can.editJob && d.status === 'ACTIVE' && !adding && (
          <button className="btn small" onClick={() => setAdding(true)}>
            Record a change
          </button>
        )}
      </div>
      <p className="muted">Each change starts a new record from its date. Earlier records are kept as they were, never overwritten.</p>
      {adding && (
        <JobChangeForm
          d={d}
          onDone={(changed) => {
            setAdding(false);
            if (changed) {
              h.reload();
              onChange();
            }
          }}
        />
      )}
      <ErrorAlert error={h.error} />
      {!h.data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Change</th>
                <th>Job</th>
                <th>Grade</th>
                <th>Department</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {h.data.assignments.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.effectiveFrom, lang)}</td>
                  <td className="muted">{a.effectiveTo ? fmtDate(a.effectiveTo, lang) : 'Current'}</td>
                  <td>{label(a.reason)}</td>
                  <td>{a.jobTitle}</td>
                  <td>{a.grade?.code ?? '—'}</td>
                  <td>{a.department?.name ?? '—'}</td>
                  <td>{a.manager?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function JobChangeForm({ d, onDone }: { d: EmployeeProfile; onDone: (changed: boolean) => void }) {
  const org = useLoad(() => api<EntityDetail>(`/org/entities/${d.entity.id}`), [d.entity.id]);
  const grades = useLoad(() => api<{ code: string; name: string }[]>('/job-grades'), []);
  const [f, setF] = useState({ effectiveFrom: '', reason: 'PROMOTION', jobTitle: d.job?.jobTitle ?? '', gradeCode: d.job?.grade?.code ?? '', departmentId: d.job?.department?.id ?? '', branchId: d.job?.branch?.id ?? '', managerNumber: '' });
  const a = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await a.run(async () => {
      let managerId: string | undefined;
      if (f.managerNumber.trim()) {
        const found = await api<{ items: { id: string; employeeNumber: string }[] }>(`/employees?q=${encodeURIComponent(f.managerNumber.trim())}&pageSize=5`);
        const m = found.items.find((x) => x.employeeNumber.toLowerCase() === f.managerNumber.trim().toLowerCase());
        if (!m) throw new Error(`No active employee with number ${f.managerNumber}`);
        managerId = m.id;
      }
      const body = {
        effectiveFrom: f.effectiveFrom,
        reason: f.reason,
        jobTitle: f.jobTitle !== d.job?.jobTitle ? f.jobTitle : undefined,
        gradeCode: f.gradeCode && f.gradeCode !== d.job?.grade?.code ? f.gradeCode : undefined,
        departmentId: f.departmentId && f.departmentId !== d.job?.department?.id ? f.departmentId : undefined,
        branchId: f.branchId && f.branchId !== d.job?.branch?.id ? f.branchId : undefined,
        managerId,
      };
      await api(`/employees/${d.id}/assignments`, { method: 'POST', body });
      onDone(true);
    });
  };
  return (
    <form onSubmit={submit} className="card" style={{ background: 'var(--surface-alt)' }}>
      <div className="row">
        <label className="field">
          <span>Starts on</span>
          <input type="date" required value={f.effectiveFrom} onChange={set('effectiveFrom')} />
        </label>
        <label className="field">
          <span>Kind of change</span>
          <select value={f.reason} onChange={set('reason')}>
            {['PROMOTION', 'TRANSFER', 'CHANGE', 'CORRECTION'].map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Job title</span>
          <input required value={f.jobTitle} onChange={set('jobTitle')} />
        </label>
        <label className="field">
          <span>Grade</span>
          <select value={f.gradeCode} onChange={set('gradeCode')}>
            <option value="">—</option>
            {grades.data?.map((g) => (
              <option key={g.code} value={g.code}>
                {g.code} · {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Department</span>
          <select value={f.departmentId} onChange={set('departmentId')}>
            <option value="">—</option>
            {org.data?.departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Office</span>
          <select value={f.branchId} onChange={set('branchId')}>
            <option value="">—</option>
            {org.data?.branches.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>New manager (employee number)</span>
          <input value={f.managerNumber} onChange={set('managerNumber')} placeholder={d.job?.manager?.employeeNumber ?? 'MSA-KE-000001'} />
          <small>Leave empty to keep {d.job?.manager?.name ?? 'no manager'}</small>
        </label>
      </div>
      <ErrorAlert error={a.error} />
      <div className="row">
        <button className="btn" disabled={a.busy}>
          Save change
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ───── Pay and bank ─────

function Pay({ d }: { d: EmployeeProfile }) {
  const { lang } = usePrefs();
  const pay = useLoad(() => api<PayInfo>(`/employees/${d.id}/pay`), [d.id]);
  const requests = useLoad(() => (d.relation === 'SELF' || d.relation === 'HR' ? api<ChangeRequest[]>(`/employees/${d.id}/change-requests`) : Promise.resolve([])), [d.id]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [bankForm, setBankForm] = useState(false);
  const a = useAction();
  const reveal = (kind: 'identifiers' | 'bank-accounts', itemId: string) =>
    a.run(async () => {
      const r = await api<{ value: string }>(`/employees/${d.id}/${kind}/${itemId}/reveal`, { method: 'POST' });
      setRevealed((x) => ({ ...x, [itemId]: r.value }));
    });

  if (pay.error) return <ErrorAlert error={pay.error} />;
  if (!pay.data) return <Loading />;
  const current = pay.data.compensation.find((c) => !c.effectiveTo || new Date(c.effectiveTo) > new Date()) ?? pay.data.compensation[0];
  return (
    <div className="grid">
      <ErrorAlert error={a.error} />
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Pay</h2>
          {d.can.editPay && d.status === 'ACTIVE' && !adding && (
            <button className="btn small" onClick={() => setAdding(true)}>
              Change pay
            </button>
          )}
        </div>
        {adding && (
          <PayChangeForm
            d={d}
            onDone={(changed) => {
              setAdding(false);
              if (changed) pay.reload();
            }}
          />
        )}
        {current ? (
          <Facts
            items={[
              ['Monthly base pay', formatMoney(current.baseAmount, current.currency, lang)],
              ['Monthly allowances', formatMoney(current.allowances, current.currency, lang)],
              ['Since', fmtDate(current.effectiveFrom, lang)],
            ]}
          />
        ) : (
          <Empty>No pay on record.</Empty>
        )}
        {pay.data.compensation.length > 0 && (
          <div className="table-wrap" style={{ marginTop: '.75rem' }}>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th style={{ textAlign: 'end' }}>Base</th>
                  <th style={{ textAlign: 'end' }}>Allowances</th>
                </tr>
              </thead>
              <tbody>
                {pay.data.compensation.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.effectiveFrom, lang)}</td>
                    <td className="muted">{c.effectiveTo ? fmtDate(c.effectiveTo, lang) : 'Current'}</td>
                    <td>{label(c.reason)}</td>
                    <td style={{ textAlign: 'end' }}>{formatMoney(c.baseAmount, c.currency, lang)}</td>
                    <td style={{ textAlign: 'end' }}>{formatMoney(c.allowances, c.currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: '.5rem' }}>
          Demo pay figures are illustrative, not market data.
        </p>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Bank account</h2>
          {d.can.requestBankChange && d.status === 'ACTIVE' && !bankForm && (
            <button className="btn secondary small" onClick={() => setBankForm(true)}>
              Change bank details
            </button>
          )}
        </div>
        {bankForm && (
          <BankChangeForm
            d={d}
            onDone={(sent) => {
              setBankForm(false);
              if (sent) requests.reload();
            }}
          />
        )}
        {pay.data.bankAccounts.length === 0 ? (
          <Empty>No bank account on file.</Empty>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {pay.data.bankAccounts.map((b) => (
              <li key={b.id} style={{ marginBottom: '.6rem', opacity: b.effectiveTo ? 0.65 : 1 }}>
                <strong>{b.bankName}</strong> {b.effectiveTo ? <span className="badge">Ended {fmtDate(b.effectiveTo, lang)}</span> : <span className="badge ok">Current</span>}
                <div>
                  {b.accountName} · <span className="mono">{revealed[b.id] ?? b.accountNumber}</span>
                  {d.can.revealSensitive && !revealed[b.id] && (
                    <button className="btn secondary small" style={{ marginInlineStart: '.5rem' }} onClick={() => reveal('bank-accounts', b.id)}>
                      Show
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {requests.data && requests.data.length > 0 && (
          <>
            <h3>Requested changes</h3>
            <ul style={{ paddingInlineStart: '1.1rem' }}>
              {requests.data.map((r) => (
                <li key={r.id}>
                  {r.summary} · <RequestStatus r={r} />
                  {r.decisionNote && <span className="muted"> · {r.decisionNote}</span>}
                  {r.status === 'PENDING' && d.relation === 'SELF' && (
                    <button className="btn secondary small" style={{ marginInlineStart: '.5rem' }} onClick={async () => (await a.run(() => api(`/change-requests/${r.id}/cancel`, { method: 'POST' }))) && requests.reload()}>
                      Cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>Identity and tax numbers</h2>
        <p className="muted">Shown masked. Showing a full number is recorded in the audit log.</p>
        {pay.data.identifiers.length === 0 ? (
          <Empty>None on file.</Empty>
        ) : (
          <Facts
            items={pay.data.identifiers.map((i) => [
              `${label(i.kind)} (${i.countryCode})`,
              <>
                <span className="mono">{revealed[i.id] ?? i.value}</span>
                {i.expiryDate && <span className="muted"> · expires {fmtDate(i.expiryDate, lang)}</span>}
                {d.can.revealSensitive && !revealed[i.id] && (
                  <button className="btn secondary small" style={{ marginInlineStart: '.5rem' }} onClick={() => reveal('identifiers', i.id)}>
                    Show
                  </button>
                )}
              </>,
            ])}
          />
        )}
      </section>
    </div>
  );
}

function PayChangeForm({ d, onDone }: { d: EmployeeProfile; onDone: (changed: boolean) => void }) {
  const [f, setF] = useState({ effectiveFrom: '', baseAmount: '', allowances: '', reason: 'ANNUAL_REVIEW' });
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => api(`/employees/${d.id}/compensation`, { method: 'POST', body: { ...f, allowances: f.allowances || undefined } }))) onDone(true);
  };
  return (
    <form onSubmit={submit} className="card" style={{ background: 'var(--surface-alt)' }}>
      <div className="row">
        <label className="field">
          <span>Starts on</span>
          <input type="date" required value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
        </label>
        <label className="field">
          <span>Monthly base ({d.entity.functionalCurrency})</span>
          <input required inputMode="decimal" pattern="\d+(\.\d{1,4})?" value={f.baseAmount} onChange={(e) => setF({ ...f, baseAmount: e.target.value })} />
        </label>
        <label className="field">
          <span>Monthly allowances</span>
          <input inputMode="decimal" pattern="\d+(\.\d{1,4})?" value={f.allowances} onChange={(e) => setF({ ...f, allowances: e.target.value })} placeholder="Unchanged" />
        </label>
        <label className="field">
          <span>Reason</span>
          <select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {['ANNUAL_REVIEW', 'PROMOTION', 'MARKET_ADJUSTMENT', 'CHANGE', 'CORRECTION'].map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorAlert error={a.error} />
      <div className="row">
        <button className="btn" disabled={a.busy}>
          Save
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BankChangeForm({ d, onDone }: { d: EmployeeProfile; onDone: (sent: boolean) => void }) {
  const [f, setF] = useState({ bankName: '', branchCode: '', accountName: `${d.person.firstName} ${d.person.lastName}`, accountNumber: '' });
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => api(`/employees/${d.id}/bank-change`, { method: 'POST', body: { ...f, branchCode: f.branchCode || undefined } }))) onDone(true);
  };
  return (
    <form onSubmit={submit} className="card" style={{ background: 'var(--surface-alt)' }}>
      <p className="muted">HR checks every change before it is used for pay. Use test account numbers only: this is a demo.</p>
      <div className="row">
        <label className="field">
          <span>Bank</span>
          <input required value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
        </label>
        <label className="field">
          <span>Branch code</span>
          <input value={f.branchCode} onChange={(e) => setF({ ...f, branchCode: e.target.value })} />
        </label>
        <label className="field">
          <span>Account name</span>
          <input required value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
        </label>
        <label className="field">
          <span>Account number or IBAN</span>
          <input required autoComplete="off" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </label>
      </div>
      <ErrorAlert error={a.error} />
      <div className="row">
        <button className="btn" disabled={a.busy}>
          Send to HR
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ───── Documents ─────

const DOC_BADGE: Record<EmployeeDocument['status'], string> = { PENDING: 'warn', VERIFIED: 'ok', CLEARED: 'ok', EXPIRED: 'bad', REJECTED: 'bad' };

function Documents({ d }: { d: EmployeeProfile }) {
  const { lang } = usePrefs();
  const docs = useLoad(() => api<EmployeeDocument[]>(`/employees/${d.id}/documents`), [d.id]);
  const types = useLoad(() => api<string[]>('/document-types'), []);
  const [form, setForm] = useState({ type: '', expiryDate: '', hrOnly: false });
  const [file, setFile] = useState<File | null>(null);
  const a = useAction();
  const hr = d.can.verifyDocuments && d.relation !== 'SELF';

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.append('type', form.type);
    if (form.expiryDate) body.append('expiryDate', form.expiryDate);
    if (form.hrOnly) body.append('hrOnly', 'true');
    body.append('file', file);
    if (await a.run(() => apiUpload(`/employees/${d.id}/documents`, body))) {
      setFile(null);
      setForm({ type: '', expiryDate: '', hrOnly: false });
      (e.target as HTMLFormElement).reset();
      docs.reload();
    }
  };
  const download = (doc: EmployeeDocument) =>
    a.run(async () => {
      const blob = await apiBlob(`/documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const setStatus = (doc: EmployeeDocument, status: EmployeeDocument['status']) => a.run(() => api(`/documents/${doc.id}`, { method: 'PATCH', body: { status } })).then((ok) => {
      if (ok) docs.reload();
    });
  const remove = (doc: EmployeeDocument) => {
    if (!window.confirm(`Delete ${doc.type} (${doc.fileName})? This cannot be undone.`)) return;
    a.run(() => api(`/documents/${doc.id}`, { method: 'DELETE' })).then((ok) => {
      if (ok) docs.reload();
    });
  };

  return (
    <section className="card">
      <h2>Documents</h2>
      {d.can.uploadDocuments && (
        <form onSubmit={upload} className="row" style={{ marginBottom: '1rem' }}>
          <label className="field">
            <span>Type</span>
            <select required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="">Choose…</option>
              {types.data?.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Expires</span>
            <input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          </label>
          <label className="field">
            <span>File (PDF or image, up to 10 MB)</span>
            <input type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {hr && (
            <label className="check">
              <input type="checkbox" checked={form.hrOnly} onChange={(e) => setForm({ ...form, hrOnly: e.target.checked })} /> HR only (hidden from the employee)
            </label>
          )}
          <button className="btn" disabled={a.busy || !file}>
            Upload
          </button>
        </form>
      )}
      <ErrorAlert error={a.error || docs.error} />
      {!docs.data ? (
        <Loading />
      ) : docs.data.length === 0 ? (
        <Empty>No documents on file.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Dated</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.data.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    {doc.type}
                    {doc.hrOnly && <span className="badge" style={{ marginInlineStart: '.4rem' }}>HR only</span>}
                    <div className="muted mono" style={{ fontSize: '.8rem' }}>
                      {doc.fileName}
                    </div>
                  </td>
                  <td className="muted">{fmtDate(doc.issuedDate ?? doc.createdAt, lang)}</td>
                  <td className="muted">{fmtDate(doc.expiryDate, lang)}</td>
                  <td>
                    <span className={`badge ${DOC_BADGE[doc.status]}`}>{doc.status.charAt(0) + doc.status.slice(1).toLowerCase()}</span>
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {doc.hasFile ? (
                        <button className="btn secondary small" onClick={() => download(doc)}>
                          Download
                        </button>
                      ) : (
                        <span className="muted" title="Only the paper copy is held">
                          Paper copy
                        </span>
                      )}
                      {hr && doc.status === 'PENDING' && (
                        <>
                          <button className="btn small" onClick={() => setStatus(doc, 'VERIFIED')}>
                            Verify
                          </button>
                          <button className="btn secondary small" onClick={() => setStatus(doc, 'REJECTED')}>
                            Reject
                          </button>
                        </>
                      )}
                      {hr && (
                        <button className="btn danger small" onClick={() => remove(doc)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
