'use client';

import { Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BankReconciliationView, SavedReconciliation, api, errorText } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

/** The bank reconciliation statement at a date, and its preparation and review */
export function ReconciliationPanel({ base, currency, defaultDate, onChange }: { base: string; currency: string; defaultDate: string; onChange: () => void }) {
  const { user, can, canPrepare } = useSession();
  const [asAt, setAsAt] = useState(defaultDate);
  const [view, setView] = useState<BankReconciliationView | null>(null);
  const [saved, setSaved] = useState<SavedReconciliation[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    setError('');
    api<BankReconciliationView>(`${base}/reconciliation?asAt=${asAt}`)
      .then(setView)
      .catch((e) => setError(errorText(e)));
    api<SavedReconciliation[]>(`${base}/reconciliations`)
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [base, asAt]);
  useEffect(load, [load]);

  async function act(path: string, body: object | undefined, message: string) {
    setError('');
    setNotice('');
    try {
      await api(path, { method: 'POST', body });
      setNotice(message);
      setNote('');
      load();
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const balanced = view?.difference === '0.0000';
  const row = (label: string, value: string, sign = '') => (
    <tr>
      <td>{label}</td>
      <td className="num">
        {sign}
        {formatAmount(value)}
      </td>
    </tr>
  );

  return (
    <>
      <div className="card no-print" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field">
          Reconcile at
          <input type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={() => window.print()}>
          <Printer size={15} /> Print
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {view && (
        <div className="card">
          <h2>Bank reconciliation at {formatDate(view.asAt)}</h2>
          {view.statementBalance == null ? (
            <div className="muted">No statement lines on or before this date. Import the statement first.</div>
          ) : (
            <table className="recon">
              <tbody>
                {row(`Balance per bank statement (${formatDate(view.statementDate)})`, view.statementBalance)}
                {row('Add: deposits in the ledger not yet on the statement', view.depositsInTransit, '+ ')}
                {row('Less: payments in the ledger not yet on the statement', view.unpresentedPayments, '− ')}
                {row('Less: money in on the statement not yet in the ledger', view.bankMoneyIn, '− ')}
                {row('Add: money out on the statement not yet in the ledger', view.bankMoneyOut, '+ ')}
                <tr className="recon-total">
                  <td>Adjusted bank balance</td>
                  <td className="num">{formatAmount(view.adjustedBalance)}</td>
                </tr>
                {row(`Balance per ledger`, view.ledgerBalance)}
                <tr className={`recon-total ${balanced ? 'ok' : 'bad'}`}>
                  <td>{balanced ? 'Reconciled: no difference' : 'Unexplained difference'}</td>
                  <td className="num">
                    {currency} {formatAmount(view.difference)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {view.outstandingEntries.length > 0 && (
            <>
              <h3>In the ledger, not yet on the statement</h3>
              <ItemTable items={view.outstandingEntries.map((e) => ({ key: e.id, date: e.txDate, text: `${e.auditNo} · ${e.description}`, ref: e.reference, amount: e.amount }))} />
            </>
          )}
          {view.outstandingLines.length > 0 && (
            <>
              <h3>On the statement, not yet in the ledger</h3>
              <ItemTable items={view.outstandingLines.map((l) => ({ key: String(l.id), date: l.txDate, text: l.description, ref: l.reference, amount: l.amount }))} />
            </>
          )}
          {canPrepare && view.statementBalance != null && (
            <div className="no-print" style={{ marginTop: 16, display: 'grid', gap: 8, maxWidth: 640 }}>
              {!balanced && (
                <label className="field">
                  Why it does not balance
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
                </label>
              )}
              <div className="actions-bar">
                <button
                  className="btn primary"
                  disabled={!balanced && !note.trim()}
                  onClick={() => act(`${base}/reconciliations`, { asAt, note: note.trim() || undefined }, 'Prepared. A finance manager or director now reviews it.')}
                >
                  Prepare for review
                </button>
                <span className="muted">Saves these figures under your name; another person reviews them.</span>
              </div>
            </div>
          )}
        </div>
      )}
      {saved.length > 0 && (
        <div className="card table-wrap">
          <h2>Signed-off reconciliations</h2>
          <table>
            <thead>
              <tr>
                <th>At</th>
                <th className="num">Statement</th>
                <th className="num">Ledger</th>
                <th className="num">Difference</th>
                <th>Prepared</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.asAt)}</td>
                  <td className="num">{formatAmount(r.statementBalance)}</td>
                  <td className="num">{formatAmount(r.ledgerBalance)}</td>
                  <td className="num">
                    {formatAmount(r.difference)}
                    {r.note && <div className="muted">{r.note}</div>}
                  </td>
                  <td>
                    {r.preparedBy.name}
                    <div className="muted">{formatDate(r.preparedAt)}</div>
                  </td>
                  <td>
                    {r.reviewedBy ? (
                      <>
                        {r.reviewedBy.name}
                        <div className="muted">{formatDate(r.reviewedAt)}</div>
                      </>
                    ) : can('FINANCE_MANAGER', 'DIRECTOR') && r.preparedById !== user.id ? (
                      <button className="btn small primary no-print" onClick={() => act(`${base}/reconciliations/${r.id}/review`, undefined, `Reviewed the reconciliation at ${formatDate(r.asAt)}`)}>
                        Review and sign off
                      </button>
                    ) : (
                      <span className="badge SUBMITTED">Awaiting review</span>
                    )}
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

function ItemTable({ items }: { items: Array<{ key: string; date: string; text: string; ref: string | null; amount: string }> }) {
  return (
    <table>
      <tbody>
        {items.map((i) => (
          <tr key={i.key}>
            <td style={{ width: 110 }}>{formatDate(i.date)}</td>
            <td>{i.text}</td>
            <td className="muted">{i.ref}</td>
            <td className="num">{formatAmount(i.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
