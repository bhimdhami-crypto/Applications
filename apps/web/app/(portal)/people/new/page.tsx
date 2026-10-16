'use client';

import { COUNTRIES } from '@gpp/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ErrorAlert, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { EmployeeProfile, EntityDetail } from '@/lib/types';

/** Adds a new employee: person, employment, first job record and, with access to pay, first pay */
export default function Hire() {
  const router = useRouter();
  const { me, can, entityId } = useSession();
  const companies = me.entities.filter((e) => can('people.manage', e.id));
  const [f, setF] = useState({
    legalEntityId: entityId && companies.some((c) => c.id === entityId) ? entityId : (companies[0]?.id ?? ''),
    firstName: '',
    lastName: '',
    localName: '',
    gender: '',
    dateOfBirth: '',
    nationality: '',
    personalEmail: '',
    mobilePhone: '',
    workEmail: '',
    employmentType: 'PERMANENT',
    workLocation: 'ON_SITE',
    hireDate: new Date().toISOString().slice(0, 10),
    jobTitle: '',
    gradeCode: 'G2',
    departmentId: '',
    branchId: '',
    managerNumber: '',
    baseAmount: '',
    allowances: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const org = useLoad(() => (f.legalEntityId ? api<EntityDetail>(`/org/entities/${f.legalEntityId}`) : Promise.resolve(null)), [f.legalEntityId]);
  const grades = useLoad(() => api<{ code: string; name: string }[]>('/job-grades'), []);
  const company = me.entities.find((e) => e.id === f.legalEntityId);
  const canPay = can('people.sensitive.read', f.legalEntityId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let managerId: string | undefined;
      if (f.managerNumber.trim()) {
        const found = await api<{ items: { id: string; employeeNumber: string }[] }>(`/employees?q=${encodeURIComponent(f.managerNumber.trim())}&pageSize=5`);
        const m = found.items.find((x) => x.employeeNumber.toLowerCase() === f.managerNumber.trim().toLowerCase());
        if (!m) throw new Error(`No active employee with number ${f.managerNumber}`);
        managerId = m.id;
      }
      const { managerNumber, ...rest } = f;
      const body = Object.fromEntries(Object.entries({ ...rest, managerId }).filter(([, v]) => v !== '' && v !== undefined));
      if (!canPay) delete body.baseAmount;
      const created = await api<EmployeeProfile>('/employees', { method: 'POST', body });
      router.push(`/people/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!companies.length) return <ErrorAlert error="You cannot add employees to any company." />;
  return (
    <>
      <PageHead title="Hire someone" crumbs={<Link href="/people">Staff directory</Link>} sub="The employee number is given automatically. Use fictional details only: this is a demo." />
      <form onSubmit={submit}>
        <section className="card">
          <h2>Company and job</h2>
          <div className="row">
            <label className="field">
              <span>Company</span>
              <select value={f.legalEntityId} onChange={(e) => setF({ ...f, legalEntityId: e.target.value, departmentId: '', branchId: '' })}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.countryCode} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Start date</span>
              <input type="date" required value={f.hireDate} onChange={set('hireDate')} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 220 }}>
              <span>Job title</span>
              <input required value={f.jobTitle} onChange={set('jobTitle')} />
            </label>
            <label className="field">
              <span>Grade</span>
              <select value={f.gradeCode} onChange={set('gradeCode')}>
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
                {org.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Office</span>
              <select value={f.branchId} onChange={set('branchId')}>
                <option value="">—</option>
                {org.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Manager (employee number)</span>
              <input value={f.managerNumber} onChange={set('managerNumber')} placeholder={`MSA-${company?.countryCode ?? 'KE'}-000001`} />
            </label>
            <label className="field">
              <span>Contract</span>
              <select value={f.employmentType} onChange={set('employmentType')}>
                <option value="PERMANENT">Permanent</option>
                <option value="FIXED_TERM">Fixed-term contract</option>
                <option value="INTERN">Intern</option>
              </select>
            </label>
            <label className="field">
              <span>Works</span>
              <select value={f.workLocation} onChange={set('workLocation')}>
                <option value="ON_SITE">On site</option>
                <option value="HYBRID">Hybrid</option>
                <option value="FULLY_REMOTE">Fully remote</option>
              </select>
            </label>
            <label className="field">
              <span>Work email</span>
              <input type="email" value={f.workEmail} onChange={set('workEmail')} placeholder="name@mindspace.test" />
            </label>
          </div>
        </section>
        <section className="card">
          <h2>Person</h2>
          <div className="row">
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
              <span>Gender</span>
              <select value={f.gender} onChange={set('gender')}>
                <option value="">Not given</option>
                {['Female', 'Male', 'Non-binary', 'Not stated'].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date of birth</span>
              <input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
            </label>
            <label className="field">
              <span>Nationality</span>
              <select value={f.nationality} onChange={set('nationality')}>
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Mobile</span>
              <input type="tel" value={f.mobilePhone} onChange={set('mobilePhone')} />
            </label>
            <label className="field">
              <span>Personal email</span>
              <input type="email" value={f.personalEmail} onChange={set('personalEmail')} />
            </label>
          </div>
        </section>
        {canPay && (
          <section className="card">
            <h2>Pay</h2>
            <div className="row">
              <label className="field">
                <span>Monthly base ({company?.functionalCurrency})</span>
                <input inputMode="decimal" pattern="\d+(\.\d{1,4})?" value={f.baseAmount} onChange={set('baseAmount')} />
              </label>
              <label className="field">
                <span>Monthly allowances</span>
                <input inputMode="decimal" pattern="\d+(\.\d{1,4})?" value={f.allowances} onChange={set('allowances')} />
              </label>
            </div>
          </section>
        )}
        <ErrorAlert error={error} />
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="btn" disabled={busy}>
            Add employee
          </button>
          <Link className="btn secondary" href="/people">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
