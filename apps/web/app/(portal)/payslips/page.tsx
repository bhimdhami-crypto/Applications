'use client';

import Link from 'next/link';
import { money } from '@/components/MoneyBits';
import { Empty, ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { MyPayslip } from '@/lib/types';

/** The signed-in person's payslips from finalised payrolls */
export default function PayslipsPage() {
  const { t, lang } = usePrefs();
  const data = useLoad(() => api<MyPayslip[]>('/payslips/me'), []);
  const slips = data.data;
  return (
    <>
      <PageHead title={t('nav.payslips')} sub="Your payslip appears here once Payroll has finalised the month. We email you when it is ready, without the amounts." />
      <ErrorAlert error={data.error} />
      {!slips ? (
        !data.error && <Loading />
      ) : slips.length === 0 ? (
        <Empty>No payslips yet.</Empty>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Company</th>
                <th className="num">Gross</th>
                <th className="num">Deductions</th>
                <th className="num">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/payslips/${s.id}`}>{s.period}</Link>
                    {!s.rulesVerified && <span className="badge warn">Unverified rules</span>}
                  </td>
                  <td>{s.company.name}</td>
                  <td className="num">{money(s.gross, s.currency, lang)}</td>
                  <td className="num">{money(s.deductions, s.currency, lang)}</td>
                  <td className="num">
                    <strong>{money(s.net, s.currency, lang)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
