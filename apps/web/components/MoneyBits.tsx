'use client';

import { CURRENCIES } from '@gpp/shared';
import { fmtDate } from '@/components/ui';
import type { Decision, Loan, RulePackInfo } from '@/lib/types';

/** An amount in its currency, with that currency's own number of decimals */
export function money(amount: string | number | null | undefined, currency: string, lang = 'en') {
  if (amount === null || amount === undefined || amount === '') return '';
  const digits = CURRENCIES.find((c) => c.code === currency)?.decimals ?? 2;
  return new Intl.NumberFormat(lang, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount));
}

export function loanStatus(l: Pick<Loan, 'kind' | 'status' | 'stageLabel' | 'settledAt' | 'outstanding'>) {
  if (l.status === 'PENDING') return `Waiting for ${l.stageLabel}`;
  if (l.status === 'APPROVED' && l.stageLabel) return 'Settlement waiting for Finance';
  if (l.status === 'APPROVED' && l.kind === 'IOU' && !l.settledAt) return 'Issued, to settle';
  if (l.status === 'APPROVED') return 'Repaying';
  if (l.status === 'CLOSED') return l.kind === 'IOU' ? 'Settled' : 'Repaid';
  return l.status === 'DECLINED' ? 'Declined' : 'Cancelled';
}

const TONE: Record<string, string> = { PENDING: 'warn', APPROVED: 'ok', CLOSED: '', DECLINED: 'bad', CANCELLED: '' };
export function LoanBadge({ loan }: { loan: Parameters<typeof loanStatus>[0] }) {
  return <span className={`badge ${TONE[loan.status] ?? ''}`}>{loanStatus(loan)}</span>;
}

const STAGE_NAME: Record<string, string> = { MANAGER: 'Manager', HR: 'HR', PAYROLL: 'Payroll', FINANCE: 'Finance', COUNTRY_HEAD: 'Country Head' };
export const trail = (decisions: Decision[], lang = 'en') =>
  decisions.map((d) => `${STAGE_NAME[d.stage] ?? d.stage}: ${d.byName} ${d.approved ? 'approved' : 'declined'} ${fmtDate(d.at, lang)}${d.note ? ` (${d.note})` : ''}`);

export function DraftPackNote({ pack, extra }: { pack?: RulePackInfo | null; extra?: string }) {
  if (!pack) return null;
  return (
    <div className="alert info" role="note">
      <strong>Draft rules ({pack.version}), not verified.</strong> {pack.summary} {extra}
    </div>
  );
}

/** Terms, approval trail, repayments and the plan still to come for one loan, advance or IOU */
export function LoanDetails({ loan: l, lang = 'en' }: { loan: Loan; lang?: string }) {
  return (
    <div style={{ fontSize: '.9rem' }}>
      <div>
        {l.kind === 'LOAN' && <>{l.months} months at {l.interestRate ? `${l.interestRate}% a year` : 'no interest'}. </>}
        {l.firstMonthLabel && l.kind !== 'IOU' && <>Deductions start with {l.firstMonthLabel} pay. </>}
        {l.kind === 'IOU' && l.neededOn && (
          <>
            Needed {fmtDate(l.neededOn, lang)}, to settle by {fmtDate(l.settleBy, lang)}
            {l.costCentre ? `, cost centre ${l.costCentre}` : ''}.{' '}
          </>
        )}
        {l.spent !== null && (
          <>
            Spent {money(l.spent, l.currency, lang)}, returned {money(l.cashReturned ?? '0', l.currency, lang)}.{' '}
          </>
        )}
        {l.guarantor && <>Guarantor: {l.guarantor}. </>}
        <span className="muted">Rules {l.rulesVersion}.</span>
      </div>
      {l.decisions.length > 0 && (
        <ul>
          {trail(l.decisions, lang).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {l.repayments.length > 0 && (
        <p>
          Repaid {money(l.repaid, l.currency, lang)}:{' '}
          {l.repayments.map((r) => `${r.label} ${money(r.amount, l.currency, lang)}${r.source === 'CASH' ? ' (cash)' : r.source === 'FINAL_DUES' ? ' (final dues)' : ''}`).join(', ')}
        </p>
      )}
      {l.upcoming.length > 0 && (
        <details>
          <summary>
            Repayment plan ({l.upcoming.length} more month{l.upcoming.length === 1 ? '' : 's'})
          </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pay month</th>
                  <th className="num">Deduction</th>
                  <th className="num">Owed after</th>
                </tr>
              </thead>
              <tbody>
                {l.upcoming.map((u) => (
                  <tr key={u.label}>
                    <td>{u.label}</td>
                    <td className="num">{money(u.payment, l.currency, lang)}</td>
                    <td className="num">{money(u.balance, l.currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

export const LOCATION_LABEL: Record<string, string> = { ON_SITE: 'On site', HYBRID: 'Hybrid', FULLY_REMOTE: 'Fully remote' };
export const OCCASION_LABEL: Record<string, string> = {
  BIRTHDAY: 'Birthday',
  LONG_SERVICE: 'Long service',
  FESTIVE: 'Festive season',
  RECOGNITION: 'Recognition',
  WEDDING: 'Wedding',
  NEW_BABY: 'New baby',
  OTHER: 'Other',
};

/** Status of a meal or gym enrolment, or a gift voucher, in words */
export function benefitStatus(r: { status: string; stageLabel: string | null; endLabel?: string | null }, issued = 'Active') {
  if (r.status === 'PENDING') return `Waiting for ${r.stageLabel}`;
  if (r.status === 'APPROVED') return r.endLabel ? `Ends ${r.endLabel}` : issued;
  if (r.status === 'CLOSED') return r.endLabel ? `Ended ${r.endLabel}` : 'Ended';
  return r.status === 'DECLINED' ? 'Declined' : 'Cancelled';
}

export function BenefitBadge({ r, issued }: { r: Parameters<typeof benefitStatus>[0]; issued?: string }) {
  return <span className={`badge ${TONE[r.status] ?? ''}`}>{benefitStatus(r, issued)}</span>;
}
