'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { api, Company, Employee, LOCATION_LABEL, money, Page, Role, ROLE_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  jobTitle: '',
  department: '',
  workLocation: 'ON_SITE',
  hireDate: new Date().toISOString().slice(0, 10),
  monthlyBasic: '',
  monthlyAllowances: '',
  companyId: '',
  managerId: '',
  role: 'EMPLOYEE',
};

type Row = Employee & { hasPhoto: boolean };
const PAGE_SIZE = 25;

export default function EmployeesPage() {
  const { me, can } = useSession();
  const [data, setData] = useState<Page<Row> | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [includeLeavers, setIncludeLeavers] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = me.role === 'ADMIN';
  const canAdd = can('HR');
  const isManager = me.role === 'MANAGER';

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), includeLeavers: String(includeLeavers) });
    if (search) params.set('q', search);
    if (companyId) params.set('companyId', companyId);
    api<Page<Row>>(`/employees?${params}`).then(setData).catch((e) => setError(e.message));
  }, [page, includeLeavers, search, companyId]);

  useEffect(load, [load]);
  useEffect(() => {
    if (isManager) return;
    api<Company[]>('/companies').then(setCompanies).catch(() => setCompanies([]));
  }, [isManager]);
  useEffect(() => {
    if (!showForm) return;
    const params = new URLSearchParams({ role: 'MANAGER', pageSize: '200' });
    if (form.companyId) params.set('companyId', form.companyId);
    api<Page<Employee>>(`/employees?${params}`).then((p) => setManagers(p.items)).catch(() => setManagers([]));
  }, [showForm, form.companyId]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(q.trim());
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const created = await api<Employee>('/employees', {
        method: 'POST',
        body: {
          ...form,
          monthlyBasic: Number(form.monthlyBasic),
          monthlyAllowances: form.monthlyAllowances ? Number(form.monthlyAllowances) : undefined,
          managerId: form.managerId || undefined,
        },
      });
      setNotice(`${created.firstName} ${created.lastName} was added as ${created.employeeNo}. A welcome email with a temporary password was sent.`);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(emp: Employee) {
    const reason = window.prompt(`Delete ${emp.firstName} ${emp.lastName}? Their login stops at once and records are kept for the legal retention period.\n\nReason:`);
    if (reason === null) return;
    setError('');
    try {
      await api(`/employees/${emp.id}`, { method: 'DELETE', body: reason ? { reason } : {} });
      setNotice(`${emp.firstName} ${emp.lastName} was removed and their login was switched off.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const roles: Role[] = isAdmin ? ['EMPLOYEE', 'MANAGER', 'HR', 'PAYROLL', 'FINANCE', 'ADMIN'] : ['EMPLOYEE', 'MANAGER'];
  const employees = data?.items ?? [];
  const showPay = employees[0]?.monthlyBasic !== undefined;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>{isManager ? 'My team' : 'Employees'}</h1>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <form className="toolbar" onSubmit={submitSearch}>
        <label>
          Search
          <input placeholder="Name, number, email or job" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {!isManager && (
          <label>
            Company
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button type="submit">Search</button>
        <div className="checks" style={{ paddingBottom: '0.6rem' }}>
          <label>
            <input type="checkbox" checked={includeLeavers} onChange={(e) => { setIncludeLeavers(e.target.checked); setPage(1); }} />
            Show leavers
          </label>
        </div>
        {canAdd && <button type="button" className="secondary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add employee'}</button>}
      </form>

      {showForm && (
        <form className="card" onSubmit={add}>
          <div className="form-grid">
            <label>First name<input required value={form.firstName} onChange={set('firstName')} /></label>
            <label>Last name<input required value={form.lastName} onChange={set('lastName')} /></label>
            <label>Work email<input type="email" required value={form.email} onChange={set('email')} /></label>
            <label>Job title<input required value={form.jobTitle} onChange={set('jobTitle')} /></label>
            <label>Department<input required value={form.department} onChange={set('department')} /></label>
            <label>
              Company
              <select required value={form.companyId} onChange={set('companyId')}>
                <option value="">Choose…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              Work location
              <select value={form.workLocation} onChange={set('workLocation')}>
                {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Start date<input type="date" required value={form.hireDate} onChange={set('hireDate')} /></label>
            <label>Monthly basic pay<input type="number" min="0" step="0.01" required value={form.monthlyBasic} onChange={set('monthlyBasic')} /></label>
            <label>Monthly allowances<input type="number" min="0" step="0.01" value={form.monthlyAllowances} onChange={set('monthlyAllowances')} /></label>
            <label>
              Manager
              <select value={form.managerId} onChange={set('managerId')}>
                <option value="">None</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
              </select>
            </label>
            <label>
              Portal role
              <select value={form.role} onChange={set('role')}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
          </div>
          <button type="submit">Add employee</button>
        </form>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>No.</th>
              <th>Job title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Status</th>
              {showPay && <th className="num">Basic pay</th>}
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="person">
                    <Avatar employeeId={e.id} name={`${e.firstName} ${e.lastName}`} hasPhoto={e.hasPhoto} size={32} />
                    <Link href={`/employees/${e.id}`}>{e.firstName} {e.lastName}</Link>
                  </span>
                </td>
                <td>{e.employeeNo}</td>
                <td>{e.jobTitle}</td>
                <td>{e.company.name}</td>
                <td>{LOCATION_LABEL[e.workLocation]}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                {showPay && <td className="num">{money(e.monthlyBasic, e.company.currency)}</td>}
                {isAdmin && (
                  <td>
                    {e.status === 'ACTIVE' && e.user?.email !== me.email && (
                      <button className="danger small" onClick={() => remove(e)}>Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {data && employees.length === 0 && (
              <tr><td colSpan={8} className="muted">No employees match.</td></tr>
            )}
          </tbody>
        </table>
        {data && (
          <div className="pager">
            <span className="muted">{data.total.toLocaleString('en-GB')} people · page {data.page} of {pages}</span>
            <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
