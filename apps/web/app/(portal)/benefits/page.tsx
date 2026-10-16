'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { BenefitBadge, LOCATION_LABEL, money, OCCASION_LABEL } from '@/components/MoneyBits';
import { Empty, ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { BenefitKind, BenefitPlan, Enrolment, Voucher, VoucherOccasion } from '@/lib/types';

interface Mine {
  currency: string;
  workLocation: string;
  moduleOn: boolean;
  firstMonth: string;
  firstMonthLabel: string;
  canNominate: boolean;
  enrolments: Enrolment[];
  vouchersReceived: Voucher[];
  vouchersNominated: Voucher[];
}

interface Nominee {
  id: string;
  name: string;
  employeeNumber: string;
  currency: string;
  entity: { code: string; name: string };
}

const EMPTY_VOUCHER = { employmentId: '', occasion: 'RECOGNITION' as VoucherOccasion, value: '', partner: '', reason: '' };
const KINDS: Array<{ kind: BenefitKind; title: string; intro: string }> = [
  { kind: 'MEAL', title: 'Meal vouchers', intro: 'A canteen wallet or meal card for on-site and hybrid staff, or a cash meal allowance for fully remote staff (form HR-F06). One meal option at a time.' },
  { kind: 'GYM', title: 'Gym membership', intro: 'Partner gyms with a company subsidy; your share comes off your pay each month (form HR-F07).' },
];

export default function BenefitsPage() {
  const { t, lang } = usePrefs();
  const { can } = useSession();
  const plans = useLoad(() => api<{ entity: { currency: string }; plans: BenefitPlan[] }>('/benefits/plans'), []);
  const mine = useLoad(() => api<Mine>('/benefits/mine'), []);
  const [chosen, setChosen] = useState<BenefitPlan | null>(null);
  const [enrol, setEnrol] = useState({ startMonth: '', dietaryNeeds: '', branch: '', emergencyContact: '' });
  const [search, setSearch] = useState('');
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [voucher, setVoucher] = useState(EMPTY_VOUCHER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hr = can('people.manage');
  const nominates = !!mine.data?.canNominate;
  const m = (v: string | null | undefined, c: string) => money(v, c, lang);

  useEffect(() => {
    if (!nominates) return;
    const timer = setTimeout(() => {
      api<Nominee[]>(`/benefits/nominees${search ? `?q=${encodeURIComponent(search)}` : ''}`)
        .then(setNominees)
        .catch(() => setNominees([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, nominates]);

  const reload = () => {
    plans.reload();
    mine.reload();
  };

  function choose(p: BenefitPlan) {
    setChosen(p);
    setEnrol((f) => ({ ...f, startMonth: f.startMonth || mine.data?.firstMonth || '' }));
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api('/benefits/enrolments', {
        method: 'POST',
        body: {
          planId: chosen.id,
          startMonth: enrol.startMonth,
          ...(chosen.kind === 'MEAL' ? { dietaryNeeds: enrol.dietaryNeeds || undefined } : { branch: enrol.branch || undefined, emergencyContact: enrol.emergencyContact }),
        },
      });
      setNotice(`Asked to join ${chosen.name}. HR and then Payroll approve it.`);
      setChosen(null);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function end(e: Enrolment) {
    const withdraw = e.status === 'PENDING' || !e.endsAtLabel;
    if (!window.confirm(withdraw ? `Withdraw your ${e.plan.name} request?` : `End ${e.plan.name}? It stops after ${e.endsAtLabel}.`)) return;
    setError(null);
    try {
      await api(`/benefits/enrolments/${e.id}/end`, { method: 'POST' });
      setNotice(withdraw ? 'Request withdrawn.' : `${e.plan.name} ends after ${e.endsAtLabel}.`);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function nominate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const v = await api<Voucher>('/benefits/vouchers', {
        method: 'POST',
        body: { ...voucher, value: Number(voucher.value), partner: voucher.partner || undefined, reason: voucher.reason || undefined },
      });
      setNotice(v.status === 'APPROVED' ? `Voucher issued to ${v.nominee}.` : `${v.nominee} nominated. Waiting for ${v.stageLabel}.`);
      setVoucher(EMPTY_VOUCHER);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelVoucher(v: Voucher) {
    if (!window.confirm(`Cancel the nomination for ${v.nominee}?`)) return;
    setError(null);
    try {
      await api(`/benefits/vouchers/${v.id}/cancel`, { method: 'POST' });
      setNotice('Nomination cancelled.');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const data = mine.data;
  const cur = data?.currency ?? plans.data?.entity.currency ?? 'USD';
  const nominee = nominees.find((n) => n.id === voucher.employmentId);
  const all = plans.data?.plans ?? [];

  return (
    <>
      <PageHead
        title={t('nav.benefits')}
        sub="Benefits in kind are taxed under your country's rules and shown on your payslip."
        actions={can('people.manage') || can('payroll.read') || can('finance.read') ? <Link href="/benefits/manage">{t('nav.benefitOptions')}</Link> : undefined}
      />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || mine.error || plans.error} />
      {data && !data.moduleOn && <div className="alert warn">Meal, gym and gift-voucher benefits are switched off for your company.</div>}

      {!plans.data || !data ? (
        <Loading />
      ) : (
        KINDS.map((k) => {
          const options = all.filter((p) => p.kind === k.kind);
          return (
            <section className="card" key={k.kind}>
              <h2>{k.title}</h2>
              <p className="muted">{k.intro}</p>
              {options.length === 0 ? (
                <Empty>Your company has no {k.title.toLowerCase()} options yet. HR adds them.</Empty>
              ) : (
                <div className="plans">
                  {options.map((p) => (
                    <div key={p.id} className={`plan${p.eligible ? '' : ' off'}`}>
                      <h3>{p.name}</h3>
                      <div className="muted small">{p.provider}</div>
                      {p.description && <p className="small">{p.description}</p>}
                      <div className="small">
                        {p.paidAsCash ? (
                          <>
                            Paid with your salary: <strong>{m(p.companyShare, p.currency)}</strong> a month, taxed
                          </>
                        ) : (
                          Number(p.companyShare) > 0 && (
                            <>
                              Company pays <strong>{m(p.companyShare, p.currency)}</strong> a month
                            </>
                          )
                        )}
                      </div>
                      {Number(p.employeeShare) > 0 && (
                        <div className="small">
                          You pay <strong>{m(p.employeeShare, p.currency)}</strong> a month from your pay
                        </div>
                      )}
                      {p.eligible ? (
                        data.moduleOn && (
                          <button type="button" className="btn secondary small" style={{ marginTop: '.5rem' }} onClick={() => choose(p)}>
                            Choose
                          </button>
                        )
                      ) : (
                        <div className="muted small" style={{ marginTop: '.5rem' }}>
                          For {p.workLocations.map((l) => LOCATION_LABEL[l].toLowerCase()).join(' and ')} staff
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {chosen?.kind === k.kind && (
                <form onSubmit={join} style={{ marginTop: '1rem' }}>
                  <h3>Join {chosen.name}</h3>
                  <div className="row">
                    <label className="field">
                      <span>Start from</span>
                      <input type="month" required min={data.firstMonth} value={enrol.startMonth} onChange={(e) => setEnrol({ ...enrol, startMonth: e.target.value })} />
                    </label>
                    {chosen.kind === 'MEAL' && (
                      <label className="field">
                        <span>Dietary needs (halal, kosher, vegetarian, allergies)</span>
                        <input value={enrol.dietaryNeeds} maxLength={200} onChange={(e) => setEnrol({ ...enrol, dietaryNeeds: e.target.value })} />
                      </label>
                    )}
                    {chosen.kind === 'GYM' && (
                      <label className="field">
                        <span>Branch</span>
                        <input value={enrol.branch} maxLength={120} onChange={(e) => setEnrol({ ...enrol, branch: e.target.value })} />
                      </label>
                    )}
                    {chosen.kind === 'GYM' && (
                      <label className="field">
                        <span>Emergency contact (name and phone)</span>
                        <input required value={enrol.emergencyContact} maxLength={160} onChange={(e) => setEnrol({ ...enrol, emergencyContact: e.target.value })} />
                      </label>
                    )}
                  </div>
                  <p className="muted small">
                    {chosen.kind === 'GYM'
                      ? "By joining you confirm you are fit to exercise, accept the gym's own terms, and agree to the monthly deduction for your share."
                      : 'Any taxable value is shown on your payslip.'}
                  </p>
                  <button className="btn" type="submit" disabled={busy}>
                    Send to HR
                  </button>{' '}
                  <button type="button" className="btn secondary" onClick={() => setChosen(null)}>
                    Cancel
                  </button>
                </form>
              )}
            </section>
          );
        })
      )}

      {data && (
        <section className="card">
          <h2>Your benefits</h2>
          {data.enrolments.length === 0 ? (
            <Empty>No meal or gym benefits yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Benefit</th>
                    <th>From</th>
                    <th className="num">Company pays</th>
                    <th className="num">You pay</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.enrolments.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.kindLabel}: {e.plan.name}
                        <div className="muted small">{[e.dietaryNeeds, e.branch].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{e.startLabel}</td>
                      <td className="num">{m(e.plan.companyShare, cur)}</td>
                      <td className="num">{Number(e.plan.employeeShare) > 0 ? m(e.plan.employeeShare, cur) : ''}</td>
                      <td>
                        <BenefitBadge r={e} />
                      </td>
                      <td>
                        {e.canEnd && (
                          <button className="btn secondary small" onClick={() => end(e)}>
                            {e.status === 'PENDING' || !e.endsAtLabel ? 'Withdraw' : 'End'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.vouchersReceived.length > 0 && (
            <>
              <h3>Gift vouchers you received</h3>
              <ul>
                {data.vouchersReceived.map((v) => (
                  <li key={v.id}>
                    {v.occasionLabel}: {m(v.value, v.currency)}
                    {v.partner ? ` for ${v.partner}` : ''}
                    {v.taxMonthLabel ? ` (on your ${v.taxMonthLabel} payslip)` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {nominates && data && (
        <section className="card">
          <h2>Nominate for a gift voucher</h2>
          <p className="muted">
            For birthdays, long service, festive seasons, recognition, weddings and new babies (form HR-F05).{' '}
            {hr ? 'Your nomination counts as the HR step; their manager approves if they have one.' : 'Your nomination counts as the manager step; HR then approves it.'}
          </p>
          <form onSubmit={nominate}>
            <div className="row">
              <label className="field">
                <span>Find a person</span>
                <input placeholder="Name or employee number" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <label className="field">
                <span>Person</span>
                <select required value={voucher.employmentId} onChange={(e) => setVoucher({ ...voucher, employmentId: e.target.value })}>
                  <option value="">Choose…</option>
                  {nominees.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.employeeNumber}, {n.entity.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Occasion</span>
                <select value={voucher.occasion} onChange={(e) => setVoucher({ ...voucher, occasion: e.target.value as VoucherOccasion })}>
                  {Object.entries(OCCASION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Value ({nominee?.currency ?? cur})</span>
                <input type="number" required min={1} step="0.01" value={voucher.value} onChange={(e) => setVoucher({ ...voucher, value: e.target.value })} />
              </label>
              <label className="field">
                <span>Partner or store</span>
                <input value={voucher.partner} maxLength={120} onChange={(e) => setVoucher({ ...voucher, partner: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Reason for recognition</span>
              <textarea rows={2} maxLength={500} value={voucher.reason} onChange={(e) => setVoucher({ ...voucher, reason: e.target.value })} />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              Nominate
            </button>
          </form>
          {data.vouchersNominated.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Occasion</th>
                    <th className="num">Value</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.vouchersNominated.map((v) => (
                    <tr key={v.id}>
                      <td>{v.nominee}</td>
                      <td>{v.occasionLabel}</td>
                      <td className="num">{m(v.value, v.currency)}</td>
                      <td>
                        <BenefitBadge r={v} issued="Issued" />
                      </td>
                      <td>
                        {v.canCancel && (
                          <button className="btn secondary small" onClick={() => cancelVoucher(v)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
