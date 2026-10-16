'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { money } from '@/components/MoneyBits';
import { RunBadge, UnverifiedRules } from '@/components/PayrollBits';
import { ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, ApiError, openFile } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { PayrollRunDetail } from '@/lib/types';

const SHOWN = 200;

/** One company's month: totals, exceptions, payslips, and the next maker or checker step */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = usePrefs();
  const router = useRouter();
  const data = useLoad(() => api<PayrollRunDetail>(`/payroll/runs/${id}`), [id]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = data.data;

  async function act(path: string, confirm?: string, body?: unknown) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/payroll/runs/${id}${path}`, { method: 'POST', body });
      data.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this draft payroll?')) return;
    try {
      await api(`/payroll/runs/${id}`, { method: 'DELETE' });
      router.push('/payroll');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  function sendBack() {
    const note = window.prompt('What should Payroll change?');
    if (note && note.trim().length >= 3) act('/send-back', undefined, { note: note.trim() });
  }

  const crumbs = <Link href="/payroll">{t('nav.payrollRuns')}</Link>;
  if (!r) {
    return (
      <>
        <PageHead title={t('nav.payrollRuns')} crumbs={crumbs} />
        {data.error ? <ErrorAlert error={data.error} /> : <Loading />}
      </>
    );
  }

  const m = (v: string) => money(v, r.currency, lang);
  const q = query.trim().toLowerCase();
  const slips = r.payslips.filter((s) => !q || `${s.name} ${s.employeeNumber} ${s.department ?? ''} ${s.jobTitle ?? ''}`.toLowerCase().includes(q));
  const step = (label: string, who: string | null, at: string | null) => (who ? <li key={label}>{`${label} by ${who}${at ? ` on ${fmtDate(at, lang, true)}` : ''}`}</li> : null);

  return (
    <>
      <PageHead
        title={`${r.entity.name}: ${r.period}`}
        crumbs={crumbs}
        sub={
          <>
            <RunBadge status={r.status} /> {r.headcount} payslips in {r.currency}
            {r.calculatedAt && <span className="muted"> · calculated {fmtDate(r.calculatedAt, lang, true)}</span>}
          </>
        }
        actions={
          <button type="button" className="btn secondary small" onClick={() => openFile(`/payroll/runs/${id}/register`, `payroll-${r.entity.code}-${r.year}-${String(r.month).padStart(2, '0')}.csv`)}>
            Download register (CSV)
          </button>
        }
      />
      <UnverifiedRules version={r.rulesVersion} verified={r.rulesVerified} />
      {r.returnNote && r.status === 'DRAFT' && (
        <div className="alert warn" role="note">
          <strong>Sent back:</strong> {r.returnNote}
        </div>
      )}
      <ErrorAlert error={error} />

      <div className="grid stats">
        {(
          [
            ['Gross pay', r.totalGross],
            ['Deductions', r.totalDeductions],
            ['Net pay', r.totalNet],
            ['Employer cost', r.totalEmployerCost],
          ] as const
        ).map(([label, v]) => (
          <div className="card stat" key={label}>
            <div className="label">{label}</div>
            <div className="value money long">{m(v)}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Approval</h3>
        <ul className="plain">
          {step('Prepared', r.trail.createdBy, r.trail.createdAt)}
          {step('Submitted', r.trail.submittedBy, r.trail.submittedAt)}
          {step('Approved', r.trail.approvedBy, r.trail.approvedAt)}
          {step('Finalised', r.trail.finalizedBy, r.trail.finalizedAt)}
        </ul>
        {r.status === 'SUBMITTED' && r.can.preparedByYou && <p className="muted small">You prepared this payroll, so someone else must approve it.</p>}
        <div className="row">
          {r.can.prepare && (
            <>
              <button type="button" className="btn" disabled={busy || !r.headcount} onClick={() => act('/submit', 'Send this payroll for approval?')}>
                Send for approval
              </button>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => act('/recalculate')}>
                Recalculate
              </button>
              <button type="button" className="btn secondary danger" disabled={busy} onClick={remove}>
                Delete draft
              </button>
            </>
          )}
          {r.can.approve && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('/approve', `Approve the ${r.period} payroll for ${r.entity.name}?`)}>
              Approve
            </button>
          )}
          {r.can.finalize && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('/finalize', 'Finalise? Payslips are published to employees, loan repayments are recorded and the month is locked.')}>
              Finalise and publish payslips
            </button>
          )}
          {r.can.sendBack && (
            <button type="button" className="btn secondary" disabled={busy} onClick={sendBack}>
              Send back
            </button>
          )}
        </div>
      </div>

      {r.exceptions.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Left out of this run ({r.exceptions.length})</h3>
          <ul className="plain">
            {r.exceptions.map((x) => (
              <li key={x.employmentId}>
                {x.employeeNumber} {x.name}: {x.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="filters">
        <label className="field">
          <span>Find a payslip</span>
          <input type="search" value={query} placeholder="Name, number or department" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th className="num">Gross</th>
              <th className="num">Deductions</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {slips.slice(0, SHOWN).map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/payslips/${s.id}`}>{s.name}</Link>
                  <div className="muted small">
                    {s.employeeNumber}
                    {s.jobTitle && ` · ${s.jobTitle}`}
                  </div>
                </td>
                <td>{s.department}</td>
                <td className="num">{m(s.gross)}</td>
                <td className="num">{m(s.deductions)}</td>
                <td className="num">{m(s.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {slips.length > SHOWN && <p className="muted small">Showing {SHOWN} of {slips.length}. Search to narrow the list, or download the register for every row.</p>}
    </>
  );
}
