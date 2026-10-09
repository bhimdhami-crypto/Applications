'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money, Payslip, periodName } from '@/lib/api';

export default function MyPayslipsPage() {
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Payslip[]>('/payslips/me').then(setSlips).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>My payslips</h1>
      {error && <div className="notice error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Gross</th>
              <th className="num">Deductions</th>
              <th className="num">Net pay</th>
            </tr>
          </thead>
          <tbody>
            {slips?.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/payslips/${p.id}`}>{p.run ? periodName(p.run.periodYear, p.run.periodMonth) : p.id}</Link></td>
                <td className="num">{money(p.gross, p.currency)}</td>
                <td className="num">{money(p.deductions, p.currency)}</td>
                <td className="num">{money(p.net, p.currency)}</td>
              </tr>
            ))}
            {slips?.length === 0 && <tr><td colSpan={4} className="muted">Your payslips appear here once payroll is finalized.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
