'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { api, money, PayLine, Payslip, periodName } from '@/lib/api';
import { useSession } from '@/lib/session';

type FullPayslip = Payslip & {
  run: { periodYear: number; periodMonth: number; status: string; rulesVersion: string; company: { name: string } };
  employee: { employeeNo: string; firstName: string; lastName: string; jobTitle: string; department: string };
};

function Lines({ title, lines, currency, total, totalLabel }: { title: string; lines: PayLine[]; currency: string; total?: string; totalLabel?: string }) {
  return (
    <div className="slip-col">
      <h3>{title}</h3>
      <table>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.code}-${i}`}>
              <td>{l.label}</td>
              <td className="num">{money(l.amount, currency)}</td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td className="muted" colSpan={2}>None this month</td></tr>}
          {total !== undefined && (
            <tr className="total"><td>{totalLabel}</td><td className="num">{money(total, currency)}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const [slip, setSlip] = useState<FullPayslip | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<FullPayslip>(`/payslips/${id}`).then(setSlip).catch((e) => setError(e.message));
  }, [id]);

  if (!slip) return error ? <div className="notice error">{error}</div> : <div className="loading"><span className="spinner" /> Loading payslip…</div>;
  const cur = slip.currency;
  const of = (kind: PayLine['kind']) => slip.lines.filter((l) => l.kind === kind);
  const period = periodName(slip.run.periodYear, slip.run.periodMonth);
  const own = me.employee?.employeeNo === slip.employee.employeeNo;

  return (
    <>
      <PageHeader
        back={own ? { href: '/payslips', label: 'My payslips' } : { href: '/payroll', label: 'Payroll runs' }}
        title={`Payslip, ${period}`}
        sub={`${slip.employee.firstName} ${slip.employee.lastName} · ${slip.run.company.name}`}
        actions={<button className="secondary" onClick={() => window.print()}><Printer size={16} /> Print or save as PDF</button>}
      />
      {slip.run.status !== 'FINALIZED' && <div className="notice warn">Draft: this run is still {slip.run.status.toLowerCase()}, so these figures can change.</div>}

      <article className="card slip">
        <header className="slip-head">
          <img src="/logo.svg" alt="Mindspace Artificial Intelligence" />
          <div className="slip-title">
            <strong>Payslip</strong>
            <span>{period}</span>
          </div>
        </header>
        <dl className="fields slip-meta">
          <div><dt>Employee</dt><dd>{slip.employee.firstName} {slip.employee.lastName}</dd></div>
          <div><dt>Employee number</dt><dd>{slip.employee.employeeNo}</dd></div>
          <div><dt>Job title</dt><dd>{slip.employee.jobTitle}</dd></div>
          <div><dt>Department</dt><dd>{slip.employee.department}</dd></div>
          <div><dt>Employer</dt><dd>{slip.run.company.name}</dd></div>
          <div><dt>Currency</dt><dd>{cur}</dd></div>
        </dl>

        <div className="slip-cols">
          <Lines title="Earnings" lines={of('EARNING')} currency={cur} total={slip.gross} totalLabel="Gross pay" />
          <Lines title="Deductions" lines={of('DEDUCTION')} currency={cur} total={slip.deductions} totalLabel="Total deductions" />
        </div>

        <div className="slip-net">
          <div>
            <span>Net pay</span>
            <small>Paid to your bank account</small>
          </div>
          <strong>{money(slip.net, cur)}</strong>
        </div>

        {(of('EMPLOYER').length > 0 || of('BENEFIT').length > 0) && (
          <div className="slip-cols">
            {of('EMPLOYER').length > 0 && <Lines title="Paid by your employer on your behalf" lines={of('EMPLOYER')} currency={cur} />}
            {of('BENEFIT').length > 0 && <Lines title="Benefits in kind (not paid in cash)" lines={of('BENEFIT')} currency={cur} />}
          </div>
        )}

        <footer className="slip-foot">
          {slip.annualLeaveLeft !== null && slip.annualLeaveLeft !== undefined && (
            <span>Annual leave left for {slip.run.periodYear}: <strong>{slip.annualLeaveLeft} day{slip.annualLeaveLeft === 1 ? '' : 's'}</strong></span>
          )}
          <span className="muted">Calculated with rules {slip.run.rulesVersion}. Questions about your pay: payroll@mindspace-ai.com</span>
          <span className="muted">This is a computer-generated payslip and needs no signature. It is confidential to the employee named above. Report any error to Payroll promptly.</span>
        </footer>
      </article>
    </>
  );
}
