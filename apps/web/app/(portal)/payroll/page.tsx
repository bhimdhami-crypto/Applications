'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, Company, PayrollRun, periodName } from '@/lib/api';

/** Run totals in whole units, so eight currencies fit side by side */
const whole = (v: string | number) => Math.round(Number(v)).toLocaleString('en-GB');

const now = new Date();

export default function PayrollPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState('');

  useEffect(() => {
    api<PayrollRun[]>('/payroll/runs').then(setRuns).catch((e) => setError(e.message));
    api<Company[]>('/companies').then(setCompanies).catch(() => setCompanies([]));
  }, []);

  const ready = companies.filter((c) => c.payrollRules);
  const notReady = companies.filter((c) => !c.payrollRules);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const run = await api<PayrollRun>('/payroll/runs', { method: 'POST', body: { companyId, year, month } });
      router.push(`/payroll/${run.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Payroll</h1>
      <p className="muted">
        Payroll staff create and check a draft. The administrator approves it, then finalizes it, which publishes payslips and emails every
        employee. Drafts for the current month are also created automatically on the 20th.
      </p>
      {error && <div className="notice error">{error}</div>}

      <form className="card" onSubmit={create}>
        <h2 style={{ marginTop: 0 }}>Start a payroll run</h2>
        <div className="form-grid">
          <label>
            Company
            <select required value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose…</option>
              {ready.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{periodName(2000, i + 1).split(' ')[0]}</option>)}
            </select>
          </label>
          <label>Year<input type="number" min={2016} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        </div>
        <button type="submit">Create draft</button>
        {notReady.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            No payroll rules in the portal for: {notReady.map((c) => c.country).join(', ')}.
          </p>
        )}
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Company</th>
              <th>Status</th>
              <th className="num">Payslips</th>
              <th className="num">Gross</th>
              <th className="num">Net</th>
              <th className="num">Employer cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payroll/${r.id}`}>{periodName(r.periodYear, r.periodMonth)}</Link></td>
                <td className="wrap">{r.company.name.replace(/^Mindspace (Artificial Intelligence|Inteligencia Artificial) /, '')}<div className="muted small">{r.company.currency}</div></td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td className="num">{r._count?.payslips}</td>
                <td className="num">{whole(r.totalGross)}</td>
                <td className="num">{whole(r.totalNet)}</td>
                <td className="num">{whole(r.totalEmployerCost)}</td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td colSpan={7} className="muted">No payroll runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
