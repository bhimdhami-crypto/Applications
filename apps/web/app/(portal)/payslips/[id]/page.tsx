'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { money } from '@/components/MoneyBits';
import { UnverifiedRules } from '@/components/PayrollBits';
import { ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Payslip, PayslipLine } from '@/lib/types';

const SECTIONS: Array<[PayslipLine['kind'], string]> = [
  ['EARNING', 'Earnings'],
  ['DEDUCTION', 'Deductions'],
  ['BENEFIT', 'Benefits in kind (taxed, not paid in cash)'],
  ['EMPLOYER', 'Paid by the company on top of your pay'],
];

/** A printable payslip, watermarked while the country's rules are unverified */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = usePrefs();
  const { can } = useSession();
  const data = useLoad(() => api<Payslip>(`/payslips/${id}`), [id]);
  const s = data.data;
  const crumbs = <Link href="/payslips">{t('nav.payslips')}</Link>;
  if (!s) {
    return (
      <>
        <PageHead title={t('nav.payslips')} crumbs={crumbs} />
        {data.error ? <ErrorAlert error={data.error} /> : <Loading />}
      </>
    );
  }
  const m = (v: string | number) => money(v, s.currency, lang);
  return (
    <>
      <PageHead
        title={`Payslip: ${s.period}`}
        crumbs={can('payroll.read') ? <Link href={`/payroll/${s.runId}`}>{t('nav.payrollRuns')}</Link> : crumbs}
        actions={
          <button type="button" className="btn secondary small" onClick={() => window.print()}>
            Print
          </button>
        }
      />
      <UnverifiedRules version={s.rulesVersion} verified={s.rulesVerified} />
      {s.status !== 'FINALIZED' && <div className="alert info">This payroll is not final yet, so the employee cannot see this payslip.</div>}
      <article className={`card payslip${s.rulesVerified ? '' : ' unverified'}`}>
        <header className="payslip-head">
          <div>
            <strong>{s.company.name}</strong>
            {s.company.address && <div className="small">{s.company.address}</div>}
            {s.company.taxNumber && <div className="small">Tax number {s.company.taxNumber}</div>}
          </div>
          <div className="payslip-who">
            <strong>{s.employee.name}</strong>
            <div className="small">
              {s.employee.employeeNumber}
              {s.employee.jobTitle && ` · ${s.employee.jobTitle}`}
            </div>
            {s.employee.department && <div className="small">{s.employee.department}</div>}
            <div className="small">
              Pay period {s.period}
              {s.finalizedAt && ` · paid ${fmtDate(s.finalizedAt, lang)}`}
            </div>
          </div>
        </header>
        {SECTIONS.map(([kind, title]) => {
          const lines = s.lines.filter((l) => l.kind === kind);
          if (!lines.length) return null;
          return (
            <section key={kind}>
              <h3>{title}</h3>
              <table>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.code}-${i}`}>
                      <td>
                        {l.label}
                        {l.interest ? <span className="muted small"> (includes {m(l.interest)} interest)</span> : null}
                      </td>
                      <td className="num">{m(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
        <table className="payslip-totals">
          <tbody>
            <tr>
              <td>Gross pay</td>
              <td className="num">{m(s.gross)}</td>
            </tr>
            <tr>
              <td>Total deductions</td>
              <td className="num">{m(s.deductions)}</td>
            </tr>
            <tr>
              <td>
                <strong>Net pay</strong>
              </td>
              <td className="num">
                <strong>{m(s.net)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <footer className="muted small">
          {s.annualLeaveLeft !== null && <p>Annual leave left this year: {s.annualLeaveLeft} days.</p>}
          <p>
            Calculated with {s.rulesVersion}
            {s.rulesVerified ? '.' : ', draft rules not verified by a local payroll expert. Not a certified calculation.'}
          </p>
        </footer>
      </article>
    </>
  );
}
