'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, BenefitPlan, benefitStatus, Enrolment, LOCATION_LABEL, money, OCCASION_LABEL, Voucher, VoucherOccasion } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Mine {
  currency: string;
  workLocation: string;
  firstMonth: string;
  firstMonthLabel: string;
  enrolments: Enrolment[];
  vouchersReceived: Voucher[];
  vouchersNominated: Voucher[];
}

interface Nominee {
  id: string;
  name: string;
  employeeNo: string;
  jobTitle: string;
  currency: string;
}

const EMPTY_VOUCHER = { employeeId: '', occasion: 'RECOGNITION' as VoucherOccasion, value: '', partner: '', reason: '' };

export default function BenefitsPage() {
  const { me, can } = useSession();
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [chosen, setChosen] = useState<BenefitPlan | null>(null);
  const [enrol, setEnrol] = useState({ startMonth: '', dietaryNeeds: '', branch: '', emergencyContact: '' });
  const [search, setSearch] = useState('');
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [voucher, setVoucher] = useState(EMPTY_VOUCHER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const nominates = can('HR', 'MANAGER');

  const load = useCallback(() => {
    api<BenefitPlan[]>('/benefits/plans').then(setPlans).catch((e) => setError(e.message));
    api<Mine>('/benefits/mine').then((m) => {
      setMine(m);
      setEnrol((f) => ({ ...f, startMonth: f.startMonth || m.firstMonth }));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!nominates) return;
    const t = setTimeout(() => {
      api<Nominee[]>(`/benefits/nominees${search ? `?q=${encodeURIComponent(search)}` : ''}`).then(setNominees).catch(() => setNominees([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, nominates]);

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setError('');
    setNotice('');
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
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function end(e: Enrolment) {
    const message = e.status === 'PENDING' || !e.endsAtLabel ? `Withdraw your ${e.plan.name} request?` : `End ${e.plan.name}? It stops after ${e.endsAtLabel}.`;
    if (!window.confirm(message)) return;
    setError('');
    try {
      await api(`/benefits/enrolments/${e.id}/end`, { method: 'POST' });
      setNotice(e.status === 'PENDING' || !e.endsAtLabel ? 'Request withdrawn.' : `${e.plan.name} ends after ${e.endsAtLabel}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function nominate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const v = await api<Voucher>('/benefits/vouchers', {
        method: 'POST',
        body: { ...voucher, value: Number(voucher.value), partner: voucher.partner || undefined, reason: voucher.reason || undefined },
      });
      setNotice(v.status === 'APPROVED' ? `Voucher issued to ${v.nominee}.` : `${v.nominee} nominated. ${benefitStatus(v)}.`);
      setVoucher(EMPTY_VOUCHER);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelVoucher(v: Voucher) {
    if (!window.confirm(`Cancel the nomination for ${v.nominee}?`)) return;
    try {
      await api(`/benefits/vouchers/${v.id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const cur = mine?.currency ?? me.employee?.company.currency ?? 'KES';
  const nominee = nominees.find((n) => n.id === voucher.employeeId);
  const kinds: Array<{ kind: BenefitPlan['kind']; title: string; intro: string }> = [
    { kind: 'MEAL', title: 'Meal vouchers', intro: 'A canteen wallet or meal card for on-site and hybrid staff, or a cash meal allowance for fully remote staff (form HR-F06). One meal option at a time.' },
    { kind: 'GYM', title: 'Gym membership', intro: 'Partner gyms with a company subsidy; your share comes off your pay each month (form HR-F07).' },
  ];

  return (
    <>
      <div className="section-head">
        <h1>Benefits</h1>
        {can('HR', 'PAYROLL', 'FINANCE') && <Link href="/benefits/manage">Manage benefit options</Link>}
      </div>
      <p className="muted">Benefits in kind are taxed according to your country&apos;s rules and shown on your payslip.</p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {me.employee && kinds.map((k) => (
        <section className="card" key={k.kind}>
          <h2 style={{ marginTop: 0 }}>{k.title}</h2>
          <p className="muted small">{k.intro}</p>
          <div className="plans">
            {plans.filter((p) => p.kind === k.kind).map((p) => (
              <div key={p.id} className={`plan${p.eligible ? '' : ' off'}`}>
                <h3>{p.name}</h3>
                <div className="muted small">{p.provider}</div>
                {p.description && <p className="small">{p.description}</p>}
                <div className="small">
                  {p.paidAsCash ? <>Paid with your salary: <strong>{money(p.companyShare, p.currency)}</strong> a month, taxed</> : Number(p.companyShare) > 0 && <>Company pays <strong>{money(p.companyShare, p.currency)}</strong> a month</>}
                </div>
                {Number(p.employeeShare) > 0 && <div className="small">You pay <strong>{money(p.employeeShare, p.currency)}</strong> a month from your pay</div>}
                {p.eligible ? (
                  <button type="button" className="secondary small" style={{ marginTop: '0.5rem' }} onClick={() => setChosen(p)}>Choose</button>
                ) : (
                  <div className="muted small" style={{ marginTop: '0.5rem' }}>For {p.workLocations.map((l) => LOCATION_LABEL[l].toLowerCase()).join(' and ')} staff</div>
                )}
              </div>
            ))}
            {plans.filter((p) => p.kind === k.kind).length === 0 && <p className="muted">Your company has no {k.title.toLowerCase()} options yet.</p>}
          </div>
          {chosen?.kind === k.kind && (
            <form onSubmit={join} style={{ marginTop: '1rem' }}>
              <h3>Join {chosen.name}</h3>
              <div className="form-grid">
                <label>Start from<input type="month" required min={mine?.firstMonth} value={enrol.startMonth} onChange={(e) => setEnrol({ ...enrol, startMonth: e.target.value })} /></label>
                {chosen.kind === 'MEAL' && <label>Dietary needs (halal, kosher, vegetarian, allergies)<input value={enrol.dietaryNeeds} onChange={(e) => setEnrol({ ...enrol, dietaryNeeds: e.target.value })} /></label>}
                {chosen.kind === 'GYM' && <label>Branch<input value={enrol.branch} onChange={(e) => setEnrol({ ...enrol, branch: e.target.value })} /></label>}
                {chosen.kind === 'GYM' && <label>Emergency contact (name and phone)<input required value={enrol.emergencyContact} onChange={(e) => setEnrol({ ...enrol, emergencyContact: e.target.value })} /></label>}
              </div>
              {chosen.kind === 'GYM' && <p className="muted small">By joining you confirm you are fit to exercise, accept the gym&apos;s own terms, and agree to the monthly deduction for your share.</p>}
              {chosen.kind === 'MEAL' && <p className="muted small">Any taxable value is shown on your payslip.</p>}
              <button type="submit" disabled={busy}>Send to HR</button>{' '}
              <button type="button" className="secondary" onClick={() => setChosen(null)}>Cancel</button>
            </form>
          )}
        </section>
      ))}

      {me.employee && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Your benefits</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Benefit</th><th>From</th><th className="num">Company pays</th><th className="num">You pay</th><th>Status</th><th /></tr></thead>
              <tbody>
                {mine?.enrolments.map((e) => (
                  <tr key={e.id}>
                    <td>{e.kindLabel}: {e.plan.name}<div className="muted small">{[e.dietaryNeeds, e.branch].filter(Boolean).join(' · ')}</div></td>
                    <td>{e.startLabel}</td>
                    <td className="num">{money(e.plan.companyShare, cur)}</td>
                    <td className="num">{Number(e.plan.employeeShare) > 0 ? money(e.plan.employeeShare, cur) : ''}</td>
                    <td><span className={`badge ${e.status}`}>{benefitStatus(e)}</span></td>
                    <td className="actions">{e.canEnd && <button className="secondary small" onClick={() => end(e)}>{e.status === 'PENDING' || !e.endsAtLabel ? 'Withdraw' : 'End'}</button>}</td>
                  </tr>
                ))}
                {mine && mine.enrolments.length === 0 && <tr><td colSpan={6} className="muted">No meal or gym benefits yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {mine && mine.vouchersReceived.length > 0 && (
            <>
              <h3>Gift vouchers you received</h3>
              <ul>
                {mine.vouchersReceived.map((v) => (
                  <li key={v.id}>{v.occasionLabel}: {money(v.value, v.currency)}{v.partner ? ` for ${v.partner}` : ''}{v.taxMonthLabel ? ` (on your ${v.taxMonthLabel} payslip)` : ''}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {nominates && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Nominate for a gift voucher</h2>
          <p className="muted small">For birthdays, long service, festive seasons, recognition, weddings and new babies (form HR-F05). {can('HR') ? 'Your nomination counts as the HR approval; the manager approves if the person has one.' : 'Your nomination counts as the manager approval; HR then approves it.'}</p>
          <form onSubmit={nominate}>
            <div className="form-grid">
              <label>Find a person<input placeholder="Name or employee number" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              <label>
                Person
                <select required value={voucher.employeeId} onChange={(e) => setVoucher({ ...voucher, employeeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {nominees.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.employeeNo}), {n.jobTitle}</option>)}
                </select>
              </label>
              <label>
                Occasion
                <select value={voucher.occasion} onChange={(e) => setVoucher({ ...voucher, occasion: e.target.value as VoucherOccasion })}>
                  {Object.entries(OCCASION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>Value ({nominee?.currency ?? cur})<input type="number" required min={1} step="0.01" value={voucher.value} onChange={(e) => setVoucher({ ...voucher, value: e.target.value })} /></label>
              <label>Partner or store<input value={voucher.partner} onChange={(e) => setVoucher({ ...voucher, partner: e.target.value })} /></label>
            </div>
            <label>Reason for recognition<textarea rows={2} value={voucher.reason} onChange={(e) => setVoucher({ ...voucher, reason: e.target.value })} /></label>
            <button type="submit" disabled={busy}>Nominate</button>
          </form>
          {mine && mine.vouchersNominated.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table>
                <thead><tr><th>Person</th><th>Occasion</th><th className="num">Value</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {mine.vouchersNominated.map((v) => (
                    <tr key={v.id}>
                      <td>{v.nominee}</td>
                      <td>{v.occasionLabel}</td>
                      <td className="num">{money(v.value, v.currency)}</td>
                      <td><span className={`badge ${v.status}`}>{benefitStatus(v, 'Issued')}</span></td>
                      <td className="actions">{v.canCancel && <button className="secondary small" onClick={() => cancelVoucher(v)}>Cancel</button>}</td>
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
