'use client';

import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDate, Loan, LoanKind, LoanOptions, LoanProduct, LoanQuote, loanStatus, money } from '@/lib/api';
import { LoanDetails } from '@/lib/loan-details';

interface LoanList {
  employee: { id: string; name: string; currency: string };
  outstanding: string;
  loans: Loan[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const EMPTY = { amount: '', months: '12', product: 'PERSONAL' as LoanProduct, purpose: '', guarantor: '', costCentre: '', neededOn: todayIso(), settleBy: plusDays(todayIso(), 14) };
const KINDS: Array<{ kind: LoanKind; label: string; form: string }> = [
  { kind: 'ADVANCE', label: 'Salary advance', form: 'HR-F02' },
  { kind: 'LOAN', label: 'Staff loan', form: 'HR-F03' },
  { kind: 'IOU', label: 'IOU', form: 'HR-F04' },
];

export default function MoneyPage() {
  const [options, setOptions] = useState<LoanOptions | null>(null);
  const [data, setData] = useState<LoanList | null>(null);
  const [kind, setKind] = useState<LoanKind>('ADVANCE');
  const [form, setForm] = useState(EMPTY);
  const [quote, setQuote] = useState<LoanQuote | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settle, setSettle] = useState({ spent: '', cashReturned: '0' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const receipts = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<LoanOptions>('/loans/options').then(setOptions).catch((e) => setError(e.message));
    api<LoanList>('/loans').then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // What the request would cost each month, as it is typed
  useEffect(() => {
    setQuote(null);
    if (kind === 'IOU' || !form.amount || Number(form.amount) <= 0) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ kind, amount: form.amount, ...(kind === 'LOAN' ? { product: form.product, months: form.months || '1' } : {}) });
      api<LoanQuote>(`/loans/quote?${q}`).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [kind, form.amount, form.product, form.months]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value, ...(key === 'neededOn' ? { settleBy: plusDays(e.target.value, 14) } : {}) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const body = {
        kind,
        amount: Number(form.amount),
        purpose: form.purpose,
        ...(kind === 'LOAN' ? { product: form.product, months: Number(form.months), guarantor: form.guarantor || undefined } : {}),
        ...(kind === 'IOU' ? { costCentre: form.costCentre || undefined, neededOn: form.neededOn, settleBy: form.settleBy } : {}),
      };
      const created = await api<Loan>('/loans', { method: 'POST', body });
      setNotice(`${created.title} request sent. It needs approval from ${created.stages.join(', then ')}.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(l: Loan) {
    if (!window.confirm(`Withdraw your ${l.title.toLowerCase()} request?`)) return;
    setError('');
    try {
      await api(`/loans/${l.id}/cancel`, { method: 'POST' });
      setNotice('Request withdrawn.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendSettlement(e: FormEvent, l: Loan) {
    e.preventDefault();
    setError('');
    const body = new FormData();
    body.append('spent', settle.spent || '0');
    body.append('cashReturned', settle.cashReturned || '0');
    const file = receipts.current?.files?.[0];
    if (file) body.append('file', file);
    setBusy(true);
    try {
      await api(`/loans/${l.id}/settle`, { method: 'POST', body });
      setNotice('Settlement sent to Finance.');
      setSettle({ spent: '', cashReturned: '0' });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cur = options?.currency ?? data?.employee.currency ?? 'KES';
  const product = options?.products.find((p) => p.product === form.product);
  const blocked = kind === 'LOAN' && !!options?.loanBlock;
  const noPayroll = kind !== 'IOU' && options && !options.hasPayroll;

  return (
    <>
      <h1>Advances and loans</h1>
      <p className="muted">Salary advances, staff loans and IOUs under the Staff Advances, Loans and IOUs policy (POL-22). Only you, Payroll, Finance and your approvers can see them.</p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {options && (
        <div className="grid">
          <div className="card stat">
            <div className="label">You owe now</div>
            <div className="value">{money(data?.outstanding ?? '0', cur)}</div>
            <div className="muted small">Advances, loans and IOUs being recovered</div>
          </div>
          {options.net && (
            <div className="card stat">
              <div className="label">Net pay (estimate)</div>
              <div className="value">{money(options.net, cur)}</div>
              <div className="muted small">{Number(options.commitments) > 0 ? `${money(options.commitments, cur)} a month already goes to loans and benefits` : 'Before any loan or benefit deductions'}</div>
            </div>
          )}
          {options.maxAdvance && (
            <div className="card stat">
              <div className="label">Largest advance</div>
              <div className="value">{money(options.maxAdvance, cur)}</div>
              <div className="muted small">Half of net pay, once in any 3 months</div>
            </div>
          )}
          {options.maxLoan && (
            <div className="card stat">
              <div className="label">Largest loan</div>
              <div className="value">{money(options.maxLoan, cur)}</div>
              <div className="muted small">3 times gross pay, up to {options.maxMonths} months</div>
            </div>
          )}
        </div>
      )}

      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Ask for money</h2>
        <div className="tabs" role="tablist">
          {KINDS.map((k) => (
            <button type="button" key={k.kind} role="tab" aria-selected={kind === k.kind} className={kind === k.kind ? 'active' : ''} onClick={() => setKind(k.kind)}>
              {k.label}
            </button>
          ))}
        </div>
        {kind === 'ADVANCE' && <p className="muted small">Recovered in full from your {options?.firstMonthLabel} salary, or from final dues if you leave. Approved by your manager, Payroll and Finance.</p>}
        {kind === 'LOAN' && <p className="muted small">For permanent staff after probation. Repaid by monthly payroll deduction; take-home pay must stay above a third of gross pay.</p>}
        {kind === 'IOU' && <p className="muted small">Cash for a business purchase. Settle it here with receipts within {options?.iouSettleDays ?? 14} days; anything unspent and not returned comes off your pay.</p>}
        {blocked && <div className="notice warn">{options!.loanBlock}</div>}
        {noPayroll && <div className="notice warn">Payroll for your company is not in the portal yet, so advances and loans cannot be recovered through it.</div>}

        <div className="form-grid">
          {kind === 'LOAN' && (
            <label>
              Loan type
              <select value={form.product} onChange={set('product')}>
                {options?.products.map((p) => <option key={p.product} value={p.product}>{p.label} ({p.yearlyRate ? `${p.yearlyRate}% a year` : 'interest-free'})</option>)}
              </select>
            </label>
          )}
          <label>Amount ({cur})<input type="number" required min={1} step="0.01" value={form.amount} onChange={set('amount')} /></label>
          {kind === 'LOAN' && <label>Repay over (months)<input type="number" required min={1} max={options?.maxMonths ?? 36} value={form.months} onChange={set('months')} /></label>}
          {kind === 'LOAN' && <label>Guarantor, if any (name and ID)<input value={form.guarantor} onChange={set('guarantor')} /></label>}
          {kind === 'IOU' && <label>Date needed<input type="date" required min={todayIso()} value={form.neededOn} onChange={set('neededOn')} /></label>}
          {kind === 'IOU' && <label>Settle by<input type="date" required min={form.neededOn} max={plusDays(form.neededOn, 14)} value={form.settleBy} onChange={set('settleBy')} /></label>}
          {kind === 'IOU' && <label>Cost centre or project code<input value={form.costCentre} onChange={set('costCentre')} /></label>}
        </div>
        <label>{kind === 'IOU' ? 'What it is for' : 'Reason'}<textarea rows={2} required minLength={3} value={form.purpose} onChange={set('purpose')} /></label>
        {kind === 'LOAN' && product && <p className="muted small">{product.label} loan: {product.note}.</p>}

        {quote && (
          <div className={`quote${quote.problems.length ? ' bad' : ''}`}>
            {quote.problems.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>{quote.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : (
              <>
                <strong>{money(quote.instalment, cur)}</strong>{' '}
                {quote.months > 1 ? `a month from ${quote.firstMonthLabel} to ${quote.lastMonthLabel}` : `from your ${quote.firstMonthLabel} pay`}
                {Number(quote.totalInterest) > 0 && <>, {money(quote.totalInterest, cur)} interest in total</>}.
                {quote.takeHome && <div className="muted small">Take-home pay after all deductions about {money(quote.takeHome, cur)} (it must stay above {money(quote.takeHomeFloor!, cur)}).</div>}
                <div className="muted small">Approved by {quote.stageLabels.join(', then ')}.</div>
              </>
            )}
          </div>
        )}
        <button type="submit" disabled={busy || blocked || !!noPayroll || (quote?.problems.length ?? 0) > 0}>Send request</button>
      </form>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your requests</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Request</th><th className="num">Amount</th><th className="num">Each month</th><th className="num">Still owed</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data?.loans.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td className="wrap">
                      {l.title}
                      <div className="muted small">{l.purpose} · {formatDate(l.createdAt)}</div>
                    </td>
                    <td className="num">{money(l.amount, l.currency)}</td>
                    <td className="num">{l.kind === 'IOU' && l.status !== 'CLOSED' && Number(l.outstanding) === 0 ? '' : money(l.instalment, l.currency)}</td>
                    <td className="num">{l.status === 'APPROVED' ? money(l.outstanding, l.currency) : ''}</td>
                    <td><span className={`badge ${l.status}`}>{loanStatus(l)}</span></td>
                    <td className="actions">
                      <button className="secondary small" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : l.canSettle ? 'Settle' : 'Details'}</button>
                      {l.canCancel && <> <button className="secondary small" onClick={() => cancel(l)}>Withdraw</button></>}
                    </td>
                  </tr>
                  {open === l.id && (
                    <tr>
                      <td colSpan={6}>
                        <LoanDetails loan={l} />
                        {l.canSettle && (
                          <form onSubmit={(e) => sendSettlement(e, l)} style={{ marginTop: '0.75rem' }}>
                            <h3>Settle this IOU</h3>
                            <p className="muted small">Due by {formatDate(l.settleBy)}. Attach the receipts; Finance checks them and anything not spent or returned comes off your next pay.</p>
                            <div className="form-grid">
                              <label>Amount spent ({l.currency})<input type="number" required min={0} step="0.01" value={settle.spent} onChange={(e) => setSettle({ ...settle, spent: e.target.value })} /></label>
                              <label>Cash returned ({l.currency})<input type="number" required min={0} step="0.01" value={settle.cashReturned} onChange={(e) => setSettle({ ...settle, cashReturned: e.target.value })} /></label>
                              <label>Receipts (PDF or photo)<input ref={receipts} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={Number(settle.spent) > 0} /></label>
                            </div>
                            <button type="submit" disabled={busy}>Send to Finance</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data && data.loans.length === 0 && <tr><td colSpan={6} className="muted">No advances, loans or IOUs yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {options && <p className="muted small">Rules {options.rulesVersion}, a draft for Finance to confirm.</p>}
      </section>
    </>
  );
}
