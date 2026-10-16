'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Fragment, Suspense, useEffect, useRef, useState } from 'react';
import { DraftPackNote, LoanBadge, LoanDetails, money } from '@/components/MoneyBits';
import { Empty, ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, apiUpload } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { Loan, LoanKind, LoanOptions, LoanProduct, LoanQuote, RulePackInfo } from '@/lib/types';

interface LoanList {
  rulePack: RulePackInfo;
  employee: { id: string; name: string; employeeNumber: string; currency: string };
  outstanding: string;
  loans: Loan[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const empty = () => ({ amount: '', months: '12', product: 'PERSONAL' as LoanProduct, purpose: '', guarantor: '', costCentre: '', neededOn: todayIso(), settleBy: plusDays(todayIso(), 14) });
const KINDS: Array<{ kind: LoanKind; label: string }> = [
  { kind: 'ADVANCE', label: 'Salary advance' },
  { kind: 'LOAN', label: 'Staff loan' },
  { kind: 'IOU', label: 'IOU (cash for a business purchase)' },
];

function MoneyPage() {
  const { t, lang } = usePrefs();
  const employmentId = useSearchParams().get('employee') ?? undefined;
  const q = employmentId ? `?employmentId=${employmentId}` : '';
  const options = useLoad(() => api<LoanOptions>('/loans/options'), []);
  const list = useLoad(() => api<LoanList>(`/loans${q}`), [q]);
  const [kind, setKind] = useState<LoanKind>('ADVANCE');
  const [form, setForm] = useState(empty);
  const [quote, setQuote] = useState<LoanQuote | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settle, setSettle] = useState({ spent: '', cashReturned: '0' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const receipts = useRef<HTMLInputElement>(null);

  // Someone else's record, opened from the loan book: read only
  const own = !employmentId;
  const opts = options.data;

  // What the request would cost each month, as it is typed
  useEffect(() => {
    setQuote(null);
    if (!own || kind === 'IOU' || !form.amount || Number(form.amount) <= 0) return;
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ kind, amount: form.amount, ...(kind === 'LOAN' ? { product: form.product, months: form.months || '1' } : {}) });
      api<LoanQuote>(`/loans/quote?${p}`).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [own, kind, form.amount, form.product, form.months]);

  const set = (key: keyof ReturnType<typeof empty>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value, ...(key === 'neededOn' ? { settleBy: plusDays(e.target.value, 14) } : {}) });

  const reload = () => {
    options.reload();
    list.reload();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
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
      setForm(empty());
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(l: Loan) {
    if (!window.confirm(`Withdraw your ${l.title.toLowerCase()} request?`)) return;
    setError(null);
    try {
      await api(`/loans/${l.id}/cancel`, { method: 'POST' });
      setNotice('Request withdrawn.');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendSettlement(e: FormEvent, l: Loan) {
    e.preventDefault();
    setError(null);
    const body = new FormData();
    body.append('spent', settle.spent || '0');
    body.append('cashReturned', settle.cashReturned || '0');
    const file = receipts.current?.files?.[0];
    if (file) body.append('file', file);
    setBusy(true);
    try {
      await apiUpload(`/loans/${l.id}/settle`, body);
      setNotice('Settlement sent to Finance.');
      setSettle({ spent: '', cashReturned: '0' });
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const data = list.data;
  const cur = data?.employee.currency ?? opts?.currency ?? 'USD';
  const product = opts?.products.find((p) => p.product === form.product);
  const blocked = kind === 'LOAN' && !!opts?.loanBlock;
  const noPayroll = kind !== 'IOU' && !!opts && !opts.hasPayroll;
  const m = (v: string | null | undefined, c = cur) => money(v, c, lang);

  return (
    <>
      <PageHead
        title={own ? t('nav.myMoney') : `Advances and loans: ${data?.employee.name ?? ''}`}
        crumbs={own ? undefined : <Link href="/money/book">{t('nav.loanBook')}</Link>}
        sub={own ? 'Salary advances, staff loans and IOUs. Only you, Payroll, Finance and your approvers can see them.' : data ? `${data.employee.employeeNumber}` : undefined}
      />
      <DraftPackNote pack={data?.rulePack ?? opts?.rulePack} extra="Limits and repayments are a guide until Finance in each country signs the rules off." />
      {opts?.payrollPack && !opts.payrollPack.verified && own && (
        <div className="alert warn" role="note">
          Net pay below comes from draft payroll rules ({opts.payrollPack.version}) that no one has verified yet. It is an estimate, not a payslip.
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || list.error || (own ? options.error : null)} />

      {own && opts && (
        <div className="grid stats">
          <div className="card stat">
            <div className="label">You owe now</div>
            <div className="value money">{m(data?.outstanding ?? '0')}</div>
            <div className="muted small">Advances, loans and IOUs being recovered</div>
          </div>
          {opts.net && (
            <div className="card stat">
              <div className="label">Net pay (estimate)</div>
              <div className="value money">{m(opts.net)}</div>
              <div className="muted small">{Number(opts.commitments) > 0 ? `${m(opts.commitments)} a month already goes to loans and benefits` : 'Before any loan or benefit deductions'}</div>
            </div>
          )}
          {opts.maxAdvance && (
            <div className="card stat">
              <div className="label">Largest advance</div>
              <div className="value money">{m(opts.maxAdvance)}</div>
              <div className="muted small">Half of net pay, once in any 3 months</div>
            </div>
          )}
          {opts.maxLoan && (
            <div className="card stat">
              <div className="label">Largest loan</div>
              <div className="value money">{m(opts.maxLoan)}</div>
              <div className="muted small">3 times gross pay, up to {opts.maxMonths} months</div>
            </div>
          )}
        </div>
      )}

      {own && opts && (
        <form className="card" onSubmit={submit}>
          <h2>Ask for money</h2>
          <div className="tabs" role="tablist">
            {KINDS.map((k) => (
              <button type="button" key={k.kind} role="tab" aria-selected={kind === k.kind} onClick={() => setKind(k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
          {kind === 'ADVANCE' && <p className="muted">Recovered in full from your {opts.firstMonthLabel} salary, or from final dues if you leave. Approved by your manager, Payroll and Finance.</p>}
          {kind === 'LOAN' && <p className="muted">For permanent staff after probation. Repaid by monthly payroll deduction; take-home pay must stay above a third of gross pay.</p>}
          {kind === 'IOU' && <p className="muted">Cash for a business purchase. Settle it here with receipts within {opts.iouSettleDays} days; anything unspent and not returned comes off your pay.</p>}
          {blocked && <div className="alert warn">{opts.loanBlock}</div>}
          {noPayroll && <div className="alert warn">Payroll rules for your country are not in the portal yet, so advances and loans cannot be recovered through it. IOUs still work.</div>}

          <div className="row">
            {kind === 'LOAN' && (
              <label className="field">
                <span>Loan type</span>
                <select value={form.product} onChange={set('product')}>
                  {opts.products.map((p) => (
                    <option key={p.product} value={p.product}>
                      {p.label} ({p.yearlyRate ? `${p.yearlyRate}% a year` : 'interest-free'})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Amount ({cur})</span>
              <input type="number" required min={1} step="0.01" value={form.amount} onChange={set('amount')} />
            </label>
            {kind === 'LOAN' && (
              <label className="field">
                <span>Repay over (months)</span>
                <input type="number" required min={1} max={opts.maxMonths} value={form.months} onChange={set('months')} />
              </label>
            )}
            {kind === 'LOAN' && (
              <label className="field">
                <span>Guarantor, if any (name and staff number)</span>
                <input value={form.guarantor} onChange={set('guarantor')} maxLength={120} />
              </label>
            )}
            {kind === 'IOU' && (
              <label className="field">
                <span>Date needed</span>
                <input type="date" required min={todayIso()} value={form.neededOn} onChange={set('neededOn')} />
              </label>
            )}
            {kind === 'IOU' && (
              <label className="field">
                <span>Settle by</span>
                <input type="date" required min={form.neededOn} max={plusDays(form.neededOn, opts.iouSettleDays)} value={form.settleBy} onChange={set('settleBy')} />
              </label>
            )}
            {kind === 'IOU' && (
              <label className="field">
                <span>Cost centre or project code</span>
                <input value={form.costCentre} onChange={set('costCentre')} maxLength={40} />
              </label>
            )}
          </div>
          <label className="field">
            <span>{kind === 'IOU' ? 'What it is for' : 'Reason'}</span>
            <textarea rows={2} required minLength={3} maxLength={500} value={form.purpose} onChange={set('purpose')} />
          </label>
          {kind === 'LOAN' && product && (
            <p className="muted">
              {product.label} loan: {product.note}.
            </p>
          )}

          {quote && (
            <div className={`quote${quote.problems.length ? ' bad' : ''}`} aria-live="polite">
              {quote.problems.length > 0 ? (
                <ul style={{ margin: 0, paddingInlineStart: '1rem' }}>
                  {quote.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <>
                  <strong>{m(quote.instalment)}</strong> {quote.months > 1 ? `a month from ${quote.firstMonthLabel} to ${quote.lastMonthLabel}` : `from your ${quote.firstMonthLabel} pay`}
                  {Number(quote.totalInterest) > 0 && <>, {m(quote.totalInterest)} interest in total</>}.
                  {quote.takeHome && (
                    <div className="muted small">
                      Take-home pay after all deductions about {m(quote.takeHome)} (it must stay above {m(quote.takeHomeFloor)}).
                    </div>
                  )}
                  <div className="muted small">Approved by {quote.stageLabels.join(', then ')}.</div>
                </>
              )}
            </div>
          )}
          <button className="btn" type="submit" disabled={busy || blocked || noPayroll || (quote?.problems.length ?? 0) > 0}>
            Send request
          </button>
        </form>
      )}

      <section className="card">
        <h2>{own ? 'Your requests' : 'Requests'}</h2>
        {!data ? (
          <Loading />
        ) : data.loans.length === 0 ? (
          <Empty>No advances, loans or IOUs yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th className="num">Amount</th>
                  <th className="num">Each month</th>
                  <th className="num">Still owed</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.loans.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td>
                        {l.title}
                        <div className="muted small">
                          {l.purpose} · {fmtDate(l.createdAt, lang)}
                        </div>
                      </td>
                      <td className="num">{m(l.amount, l.currency)}</td>
                      <td className="num">{l.kind === 'IOU' ? '' : m(l.instalment, l.currency)}</td>
                      <td className="num">{l.status === 'APPROVED' ? m(l.outstanding, l.currency) : ''}</td>
                      <td>
                        <LoanBadge loan={l} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn secondary small" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                          {open === l.id ? 'Hide' : own && l.canSettle ? 'Settle' : 'Details'}
                        </button>{' '}
                        {own && l.canCancel && (
                          <button className="btn secondary small" onClick={() => cancel(l)}>
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <td colSpan={6}>
                          <LoanDetails loan={l} lang={lang} />
                          {own && l.canSettle && (
                            <form onSubmit={(e) => sendSettlement(e, l)} style={{ marginTop: '.75rem' }}>
                              <h3>Settle this IOU</h3>
                              <p className="muted small">Due by {fmtDate(l.settleBy, lang)}. Attach the receipts; Finance checks them and anything not spent or returned comes off your next pay.</p>
                              <div className="row">
                                <label className="field">
                                  <span>Amount spent ({l.currency})</span>
                                  <input type="number" required min={0} step="0.01" value={settle.spent} onChange={(e) => setSettle({ ...settle, spent: e.target.value })} />
                                </label>
                                <label className="field">
                                  <span>Cash returned ({l.currency})</span>
                                  <input type="number" required min={0} step="0.01" value={settle.cashReturned} onChange={(e) => setSettle({ ...settle, cashReturned: e.target.value })} />
                                </label>
                                <label className="field">
                                  <span>Receipts (PDF or photo)</span>
                                  <input ref={receipts} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={Number(settle.spent) > 0} />
                                </label>
                              </div>
                              <button className="btn" type="submit" disabled={busy}>
                                Send to Finance
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MoneyPage />
    </Suspense>
  );
}
