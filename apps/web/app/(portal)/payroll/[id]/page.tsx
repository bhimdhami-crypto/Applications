'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Banknote, Building2, Download, MinusCircle, RefreshCw, Send, Wallet } from 'lucide-react';
import { Kpi, PageHeader, StatusBadge } from '@/components/ui';
import { amount, api, compactMoney, money, PayLine, PayrollRun, periodName } from '@/lib/api';
import { useSession } from '@/lib/session';

const line = (lines: PayLine[], code: string) => lines.find((l) => l.code === code)?.amount;
const PAGE = 50;
const statutory = (l: PayLine) => l.kind === 'DEDUCTION' && !l.voluntary && !l.ref;

/** The country's statutory deductions, in payslip order, as table columns */
function columnsOf(run: PayrollRun) {
  const cols = new Map<string, string>();
  for (const p of run.payslips ?? []) for (const l of p.lines) if (statutory(l) && !cols.has(l.code)) cols.set(l.code, l.label.replace(/ \(.*\)$/, ''));
  return [...cols];
}
const others = (p: { deductions: string; lines: PayLine[] }) => Number(p.deductions) - p.lines.filter(statutory).reduce((s, l) => s + Number(l.amount), 0);

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    api<PayrollRun>(`/payroll/runs/${id}`).then(setRun).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function act(action: 'recalculate' | 'approve' | 'finalize', confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/payroll/runs/${id}/${action}`, { method: 'POST' });
      setNotice(
        { recalculate: 'Recalculated from current employee pay.', approve: 'Approved. Finalize it to publish payslips.', finalize: 'Finalized. Payslips are published and employees were emailed.' }[action],
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const all = run?.payslips ?? [];
    return term ? all.filter((p) => `${p.employee?.firstName} ${p.employee?.lastName} ${p.employee?.employeeNo}`.toLowerCase().includes(term)) : all;
  }, [run, filter]);

  if (!run) return error ? <div className="notice error">{error}</div> : <div className="loading"><span className="spinner" /> Loading payroll run…</div>;
  const cur = run.company.currency;
  const columns = columnsOf(run);
  const hasOthers = run.payslips?.some((p) => others(p) > 0.004) ?? false;
  const period = periodName(run.periodYear, run.periodMonth);
  const isAdmin = me.role === 'ADMIN';
  const step = { DRAFT: 1, APPROVED: 2, FINALIZED: 3 }[run.status];

  /** The register as a CSV file for the bank upload or the accountant, built from what is on screen. */
  function exportCsv() {
    if (!run) return;
    const head = ['Employee number', 'Name', 'Gross', ...columns.map(([, l]) => l), ...(hasOthers ? ['Loans and other'] : []), 'Net', 'Employer cost'];
    const body = (run.payslips ?? []).map((p) => [
      p.employee?.employeeNo ?? '',
      `${p.employee?.firstName ?? ''} ${p.employee?.lastName ?? ''}`,
      p.gross,
      ...columns.map(([code]) => line(p.lines, code) ?? ''),
      ...(hasOthers ? [others(p).toFixed(2)] : []),
      p.net,
      p.employerCost,
    ]);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${run.company.countryCode}-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <>
      <PageHeader
        back={{ href: '/payroll', label: 'All payroll runs' }}
        title={<>{period} payroll <StatusBadge status={run.status} /></>}
        sub={<>{run.company.name} · rules {run.rulesVersion} · {run.payslips?.length.toLocaleString('en-GB')} payslips · amounts in {cur}</>}
        actions={
          <>
            <button className="secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
            {run.status === 'DRAFT' && (
              <button className="secondary" disabled={busy} onClick={() => act('recalculate')}><RefreshCw size={16} /> Recalculate</button>
            )}
            {isAdmin && run.status === 'DRAFT' && (
              <button disabled={busy} onClick={() => act('approve', `Approve ${period} payroll for ${run.company.name}?`)}><BadgeCheck size={16} /> Approve</button>
            )}
            {isAdmin && run.status === 'APPROVED' && (
              <button disabled={busy} onClick={() => act('finalize', `Finalize ${period}? Payslips are published and every employee is emailed. This cannot be undone.`)}>
                <Send size={16} /> Finalise and publish payslips
              </button>
            )}
          </>
        }
      />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      {!run.rulesVerified && (
        <div className="notice warn">
          Tax rules {run.rulesVersion} are a draft that a local payroll adviser has not signed off yet. Use this run for testing, not real pay.
        </div>
      )}

      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div className={`track s${step}`} aria-hidden="true" style={{ marginBottom: '0.6rem' }}><i /><i /><i /></div>
        <div className="track-label" style={{ fontSize: '0.8rem' }}>
          <span><b>Draft</b> · created by payroll</span>
          <span><b>Approved</b>{run.approvedAt ? ` · ${new Date(run.approvedAt).toLocaleDateString('en-GB')}` : ' · by the administrator'}</span>
          <span><b>Finalised</b>{run.finalizedAt ? ` · ${new Date(run.finalizedAt).toLocaleDateString('en-GB')}` : ' · payslips published'}</span>
        </div>
        {!isAdmin && run.status !== 'FINALIZED' && <p className="muted small" style={{ margin: '0.6rem 0 0' }}>Waiting for the administrator to approve and finalise.</p>}
      </div>

      <div className="grid">
        <Kpi icon={Banknote} label="Gross pay" value={compactMoney(run.totalGross, cur)} note={money(run.totalGross, cur)} />
        <Kpi icon={MinusCircle} tone="red" label="Deductions" value={compactMoney(run.totalDeductions, cur)} note={money(run.totalDeductions, cur)} />
        <Kpi icon={Wallet} tone="teal" label="Net pay" value={compactMoney(run.totalNet, cur)} note={money(run.totalNet, cur)} />
        <Kpi icon={Building2} tone="violet" label="Employer cost" value={compactMoney(run.totalEmployerCost, cur)} note={money(run.totalEmployerCost, cur)} />
      </div>

      <div className="card table-wrap">
        <div className="card-head">
          <div>
            <h2>Payroll register</h2>
            <p className="sub">Statutory deductions by column; loans, advances and benefit shares under “Loans and other”.</p>
          </div>
          <input placeholder="Find an employee" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} style={{ maxWidth: 240, margin: 0 }} aria-label="Find an employee" />
        </div>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th className="num">Gross</th>
              {columns.map(([code, label]) => <th key={code} className="num" style={{ whiteSpace: 'normal' }}>{label}</th>)}
              {hasOthers && <th className="num" style={{ whiteSpace: 'normal' }}>Loans and other</th>}
              <th className="num">Net</th>
              <th className="num">Employer cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((page - 1) * PAGE, page * PAGE).map((p) => (
              <tr key={p.id}>
                <td><Link href={`/payslips/${p.id}`}>{p.employee?.firstName} {p.employee?.lastName}</Link> <span className="muted small">{p.employee?.employeeNo}</span></td>
                <td className="num">{amount(p.gross)}</td>
                {columns.map(([code]) => <td key={code} className="num">{amount(line(p.lines, code))}</td>)}
                {hasOthers && <td className="num">{others(p) > 0.004 ? amount(others(p).toFixed(2)) : ''}</td>}
                <td className="num"><b>{amount(p.net)}</b></td>
                <td className="num">{amount(p.employerCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > PAGE && (
          <div className="pager">
            <span className="muted">Showing {((page - 1) * PAGE + 1).toLocaleString('en-GB')}–{Math.min(page * PAGE, rows.length).toLocaleString('en-GB')} of {rows.length.toLocaleString('en-GB')}</span>
            <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted small">Page {page} of {Math.ceil(rows.length / PAGE)}</span>
            <button className="secondary small" disabled={page * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
