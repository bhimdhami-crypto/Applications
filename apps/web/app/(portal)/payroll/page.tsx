'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { money } from '@/components/MoneyBits';
import { RunBadge } from '@/components/PayrollBits';
import { Empty, ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { PayrollCompany, PayrollRunDetail } from '@/lib/types';

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Each company's month-end payroll runs, and starting the next one */
export default function PayrollPage() {
  const { t, lang } = usePrefs();
  const { entityId } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useLoad(() => api<{ year: number; companies: PayrollCompany[] }>(`/payroll/runs?year=${year}`), [year]);
  const [form, setForm] = useState({ entityId: '', month: thisMonth() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const companies = data.data?.companies ?? [];
  const ready = companies.filter((c) => c.canPrepare && c.payrollOn && c.rules);
  const chosen = form.entityId || (ready.some((c) => c.id === entityId) ? entityId! : (ready[0]?.id ?? ''));

  async function create(e: FormEvent) {
    e.preventDefault();
    const [y, m] = form.month.split('-').map(Number);
    setBusy(true);
    setError(null);
    try {
      const run = await api<PayrollRunDetail>('/payroll/runs', { method: 'POST', body: { entityId: chosen, year: y, month: m } });
      router.push(`/payroll/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  async function createAll() {
    const [y, m] = form.month.split('-').map(Number);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ period: string; created: string[]; skipped: Array<{ code: string; reason: string }> }>('/payroll/runs/all', { method: 'POST', body: { year: y, month: m } });
      setNotice(`${r.period}: drafted ${r.created.length ? r.created.join(', ') : 'no companies'}.${r.skipped.length ? ` Skipped ${r.skipped.map((s) => `${s.code} (${s.reason})`).join('; ')}.` : ''}`);
      data.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title={t('nav.payrollRuns')}
        sub="Payroll prepares each company’s month, someone else approves it, and finalising publishes the payslips and records loan repayments."
        actions={
          <label className="field">
            <span>Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[0, 1, 2].map((d) => {
                const y = new Date().getFullYear() - d;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </label>
        }
      />
      <div className="alert info" role="note">
        Every country pack is an unverified draft from the first build, so each run and payslip is marked as not certified for real payment. Totals stay in each company’s own currency because the portal has no approved exchange rates.
      </div>
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || data.error} />

      {ready.length > 0 && (
        <form className="card inline-form" onSubmit={create}>
          <label className="field">
            <span>Company</span>
            <select value={chosen} onChange={(e) => setForm({ ...form, entityId: e.target.value })}>
              {ready.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Month</span>
            <input type="month" required value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </label>
          <button className="btn" disabled={busy || !chosen}>
            Prepare payroll
          </button>
          {ready.length > 1 && (
            <button type="button" className="btn secondary" disabled={busy} onClick={createAll}>
              Prepare for all my companies
            </button>
          )}
        </form>
      )}

      {!data.data ? (
        !data.error && <Loading />
      ) : companies.length === 0 ? (
        <Empty>No companies to show.</Empty>
      ) : (
        <div className="table-wrap card" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Month</th>
                <th>Status</th>
                <th className="num">Payslips</th>
                <th className="num">Net pay</th>
                <th className="num">Employer cost</th>
              </tr>
            </thead>
            <tbody>
              {companies.flatMap((c) => {
                const head = (
                  <td rowSpan={Math.max(1, c.runs.length)}>
                    <strong>{c.code}</strong> {c.name}
                    <div className="muted small">
                      {!c.payrollOn ? 'Payroll switched off' : c.rules ? `Rules ${c.rules.version}${c.rules.verified ? '' : ', unverified'}` : 'No payroll rules in the portal yet'}
                    </div>
                  </td>
                );
                if (!c.runs.length)
                  return [
                    <tr key={c.id}>
                      {head}
                      <td colSpan={5} className="muted">
                        No runs in {year}
                      </td>
                    </tr>,
                  ];
                return c.runs.map((r, i) => (
                  <tr key={r.id}>
                    {i === 0 && head}
                    <td>
                      <Link href={`/payroll/${r.id}`}>{r.period}</Link>
                    </td>
                    <td>
                      <RunBadge status={r.status} />
                      {r.exceptions > 0 && <span className="badge bad">{r.exceptions} to check</span>}
                    </td>
                    <td className="num">{r.headcount}</td>
                    <td className="num">{money(r.totalNet, r.currency, lang)}</td>
                    <td className="num">{money(r.totalEmployerCost, r.currency, lang)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
