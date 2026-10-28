'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, PlayCircle, Wallet } from 'lucide-react';
import { Empty, Kpi, PageHeader, StatusBadge } from '@/components/ui';
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

  const waiting = runs.filter((r) => r.status !== 'FINALIZED');
  const thisYear = runs.filter((r) => r.periodYear === now.getFullYear() && r.status === 'FINALIZED');

  return (
    <>
      <PageHeader
        title="Payroll runs"
        sub="Payroll creates and checks a draft, the administrator approves it, then finalises it to publish payslips and email every employee. Drafts for the current month are also created automatically on the 20th."
      />
      {error && <div className="notice error">{error}</div>}

      <div className="grid">
        <Kpi icon={CircleDashed} tone="amber" label="Waiting for approval or finalising" value={waiting.length} note={waiting.length ? waiting.map((r) => r.company.countryCode).join(', ') : 'Nothing waiting'} />
        <Kpi icon={CheckCircle2} tone="teal" label={`Finalised in ${now.getFullYear()}`} value={thisYear.length} note={`${thisYear.reduce((s, r) => s + (r._count?.payslips ?? 0), 0).toLocaleString('en-GB')} payslips published`} />
        <Kpi icon={Wallet} label="Companies on payroll" value={ready.length} note={notReady.length ? `No rules yet for ${notReady.map((c) => c.country).join(', ')}` : 'Every company has rules'} />
      </div>

      <form className="card" onSubmit={create}>
        <div className="card-head" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
          <div>
            <h2>Start a payroll run</h2>
            <p className="sub">Creates a draft from current pay, leave, loans and benefits. You can recalculate it until it is approved.</p>
          </div>
        </div>
        <div className="form-grid" style={{ alignItems: 'end' }}>
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
          <label><button type="submit" style={{ width: '100%' }}><PlayCircle size={16} /> Create draft</button></label>
        </div>
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
                <td>
                  <span className="person">
                    <span className="cc">{r.company.countryCode}</span>
                    <span>{r.company.name.replace(/^Mindspace (Artificial Intelligence|Inteligencia Artificial) /, '')}<span className="sub">{r.company.currency}</span></span>
                  </span>
                </td>
                <td><StatusBadge status={r.status} /></td>
                <td className="num">{r._count?.payslips?.toLocaleString('en-GB')}</td>
                <td className="num">{whole(r.totalGross)}</td>
                <td className="num">{whole(r.totalNet)}</td>
                <td className="num">{whole(r.totalEmployerCost)}</td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td colSpan={7}><Empty icon={Wallet} title="No payroll runs yet">Start the first run above.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
