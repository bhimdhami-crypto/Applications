'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, BenefitKind, BenefitPlan, benefitStatus, Company, Employee, Enrolment, LOCATION_LABEL, money, Voucher } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Overview {
  company: { id: string; name: string; currency: string };
  year: number;
  monthlyCompanyCost: string;
  monthlyEmployeeShare: string;
  vouchersIssuedValue: string;
  enrolments: Enrolment[];
  vouchers: Voucher[];
}

const LOCATIONS = Object.keys(LOCATION_LABEL) as Employee['workLocation'][];
const EMPTY = { kind: 'GYM' as BenefitKind, name: '', provider: '', description: '', companyShare: '', employeeShare: '0', paidAsCash: false, workLocations: [] as Employee['workLocation'][] };

export default function ManageBenefitsPage() {
  const { me, can } = useSession();
  const isHr = can('HR');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [plans, setPlans] = useState<BenefitPlan[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [edits, setEdits] = useState<Record<string, { companyShare: string; employeeShare: string }>>({});
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<Company[]>('/companies').then((c) => {
      const list = c.filter((x) => x.countryCode !== 'US');
      setCompanies(list);
      setCompanyId((id) => id || list.find((x) => x.name === me.employee?.company.name)?.id || list[0]?.id || '');
    }).catch(() => setCompanies([]));
  }, [me.employee?.company.name]);

  const load = useCallback(() => {
    if (!companyId) return;
    api<BenefitPlan[]>(`/benefits/plans?companyId=${companyId}`).then(setPlans).catch((e) => setError(e.message));
    api<Overview>(`/benefits/overview?companyId=${companyId}`).then(setOverview).catch((e) => setError(e.message));
  }, [companyId]);
  useEffect(load, [load]);

  async function save(p: BenefitPlan, change: Partial<{ companyShare: number; employeeShare: number; active: boolean }>) {
    setError('');
    setNotice('');
    try {
      await api(`/benefits/plans/${p.id}`, { method: 'PATCH', body: change });
      setNotice(`${p.name} updated. New prices apply from the next payroll calculation.`);
      setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== p.id)));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api('/benefits/plans', {
        method: 'POST',
        body: { ...form, companyId, companyShare: Number(form.companyShare), employeeShare: Number(form.employeeShare), provider: form.provider || undefined, description: form.description || undefined },
      });
      setNotice(`${form.name} added.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function end(e: Enrolment) {
    if (!window.confirm(`End ${e.employee?.name}'s ${e.plan.name}?`)) return;
    try {
      await api(`/benefits/enrolments/${e.id}/end`, { method: 'POST' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const cur = overview?.company.currency ?? companies.find((c) => c.id === companyId)?.currency ?? 'KES';

  return (
    <>
      <h1>Benefit options</h1>
      <div className="toolbar">
        <label>
          Company
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Link href="/benefits" style={{ alignSelf: 'center' }}>Back to Benefits</Link>
      </div>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {overview && (
        <div className="grid">
          <div className="card stat"><div className="label">Company cost each month</div><div className="value">{money(overview.monthlyCompanyCost, cur)}</div><div className="muted small">Meal and gym, running now</div></div>
          <div className="card stat"><div className="label">Staff shares each month</div><div className="value">{money(overview.monthlyEmployeeShare, cur)}</div><div className="muted small">Deducted from pay</div></div>
          <div className="card stat"><div className="label">Gift vouchers in {overview.year}</div><div className="value">{money(overview.vouchersIssuedValue, cur)}</div><div className="muted small">{overview.vouchers.filter((v) => v.status === 'APPROVED').length} issued</div></div>
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Meal and gym options</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Option</th><th>Who can join</th><th className="num">Company pays</th><th className="num">Employee pays</th><th>Offered</th>{isHr && <th />}</tr></thead>
            <tbody>
              {plans.map((p) => {
                const edit = edits[p.id];
                return (
                  <tr key={p.id}>
                    <td>{p.kindLabel}: {p.name}<div className="muted small">{p.paidAsCash ? 'Paid as cash with salary' : p.provider}</div></td>
                    <td className="small">{p.workLocations.length ? p.workLocations.map((l) => LOCATION_LABEL[l]).join(', ') : 'Everyone'}</td>
                    <td className="num">
                      {edit ? <input type="number" min={0} step="0.01" value={edit.companyShare} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, companyShare: e.target.value } })} /> : money(p.companyShare, cur)}
                    </td>
                    <td className="num">
                      {edit && !p.paidAsCash ? <input type="number" min={0} step="0.01" value={edit.employeeShare} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, employeeShare: e.target.value } })} /> : money(p.employeeShare, cur)}
                    </td>
                    <td>{p.active ? 'Yes' : 'No'}</td>
                    {isHr && (
                      <td className="actions">
                        {edit ? (
                          <button className="small" onClick={() => save(p, { companyShare: Number(edit.companyShare), employeeShare: Number(edit.employeeShare) })}>Save</button>
                        ) : (
                          <button className="secondary small" onClick={() => setEdits({ ...edits, [p.id]: { companyShare: p.companyShare, employeeShare: p.employeeShare } })}>Change price</button>
                        )}{' '}
                        <button className="secondary small" onClick={() => save(p, { active: !p.active })}>{p.active ? 'Stop offering' : 'Offer again'}</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {plans.length === 0 && <tr><td colSpan={isHr ? 6 : 5} className="muted">No options for this company yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {isHr && (
          <form onSubmit={add} style={{ marginTop: '1rem' }}>
            <h3>Add an option</h3>
            <div className="form-grid">
              <label>
                Type
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BenefitKind, paidAsCash: false })}>
                  <option value="MEAL">Meal voucher</option>
                  <option value="GYM">Gym membership</option>
                </select>
              </label>
              <label>Name<input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Provider<input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></label>
              <label>Company pays a month ({cur})<input type="number" required min={0} step="0.01" value={form.companyShare} onChange={(e) => setForm({ ...form, companyShare: e.target.value })} /></label>
              {!form.paidAsCash && <label>Employee pays a month ({cur})<input type="number" required min={0} step="0.01" value={form.employeeShare} onChange={(e) => setForm({ ...form, employeeShare: e.target.value })} /></label>}
              {form.kind === 'MEAL' && (
                <div className="checks" style={{ alignSelf: 'end' }}>
                  <label><input type="checkbox" checked={form.paidAsCash} onChange={(e) => setForm({ ...form, paidAsCash: e.target.checked })} /> Paid as a cash allowance with salary</label>
                </div>
              )}
            </div>
            <p className="small" style={{ marginBottom: '0.25rem' }}>Who can join (none ticked means everyone)</p>
            <div className="checks" style={{ marginBottom: '0.75rem' }}>
              {LOCATIONS.map((l) => (
                <label key={l}>
                  <input type="checkbox" checked={form.workLocations.includes(l)} onChange={(e) => setForm({ ...form, workLocations: e.target.checked ? [...form.workLocations, l] : form.workLocations.filter((x) => x !== l) })} /> {LOCATION_LABEL[l]}
                </label>
              ))}
            </div>
            <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <button type="submit">Add option</button>
          </form>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Members</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Benefit</th><th>From</th><th>Status</th>{isHr && <th />}</tr></thead>
            <tbody>
              {overview?.enrolments.map((e) => (
                <tr key={e.id}>
                  <td>{e.employee?.name}<div className="muted small">{e.employee?.employeeNo}</div></td>
                  <td>{e.kindLabel}: {e.plan.name}<div className="muted small">{[e.dietaryNeeds, e.branch].filter(Boolean).join(' · ')}</div></td>
                  <td>{e.startLabel}</td>
                  <td><span className={`badge ${e.status}`}>{benefitStatus(e)}</span></td>
                  {isHr && <td className="actions">{e.status === 'APPROVED' && !e.endLabel && <button className="secondary small" onClick={() => end(e)}>End</button>}</td>}
                </tr>
              ))}
              {overview && overview.enrolments.length === 0 && <tr><td colSpan={isHr ? 5 : 4} className="muted">Nobody has joined yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Gift vouchers in {overview?.year}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Occasion</th><th className="num">Value</th><th>Payslip month</th><th>Status</th></tr></thead>
            <tbody>
              {overview?.vouchers.map((v) => (
                <tr key={v.id}>
                  <td>{v.nominee}</td>
                  <td>{v.occasionLabel}<div className="muted small">{v.reason}</div></td>
                  <td className="num">{money(v.value, v.currency)}</td>
                  <td>{v.taxMonthLabel ?? ''}</td>
                  <td><span className={`badge ${v.status}`}>{benefitStatus(v, 'Issued')}</span></td>
                </tr>
              ))}
              {overview && overview.vouchers.length === 0 && <tr><td colSpan={5} className="muted">No vouchers this year.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
