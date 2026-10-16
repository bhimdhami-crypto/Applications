'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { BenefitBadge, LOCATION_LABEL, money } from '@/components/MoneyBits';
import { Empty, ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { BenefitKind, BenefitPlan, Enrolment, Voucher, WorkLocation } from '@/lib/types';

interface Overview {
  entity: { id: string; name: string; currency: string };
  year: number;
  monthlyCompanyCost: string;
  monthlyEmployeeShare: string;
  vouchersIssuedValue: string;
  enrolments: Enrolment[];
  vouchers: Voucher[];
}

const LOCATIONS = Object.keys(LOCATION_LABEL) as WorkLocation[];
const EMPTY = { kind: 'GYM' as BenefitKind, name: '', provider: '', description: '', companyShare: '', employeeShare: '0', paidAsCash: false, workLocations: [] as WorkLocation[] };

/** Meal and gym options for a company, who has joined, and the year's gift vouchers. HR changes options; Payroll and Finance read. */
export default function ManageBenefitsPage() {
  const { t, lang } = usePrefs();
  const { me, can, entityId: switched } = useSession();
  const companies = me.entities.filter((e) => can('people.manage', e.id) || can('payroll.read', e.id) || can('finance.read', e.id));
  const [entityId, setEntityId] = useState(switched && companies.some((c) => c.id === switched) ? switched : (companies[0]?.id ?? ''));
  const plans = useLoad(() => (entityId ? api<{ canEdit: boolean; plans: BenefitPlan[] }>(`/benefits/plans?entityId=${entityId}`) : Promise.resolve(null)), [entityId]);
  const overview = useLoad(() => (entityId ? api<Overview>(`/benefits/overview?entityId=${entityId}`) : Promise.resolve(null)), [entityId]);
  const [edits, setEdits] = useState<Record<string, { companyShare: string; employeeShare: string }>>({});
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isHr = !!plans.data?.canEdit;
  const cur = overview.data?.entity.currency ?? companies.find((c) => c.id === entityId)?.functionalCurrency ?? 'USD';
  const m = (v: string | null | undefined, c = cur) => money(v, c, lang);

  const reload = () => {
    plans.reload();
    overview.reload();
  };

  async function save(p: BenefitPlan, change: Partial<{ companyShare: number; employeeShare: number; active: boolean }>) {
    setError(null);
    setNotice(null);
    try {
      await api(`/benefits/plans/${p.id}`, { method: 'PATCH', body: change });
      setNotice(`${p.name} updated. New prices apply from the next payroll calculation.`);
      setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== p.id)));
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api('/benefits/plans', {
        method: 'POST',
        body: {
          ...form,
          entityId,
          companyShare: Number(form.companyShare),
          employeeShare: Number(form.employeeShare),
          provider: form.provider || undefined,
          description: form.description || undefined,
        },
      });
      setNotice(`${form.name} added.`);
      setForm(EMPTY);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function end(e: Enrolment) {
    if (!window.confirm(`End ${e.employee?.name}'s ${e.plan.name}?`)) return;
    setError(null);
    try {
      await api(`/benefits/enrolments/${e.id}/end`, { method: 'POST' });
      setNotice(`${e.employee?.name}'s ${e.plan.name} ended.`);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const o = overview.data;

  return (
    <>
      <PageHead
        title={t('nav.benefitOptions')}
        crumbs={<Link href="/benefits">{t('nav.benefits')}</Link>}
        actions={
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Company</span>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || plans.error || overview.error} />

      {o && (
        <div className="grid stats">
          <div className="card stat">
            <div className="label">Company cost each month</div>
            <div className="value money">{m(o.monthlyCompanyCost)}</div>
            <div className="muted small">Meal and gym, running now</div>
          </div>
          <div className="card stat">
            <div className="label">Staff shares each month</div>
            <div className="value money">{m(o.monthlyEmployeeShare)}</div>
            <div className="muted small">Deducted from pay</div>
          </div>
          <div className="card stat">
            <div className="label">Gift vouchers in {o.year}</div>
            <div className="value money">{m(o.vouchersIssuedValue)}</div>
            <div className="muted small">{o.vouchers.filter((v) => v.status === 'APPROVED').length} issued</div>
          </div>
        </div>
      )}

      <section className="card">
        <h2>Meal and gym options</h2>
        {!plans.data ? (
          <Loading />
        ) : plans.data.plans.length === 0 ? (
          <Empty>No options for this company yet.{isHr ? ' Add one below.' : ''}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Who can join</th>
                  <th className="num">Company pays</th>
                  <th className="num">Employee pays</th>
                  <th>Offered</th>
                  {isHr && <th />}
                </tr>
              </thead>
              <tbody>
                {plans.data.plans.map((p) => {
                  const edit = edits[p.id];
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.kindLabel}: {p.name}
                        <div className="muted small">{p.paidAsCash ? 'Paid as cash with salary' : p.provider}</div>
                      </td>
                      <td className="small">{p.workLocations.length ? p.workLocations.map((l) => LOCATION_LABEL[l]).join(', ') : 'Everyone'}</td>
                      <td className="num">
                        {edit ? (
                          <input aria-label={`Company share for ${p.name}`} type="number" min={0} step="0.01" value={edit.companyShare} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, companyShare: e.target.value } })} style={{ width: '8rem' }} />
                        ) : (
                          m(p.companyShare)
                        )}
                      </td>
                      <td className="num">
                        {edit && !p.paidAsCash ? (
                          <input aria-label={`Employee share for ${p.name}`} type="number" min={0} step="0.01" value={edit.employeeShare} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, employeeShare: e.target.value } })} style={{ width: '8rem' }} />
                        ) : (
                          m(p.employeeShare)
                        )}
                      </td>
                      <td>{p.active ? 'Yes' : 'No'}</td>
                      {isHr && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {edit ? (
                            <button className="btn small" onClick={() => save(p, { companyShare: Number(edit.companyShare), employeeShare: Number(edit.employeeShare) })}>
                              Save
                            </button>
                          ) : (
                            <button className="btn secondary small" onClick={() => setEdits({ ...edits, [p.id]: { companyShare: p.companyShare, employeeShare: p.employeeShare } })}>
                              Change price
                            </button>
                          )}{' '}
                          <button className="btn secondary small" onClick={() => save(p, { active: !p.active })}>
                            {p.active ? 'Stop offering' : 'Offer again'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {isHr && (
          <form onSubmit={add} style={{ marginTop: '1rem' }}>
            <h3>Add an option</h3>
            <div className="row">
              <label className="field">
                <span>Type</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BenefitKind, paidAsCash: false })}>
                  <option value="MEAL">Meal voucher</option>
                  <option value="GYM">Gym membership</option>
                </select>
              </label>
              <label className="field">
                <span>Name</span>
                <input required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="field">
                <span>Provider</span>
                <input maxLength={120} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
              </label>
              <label className="field">
                <span>Company pays a month ({cur})</span>
                <input type="number" required min={0} step="0.01" value={form.companyShare} onChange={(e) => setForm({ ...form, companyShare: e.target.value })} />
              </label>
              {!form.paidAsCash && (
                <label className="field">
                  <span>Employee pays a month ({cur})</span>
                  <input type="number" required min={0} step="0.01" value={form.employeeShare} onChange={(e) => setForm({ ...form, employeeShare: e.target.value })} />
                </label>
              )}
            </div>
            {form.kind === 'MEAL' && (
              <label className="check">
                <input type="checkbox" checked={form.paidAsCash} onChange={(e) => setForm({ ...form, paidAsCash: e.target.checked })} /> Paid as a cash allowance with salary
              </label>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: '.75rem 0' }}>
              <legend className="small">Who can join (none ticked means everyone)</legend>
              {LOCATIONS.map((l) => (
                <label key={l} className="check" style={{ marginInlineEnd: '1rem' }}>
                  <input
                    type="checkbox"
                    checked={form.workLocations.includes(l)}
                    onChange={(e) => setForm({ ...form, workLocations: e.target.checked ? [...form.workLocations, l] : form.workLocations.filter((x) => x !== l) })}
                  />{' '}
                  {LOCATION_LABEL[l]}
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span>Description</span>
              <input maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <button className="btn" type="submit">
              Add option
            </button>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Members</h2>
        {!o ? (
          <Loading />
        ) : o.enrolments.length === 0 ? (
          <Empty>Nobody has joined yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Benefit</th>
                  <th>From</th>
                  <th>Status</th>
                  {isHr && <th />}
                </tr>
              </thead>
              <tbody>
                {o.enrolments.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.employee?.name}
                      <div className="muted small">{e.employee?.employeeNumber}</div>
                    </td>
                    <td>
                      {e.kindLabel}: {e.plan.name}
                      <div className="muted small">{[e.dietaryNeeds, e.branch].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{e.startLabel}</td>
                    <td>
                      <BenefitBadge r={e} />
                    </td>
                    {isHr && (
                      <td>
                        {e.status === 'APPROVED' && !e.endLabel && (
                          <button className="btn secondary small" onClick={() => end(e)}>
                            End
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Gift vouchers in {o?.year}</h2>
        {!o ? (
          <Loading />
        ) : o.vouchers.length === 0 ? (
          <Empty>No vouchers this year.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Occasion</th>
                  <th className="num">Value</th>
                  <th>Payslip month</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {o.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td>{v.nominee}</td>
                    <td>
                      {v.occasionLabel}
                      <div className="muted small">{v.reason}</div>
                    </td>
                    <td className="num">{m(v.value, v.currency)}</td>
                    <td>{v.taxMonthLabel ?? ''}</td>
                    <td>
                      <BenefitBadge r={v} issued="Issued" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
