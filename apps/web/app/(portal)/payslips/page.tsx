'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { Empty, Kpi, PageHeader } from '@/components/ui';
import { api, money, Payslip, periodName } from '@/lib/api';

export default function MyPayslipsPage() {
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Payslip[]>('/payslips/me').then(setSlips).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title="My payslips" sub="Every finalised payslip, newest first. Open one to print it or save it as a PDF." />
      {error && <div className="notice error">{error}</div>}
      {slips && slips.length > 0 && (
        <div className="grid">
          <Kpi icon={Receipt} label="Latest net pay" value={money(slips[0].net, slips[0].currency)} note={slips[0].run ? periodName(slips[0].run.periodYear, slips[0].run.periodMonth) : undefined} href={`/payslips/${slips[0].id}`} linkLabel="Open payslip" />
          <Kpi icon={Receipt} tone="teal" label="Net pay this year" value={money(slips.filter((p) => p.run?.periodYear === slips[0].run?.periodYear).reduce((s, p) => s + Number(p.net), 0), slips[0].currency)} note={`${slips.filter((p) => p.run?.periodYear === slips[0].run?.periodYear).length} payslips in ${slips[0].run?.periodYear}`} />
        </div>
      )}
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
                <td className="num"><b>{money(p.net, p.currency)}</b></td>
              </tr>
            ))}
            {slips?.length === 0 && <tr><td colSpan={4}><Empty icon={Receipt} title="No payslips yet">Your payslips appear here once payroll is finalised.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
