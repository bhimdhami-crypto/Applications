'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, CalendarDays, Camera, FileText, Network, Target, Upload, UserRound, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Empty, StatusBadge } from '@/components/ui';
import {
  api,
  downloadFile,
  DocumentStatus,
  EMPLOYMENT_TYPE_LABEL,
  formatDate,
  HrDocument,
  LOCATION_LABEL,
  money,
  NextOfKin,
  Profile,
  ROLE_LABEL,
} from '@/lib/api';

type Section = 'job' | 'personal' | 'kin' | null;
type Tab = 'overview' | 'kin' | 'documents';

const BLANK_KIN: NextOfKin = { name: '', relationship: '', phone: '', email: '', isEmergencyContact: true, isBeneficiary: false };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? <span className="muted">Not recorded</span> : value}</dd>
    </div>
  );
}

const sizeLabel = (bytes: number | null) =>
  bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState<Section>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [form, setForm] = useState<Record<string, string>>({});
  const [kin, setKin] = useState<NextOfKin[]>([]);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [upload, setUpload] = useState({ type: '', issuedDate: '', expiryDate: '', hrOnly: false });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(() => {
    api<HrDocument[]>(`/employees/${id}/documents`).then(setDocs).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    api<Profile>(`/employees/${id}/profile`)
      .then((profile) => {
        setP(profile);
        if (profile.can.viewDocuments) loadDocs();
        if (profile.can.uploadDocuments) api<string[]>('/document-types').then(setDocTypes).catch(() => setDocTypes([]));
      })
      .catch((e) => setError(e.message));
  }, [id, loadDocs]);

  function run(action: () => Promise<void>, done: string) {
    setError('');
    setNotice('');
    action()
      .then(() => setNotice(done))
      .catch((e) => setError(e.message));
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  function startEdit(section: Section) {
    if (!p) return;
    setEditing(section);
    if (section === 'job') {
      setForm({
        jobTitle: p.jobTitle,
        department: p.department,
        grade: p.grade ?? '',
        employmentType: p.employmentType,
        workLocation: p.workLocation,
        city: p.city ?? '',
        monthlyBasic: p.monthlyBasic ?? '',
        monthlyAllowances: p.monthlyAllowances ?? '',
      });
    } else if (section === 'personal') {
      setForm({
        mobilePhone: p.mobilePhone ?? '',
        personalEmail: p.personalEmail ?? '',
        maritalStatus: p.maritalStatus ?? '',
        dependants: String(p.dependants ?? 0),
        gender: p.gender ?? '',
        dateOfBirth: p.dateOfBirth?.slice(0, 10) ?? '',
        nationalIdNumber: p.nationalIdNumber ?? '',
        taxId: p.taxId ?? '',
        socialSecurityNo: p.socialSecurityNo ?? '',
        highestQualification: p.highestQualification ?? '',
        institution: p.institution ?? '',
        qualificationYear: p.qualificationYear ? String(p.qualificationYear) : '',
      });
    } else if (section === 'kin') {
      setKin(p.nextOfKin?.length ? p.nextOfKin.map((k) => ({ ...k, email: k.email ?? '' })) : [{ ...BLANK_KIN }]);
    }
  }

  /** Only sends fields that changed and are filled in, so blank optional fields never fail validation. */
  function changed(keys: string[], original: Record<string, unknown>) {
    const out: Record<string, string | number> = {};
    for (const k of keys) {
      const v = form[k]?.trim() ?? '';
      if (v === '' || v === String(original[k] ?? '').slice(0, k === 'dateOfBirth' ? 10 : undefined)) continue;
      out[k] = ['monthlyBasic', 'monthlyAllowances', 'dependants', 'qualificationYear'].includes(k) ? Number(v) : v;
    }
    return out;
  }

  async function saveJob(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    const body = changed(['jobTitle', 'department', 'grade', 'employmentType', 'workLocation', 'city', 'monthlyBasic', 'monthlyAllowances'], p as unknown as Record<string, unknown>);
    run(async () => {
      if (Object.keys(body).length) await api(`/employees/${id}`, { method: 'PATCH', body });
      setP(await api<Profile>(`/employees/${id}/profile`));
      setEditing(null);
    }, 'Job details saved.');
  }

  async function savePersonal(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    const original = p as unknown as Record<string, unknown>;
    const own = changed(['mobilePhone', 'personalEmail', 'maritalStatus', 'dependants'], original);
    const hr = p.can.editJob
      ? changed(['gender', 'dateOfBirth', 'nationalIdNumber', 'taxId', 'socialSecurityNo', 'highestQualification', 'institution', 'qualificationYear'], original)
      : {};
    run(async () => {
      if (Object.keys(own).length) await api(`/employees/${id}/personal`, { method: 'PATCH', body: own });
      if (Object.keys(hr).length) await api(`/employees/${id}`, { method: 'PATCH', body: hr });
      setP(await api<Profile>(`/employees/${id}/profile`));
      setEditing(null);
    }, 'Personal details saved.');
  }

  async function saveKin(e: FormEvent) {
    e.preventDefault();
    const contacts = kin.map((k) => ({
      name: k.name.trim(),
      relationship: k.relationship.trim(),
      phone: k.phone.trim(),
      email: k.email?.trim() || undefined,
      isEmergencyContact: k.isEmergencyContact,
      isBeneficiary: k.isBeneficiary,
    }));
    run(async () => {
      const saved = await api<NextOfKin[]>(`/employees/${id}/next-of-kin`, { method: 'PUT', body: { contacts } });
      setP((prev) => (prev ? { ...prev, nextOfKin: saved } : prev));
      setEditing(null);
    }, 'Next of kin saved.');
  }

  const setKinField = (i: number, key: keyof NextOfKin, value: string | boolean) =>
    setKin(kin.map((k, j) => (j === i ? { ...k, [key]: value } : k)));

  function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    run(async () => {
      await api(`/employees/${id}/photo`, { method: 'PUT', body });
      setP((prev) => (prev ? { ...prev, hasPhoto: true } : prev));
      setPhotoVersion((v) => v + 1);
    }, 'Profile photo updated.');
  }

  function uploadDocument(e: FormEvent) {
    e.preventDefault();
    const file = docInput.current?.files?.[0];
    if (!file) return setError('Choose a file to upload');
    const body = new FormData();
    body.append('file', file);
    body.append('type', upload.type);
    if (upload.issuedDate) body.append('issuedDate', upload.issuedDate);
    if (upload.expiryDate) body.append('expiryDate', upload.expiryDate);
    if (upload.hrOnly) body.append('hrOnly', 'true');
    run(async () => {
      await api(`/employees/${id}/documents`, { method: 'POST', body });
      setUpload({ type: '', issuedDate: '', expiryDate: '', hrOnly: false });
      if (docInput.current) docInput.current.value = '';
      loadDocs();
    }, p?.can.verifyDocuments ? 'Document uploaded and marked verified.' : 'Document uploaded. HR will check it.');
  }

  function setStatus(doc: HrDocument, status: DocumentStatus) {
    run(async () => {
      await api(`/documents/${doc.id}`, { method: 'PATCH', body: { status } });
      loadDocs();
    }, `${doc.type} marked ${status.toLowerCase()}.`);
  }

  function removeDoc(doc: HrDocument) {
    if (!window.confirm(`Delete "${doc.fileName}"? This cannot be undone.`)) return;
    run(async () => {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      loadDocs();
    }, 'Document deleted.');
  }

  if (!p) return error ? <div className="notice error">{error}</div> : <div className="loading"><span className="spinner" /> Loading profile…</div>;

  const name = `${p.firstName} ${p.lastName}`;
  const isSelf = p.access === 'SELF';
  const personal = p.access !== 'MANAGER';

  return (
    <>
      {!isSelf && (
        <Link className="back-link" href="/employees" style={{ display: 'inline-flex', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--text-3)' }}>
          ← {p.access === 'MANAGER' ? 'My team' : 'Employees'}
        </Link>
      )}
      <div className="card profile-hero">
        <div className="cover" />
        <div className="profile-head">
          <Avatar employeeId={p.id} name={name} hasPhoto={p.hasPhoto} size={96} version={photoVersion} />
          <div>
            <h1>{name}</h1>
            <div style={{ color: 'var(--text-2)' }}>{p.jobTitle} · {p.department}</div>
            <div className="actions" style={{ marginTop: '0.5rem', gap: '0.4rem' }}>
              <StatusBadge status={p.status} label={p.status === 'ACTIVE' ? 'Active' : 'Left'} />
              <span className="tag">{p.employeeNo}</span>
              <span className="tag"><span className="cc" style={{ width: 22, height: 16, fontSize: '0.6rem', borderRadius: 3 }}>{p.company.countryCode}</span>{p.company.name}</span>
              {p.grade && <span className="tag">Grade {p.grade}</span>}
            </div>
          </div>
          <div className="actions">
            <Link className="button secondary" href={isSelf ? '/leave' : `/leave?employeeId=${p.id}`}><CalendarDays size={16} /> Leave</Link>
            <Link className="button secondary" href={`/organisation?employeeId=${p.id}`}><Network size={16} /> Reporting line</Link>
            {(isSelf || p.access === 'MANAGER' || p.can.editJob) && (
              <Link className="button secondary" href={isSelf ? '/performance' : `/performance?employeeId=${p.id}`}><Target size={16} /> Goals</Link>
            )}
            {p.can.editPersonal && (
              <>
                <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={uploadPhoto} />
                <button className="secondary" onClick={() => photoInput.current?.click()}>
                  <Camera size={16} /> {p.hasPhoto ? 'Change photo' : 'Add photo'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {personal && (
        <nav className="tabs" aria-label="Profile sections">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><UserRound size={15} /> Overview</button>
          <button className={tab === 'kin' ? 'active' : ''} onClick={() => setTab('kin')}><Users size={15} /> Next of kin ({p.nextOfKin?.length ?? 0})</button>
          {p.can.viewDocuments && (
            <button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}><FileText size={15} /> Documents ({docs.length})</button>
          )}
        </nav>
      )}

      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {tab === 'overview' && <section className="card">
        <div className="section-head">
          <h2><span className="actions" style={{ gap: '0.5rem' }}><Briefcase size={18} className="muted" /> Job</span></h2>
          {p.can.editJob && editing !== 'job' && <button className="secondary small" onClick={() => startEdit('job')}>Edit</button>}
        </div>
        {editing === 'job' ? (
          <form onSubmit={saveJob}>
            <div className="form-grid">
              <label>Job title<input required value={form.jobTitle} onChange={set('jobTitle')} /></label>
              <label>Department<input required value={form.department} onChange={set('department')} /></label>
              <label>Grade<input value={form.grade} onChange={set('grade')} /></label>
              <label>
                Contract
                <select value={form.employmentType} onChange={set('employmentType')}>
                  {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>
                Work location
                <select value={form.workLocation} onChange={set('workLocation')}>
                  {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>City<input value={form.city} onChange={set('city')} /></label>
              {p.monthlyBasic !== undefined && (
                <>
                  <label>Monthly basic pay<input type="number" min="0" step="0.01" value={form.monthlyBasic} onChange={set('monthlyBasic')} /></label>
                  <label>Monthly allowances<input type="number" min="0" step="0.01" value={form.monthlyAllowances} onChange={set('monthlyAllowances')} /></label>
                </>
              )}
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit">Save changes</button>
            </div>
          </form>
        ) : (
          <dl className="fields">
            <Field label="Company" value={p.company.name} />
            <Field label="Grade" value={p.grade} />
            <Field label="Contract" value={EMPLOYMENT_TYPE_LABEL[p.employmentType]} />
            <Field label="Work location" value={`${LOCATION_LABEL[p.workLocation]}${p.city ? `, ${p.city}` : ''}`} />
            <Field label="Start date" value={formatDate(p.hireDate)} />
            {p.exitDate && <Field label="Leaving date" value={`${formatDate(p.exitDate)}${p.exitReason ? ` (${p.exitReason})` : ''}`} />}
            <Field label="Manager" value={p.manager && <Link href={`/employees/${p.manager.id}`}>{p.manager.firstName} {p.manager.lastName}</Link>} />
            <Field label="Work email" value={p.workEmail} />
            <Field label="Portal access" value={p.user ? `${ROLE_LABEL[p.user.role]}${p.user.isActive ? '' : ' (switched off)'}` : 'No login yet'} />
            {p.monthlyBasic !== undefined && <Field label="Monthly basic pay" value={money(p.monthlyBasic, p.company.currency)} />}
            {p.monthlyAllowances !== undefined && <Field label="Monthly allowances" value={money(p.monthlyAllowances, p.company.currency)} />}
          </dl>
        )}
      </section>}

      {personal && tab === 'overview' && (
        <section className="card">
          <div className="section-head">
            <h2><span className="actions" style={{ gap: '0.5rem' }}><UserRound size={18} className="muted" /> Personal details and IDs</span></h2>
            {p.can.editPersonal && editing !== 'personal' && <button className="secondary small" onClick={() => startEdit('personal')}>Edit</button>}
          </div>
          {editing === 'personal' ? (
            <form onSubmit={savePersonal}>
              <div className="form-grid">
                <label>Mobile phone<input value={form.mobilePhone} onChange={set('mobilePhone')} /></label>
                <label>Personal email<input type="email" value={form.personalEmail} onChange={set('personalEmail')} /></label>
                <label>
                  Marital status
                  <select value={form.maritalStatus} onChange={set('maritalStatus')}>
                    <option value="">Not recorded</option>
                    {['Single', 'Married', 'Divorced', 'Widowed'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label>Dependants<input type="number" min="0" max="30" value={form.dependants} onChange={set('dependants')} /></label>
                {p.can.editJob && (
                  <>
                    <label>
                      Gender
                      <select value={form.gender} onChange={set('gender')}>
                        <option value="">Not recorded</option>
                        {['Female', 'Male', 'Other'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                    <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></label>
                    <label>National ID number<input value={form.nationalIdNumber} onChange={set('nationalIdNumber')} /></label>
                    <label>Tax ID<input value={form.taxId} onChange={set('taxId')} /></label>
                    <label>Social security number<input value={form.socialSecurityNo} onChange={set('socialSecurityNo')} /></label>
                    <label>Highest qualification<input value={form.highestQualification} onChange={set('highestQualification')} /></label>
                    <label>Institution<input value={form.institution} onChange={set('institution')} /></label>
                    <label>Year completed<input type="number" min="1950" max="2100" value={form.qualificationYear} onChange={set('qualificationYear')} /></label>
                  </>
                )}
              </div>
              {!p.can.editJob && <p className="muted">To correct your ID numbers, date of birth or education, upload the document below and HR will update it.</p>}
              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit">Save changes</button>
              </div>
            </form>
          ) : (
            <dl className="fields">
              <Field label="Mobile phone" value={p.mobilePhone} />
              <Field label="Personal email" value={p.personalEmail} />
              <Field label="Gender" value={p.gender} />
              <Field label="Date of birth" value={formatDate(p.dateOfBirth)} />
              <Field label="Marital status" value={p.maritalStatus} />
              <Field label="Dependants" value={p.dependants} />
              <Field label="National ID number" value={p.nationalIdNumber} />
              <Field label="Tax ID" value={p.taxId} />
              <Field label="Social security number" value={p.socialSecurityNo} />
              <Field label="Highest qualification" value={p.highestQualification} />
              <Field label="Institution" value={p.institution} />
              <Field label="Year completed" value={p.qualificationYear} />
            </dl>
          )}
        </section>
      )}

      {personal && tab === 'kin' && (
        <section className="card">
          <div className="section-head">
            <h2>Next of kin</h2>
            {p.can.editPersonal && editing !== 'kin' && <button className="secondary small" onClick={() => startEdit('kin')}>Edit</button>}
          </div>
          {editing === 'kin' ? (
            <form onSubmit={saveKin}>
              {kin.map((k, i) => (
                <div className="kin" key={i}>
                  <div className="form-grid">
                    <label>Name<input required value={k.name} onChange={(e) => setKinField(i, 'name', e.target.value)} /></label>
                    <label>Relationship<input required value={k.relationship} onChange={(e) => setKinField(i, 'relationship', e.target.value)} /></label>
                    <label>Phone<input required value={k.phone} onChange={(e) => setKinField(i, 'phone', e.target.value)} /></label>
                    <label>Email<input type="email" value={k.email ?? ''} onChange={(e) => setKinField(i, 'email', e.target.value)} /></label>
                  </div>
                  <div className="checks">
                    <label><input type="checkbox" checked={k.isEmergencyContact} onChange={(e) => setKinField(i, 'isEmergencyContact', e.target.checked)} /> Emergency contact</label>
                    <label><input type="checkbox" checked={k.isBeneficiary} onChange={(e) => setKinField(i, 'isBeneficiary', e.target.checked)} /> Beneficiary</label>
                    <button type="button" className="secondary danger small" onClick={() => setKin(kin.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                </div>
              ))}
              {kin.length < 5 && <button type="button" className="secondary small" onClick={() => setKin([...kin, { ...BLANK_KIN }])}>Add another person</button>}
              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit">Save changes</button>
              </div>
            </form>
          ) : p.nextOfKin?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Role</th></tr></thead>
                <tbody>
                  {p.nextOfKin.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>{k.relationship}</td>
                      <td>{k.phone}</td>
                      <td>{k.email}</td>
                      <td>{[k.isEmergencyContact && 'Emergency contact', k.isBeneficiary && 'Beneficiary'].filter(Boolean).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Users} title="No next of kin recorded">{isSelf ? 'Please add someone we can call in an emergency.' : 'Ask the employee to add an emergency contact.'}</Empty>
          )}
        </section>
      )}

      {p.can.viewDocuments && tab === 'documents' && (
        <section className="card">
          <div className="section-head">
            <h2>Documents</h2>
            <span className="muted small">{docs.filter((d) => d.status === 'PENDING').length} waiting for HR · {docs.filter((d) => d.status === 'EXPIRED').length} expired</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Document</th><th>File</th><th>Status</th>{p.can.verifyDocuments && <th />}</tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.type}
                      {d.hrOnly && <span className="badge violet plain" style={{ marginLeft: '0.4rem' }}>HR only</span>}
                      {(d.issuedDate || d.expiryDate) && (
                        <div className="muted small">
                          {[d.issuedDate && `Issued ${formatDate(d.issuedDate)}`, d.expiryDate && `expires ${formatDate(d.expiryDate)}`].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {d.hasFile ? (
                        <button className="link" onClick={() => downloadFile(`/documents/${d.id}/file`, d.fileName).catch((e) => setError(e.message))}>
                          {d.fileName}
                        </button>
                      ) : (
                        <span className="muted" title={`${d.fileName}: recorded in the register, scan not uploaded yet`}>Paper copy only</span>
                      )}
                      {d.sizeBytes !== null && <span className="muted"> · {sizeLabel(d.sizeBytes)}</span>}
                    </td>
                    <td><StatusBadge status={d.status} /></td>
                    {p.can.verifyDocuments && (
                      <td className="actions">
                        <>
                          {(d.status === 'PENDING' || d.status === 'REJECTED') && <button className="secondary small" onClick={() => setStatus(d, 'VERIFIED')}>Verify</button>}{' '}
                          {d.status === 'PENDING' && <button className="secondary small" onClick={() => setStatus(d, 'REJECTED')}>Reject</button>}{' '}
                          <button className="secondary danger small" onClick={() => removeDoc(d)}>Delete</button>
                        </>
                      </td>
                    )}
                  </tr>
                ))}
                {docs.length === 0 && <tr><td colSpan={4}><Empty icon={FileText} title="No documents on file">Upload contracts, IDs and certificates below.</Empty></td></tr>}
              </tbody>
            </table>
          </div>

          {p.can.uploadDocuments && (
            <form onSubmit={uploadDocument} className="inline-form" style={{ marginTop: '1.25rem', display: 'block' }}>
              <h3 className="actions" style={{ gap: '0.5rem' }}><Upload size={16} /> Upload a document</h3>
              <div className="form-grid">
                <label>
                  Document
                  <select required value={upload.type} onChange={(e) => setUpload({ ...upload, type: e.target.value })}>
                    <option value="">Choose…</option>
                    {docTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>File (PDF, PNG, JPEG or WebP, up to 10 MB)<input ref={docInput} type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" /></label>
                <label>Issued on<input type="date" value={upload.issuedDate} onChange={(e) => setUpload({ ...upload, issuedDate: e.target.value })} /></label>
                <label>Expires on<input type="date" value={upload.expiryDate} onChange={(e) => setUpload({ ...upload, expiryDate: e.target.value })} /></label>
              </div>
              {p.can.verifyDocuments && (
                <div className="checks">
                  <label><input type="checkbox" checked={upload.hrOnly} onChange={(e) => setUpload({ ...upload, hrOnly: e.target.checked })} /> Visible to HR only</label>
                </div>
              )}
              <button type="submit" style={{ marginTop: '0.75rem' }}><Upload size={16} /> Upload</button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
