'use client';

import { formatDate, Loan, money, trail } from './api';

/** Terms, approval trail, repayments and the plan still to come for one loan, advance or IOU */
export function LoanDetails({ loan: l }: { loan: Loan }) {
  return (
    <div className="small">
      <div>
        {l.kind === 'LOAN' && <>{l.months} months at {l.interestRate ? `${l.interestRate}% a year` : 'no interest'}. </>}
        {l.firstMonthLabel && l.kind !== 'IOU' && <>Deductions start with {l.firstMonthLabel} pay. </>}
        {l.kind === 'IOU' && l.neededOn && <>Needed {formatDate(l.neededOn)}, to settle by {formatDate(l.settleBy)}{l.costCentre ? `, cost centre ${l.costCentre}` : ''}. </>}
        {l.spent !== null && <>Spent {money(l.spent, l.currency)}, returned {money(l.cashReturned ?? '0', l.currency)}. </>}
        {l.guarantor && <>Guarantor: {l.guarantor}. </>}
      </div>
      {l.decisions.length > 0 && <ul className="trail">{trail(l.decisions).map((t, i) => <li key={i}>{t}</li>)}</ul>}
      {l.repayments.length > 0 && (
        <p>
          Repaid {money(l.repaid, l.currency)}: {l.repayments.map((r) => `${r.label} ${money(r.amount, l.currency)}${r.source === 'CASH' ? ' (cash)' : r.source === 'FINAL_DUES' ? ' (final dues)' : ''}`).join(', ')}
        </p>
      )}
      {l.upcoming.length > 0 && (
        <details className="more">
          <summary>Repayment plan ({l.upcoming.length} more month{l.upcoming.length === 1 ? '' : 's'})</summary>
          <table>
            <thead><tr><th>Pay month</th><th className="num">Deduction</th><th className="num">Owed after</th></tr></thead>
            <tbody>{l.upcoming.map((u) => <tr key={u.label}><td>{u.label}</td><td className="num">{money(u.payment, l.currency)}</td><td className="num">{money(u.balance, l.currency)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}
