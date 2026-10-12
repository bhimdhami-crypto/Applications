'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, Company, Employee, LOCATION_LABEL, money, Role, ROLE_LABEL } from '@/lib/api';
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

export default function EmployeesPage() {
  const { me, can } = useSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [includeLeavers, setIncludeLeavers] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = me.role === 'ADMIN';
  const canAdd = can('HR');

  const load = useCallback(() => {
    api<Employee[]>(`/employees?includeLeavers=${includeLeavers}`).then(setEmployees).catch((e) => setError(e.message));
  }, [includeLeavers]);

  useEffect(load, [load]);
  useEffect(() => {
    if (canAdd) api<Company[]>('/companies').then(setCompanies).catch(() => setCompanies([]));
  }, [canAdd]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

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

  const managers = employees.filter((e) => e.user?.role === 'MANAGER' && (!form.companyId || e.companyId === form.companyId));
  const roles: Role[] = isAdmin ? ['EMPLOYEE', 'MANAGER', 'HR', 'PAYROLL', 'ADMIN'] : ['EMPLOYEE', 'MANAGER'];

  return (
    <>
      <h1>Employees</h1>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="actions" style={{ marginBottom: '1rem' }}>
        {canAdd && <button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add employee'}</button>}
        <label style={{ margin: 0, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={includeLeavers} onChange={(e) => setIncludeLeavers(e.target.checked)} />
          Show leavers
        </label>
      </div>

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
              <th>No.</th>
              <th>Name</th>
              <th>Email</th>
              <th>Job title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Status</th>
              {employees[0]?.monthlyBasic !== undefined && <th className="num">Basic pay</th>}
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.employeeNo}</td>
                <td>{e.firstName} {e.lastName}</td>
                <td>{e.user?.email}</td>
                <td>{e.jobTitle}</td>
                <td>{e.company.name}</td>
                <td>{LOCATION_LABEL[e.workLocation]}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                {e.monthlyBasic !== undefined && <td className="num">{money(e.monthlyBasic, e.company.currency)}</td>}
                {isAdmin && (
                  <td>
                    {e.status === 'ACTIVE' && e.user?.email !== me.email && (
                      <button className="danger small" onClick={() => remove(e)}>Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={9} className="muted">No employees to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
