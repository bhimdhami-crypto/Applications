'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money, PayLine, Payslip, periodName } from '@/lib/api';

type FullPayslip = Payslip & {
  run: { periodYear: number; periodMonth: number; status: string; rulesVersion: string; company: { name: string } };
  employee: { employeeNo: string; firstName: string; lastName: string; jobTitle: string; department: string };
};

function Section({ title, lines, currency }: { title: string; lines: PayLine[]; currency: string }) {
  if (lines.length === 0) return null;
  return (
    <>
      <tr><th colSpan={2}>{title}</th></tr>
      {lines.map((l, i) => (
        <tr key={`${l.code}-${i}`}>
          <td>{l.label}</td>
          <td className="num">{money(l.amount, currency)}</td>
        </tr>
      ))}
    </>
  );
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const [slip, setSlip] = useState<FullPayslip | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<FullPayslip>(`/payslips/${id}`).then(setSlip).catch((e) => setError(e.message));
  }, [id]);

  if (!slip) return error ? <div className="notice error">{error}</div> : <div className="loading">Loading…</div>;
  const cur = slip.currency;
  const of = (kind: PayLine['kind']) => slip.lines.filter((l) => l.kind === kind);

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <img src="/logo.svg" alt="Mindspace" style={{ width: 220 }} />
      <h1 style={{ marginTop: '1rem' }}>Payslip, {periodName(slip.run.periodYear, slip.run.periodMonth)}</h1>
      <p className="muted">
        {slip.run.company.name}
        <br />
        {slip.employee.firstName} {slip.employee.lastName} ({slip.employee.employeeNo}), {slip.employee.jobTitle}, {slip.employee.department}
      </p>
      {slip.run.status !== 'FINALIZED' && <div className="notice warn">Draft: this run is still {slip.run.status.toLowerCase()}.</div>}
      <table>
        <tbody>
          <Section title="Earnings" lines={of('EARNING')} currency={cur} />
          <tr className="total"><td>Gross pay</td><td className="num">{money(slip.gross, cur)}</td></tr>
          <Section title="Deductions" lines={of('DEDUCTION')} currency={cur} />
          <tr className="total"><td>Total deductions</td><td className="num">{money(slip.deductions, cur)}</td></tr>
          <tr className="total"><td>Net pay</td><td className="num">{money(slip.net, cur)}</td></tr>
          <Section title="Paid by the employer on your behalf" lines={of('EMPLOYER')} currency={cur} />
          <Section title="Benefits in kind (not paid in cash)" lines={of('BENEFIT')} currency={cur} />
        </tbody>
      </table>
      {slip.annualLeaveLeft !== null && slip.annualLeaveLeft !== undefined && (
        <p>
          Annual leave left for {slip.run.periodYear}: <strong>{slip.annualLeaveLeft} day{slip.annualLeaveLeft === 1 ? '' : 's'}</strong>
        </p>
      )}
      <p className="muted" style={{ fontSize: '0.8rem' }}>Calculated with rules {slip.run.rulesVersion}.</p>
      <button className="secondary" onClick={() => window.print()}>Print or save as PDF</button>
    </div>
  );
}
