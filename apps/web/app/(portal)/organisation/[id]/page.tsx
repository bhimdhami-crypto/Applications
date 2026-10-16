'use client';

import { LANGUAGES } from '@gpp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ErrorAlert, Loading, PageHead, StatusBadge, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { EntityDetail } from '@/lib/types';

type Tab = 'structure' | 'modules' | 'details';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function EntityPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = usePrefs();
  const [tab, setTab] = useState<Tab>('structure');
  const e = useLoad(() => api<EntityDetail>(`/org/entities/${id}`), [id]);

  if (e.error) return <ErrorAlert error={e.error} />;
  if (!e.data) return <Loading />;
  const d = e.data;
  const canEdit = can('org.structure.manage', d.id);

  return (
    <>
      <PageHead
        crumbs={
          <>
            <Link href="/organisation">{t('nav.organisation')}</Link> / {d.country.name}
          </>
        }
        title={d.name}
        sub={
          <>
            <span className="mono">{d.code}</span> · {d.functionalCurrency} · {d.timeZone} {d.isSharedServiceCentre && <span className="badge">Shared service centre</span>} <StatusBadge status={d.status} />
          </>
        }
      />
      <div className="tabs" role="tablist">
        {(['structure', 'modules', 'details'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
            {x === 'structure' ? 'Structure' : x === 'modules' ? 'Modules' : 'Company details'}
          </button>
        ))}
      </div>

      {tab === 'structure' && (
        <>
          <Section
            title="Business units"
            kind="business-units"
            entityId={d.id}
            canEdit={canEdit}
            rows={d.businessUnits.map((r) => ({ ...r, extra: '' }))}
            onChange={e.reload}
          />
          <Section
            title="Branches"
            kind="branches"
            entityId={d.id}
            canEdit={canEdit}
            rows={d.branches.map((r) => ({ ...r, extra: r.city }))}
            extraLabel="City"
            extraField="city"
            onChange={e.reload}
          />
          <Section
            title="Departments"
            kind="departments"
            entityId={d.id}
            canEdit={canEdit}
            rows={d.departments.map((r) => ({ ...r, extra: [r.businessUnit?.name, r.branch?.name].filter(Boolean).join(' · ') }))}
            extraLabel="Business unit · branch"
            onChange={e.reload}
            options={{ businessUnitId: d.businessUnits.map((b) => [b.id, b.name]) }}
          />
          <Section
            title="Cost centres"
            kind="cost-centres"
            entityId={d.id}
            canEdit={canEdit}
            rows={d.costCentres.map((r) => ({ ...r, extra: [r.department?.name, r.glCode && `GL ${r.glCode}`].filter(Boolean).join(' · ') }))}
            extraLabel="Department · GL code"
            onChange={e.reload}
            options={{ departmentId: d.departments.map((b) => [b.id, b.name]) }}
          />
        </>
      )}

      {tab === 'modules' && <Modules d={d} canEdit={can('features.manage', d.id)} onChange={e.reload} />}
      {tab === 'details' && <Details d={d} canEdit={can('org.entities.manage', d.id)} onChange={e.reload} />}
    </>
  );
}

interface Row {
  id: string;
  code: string;
  name: string;
  status: string;
  extra: string;
}

function Section(props: {
  title: string;
  kind: string;
  entityId: string;
  canEdit: boolean;
  rows: Row[];
  extraLabel?: string;
  extraField?: 'city';
  options?: Record<string, string[][]>;
  onChange: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({ code: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
      await api(`/org/entities/${props.entityId}/${props.kind}`, { method: 'POST', body });
      setForm({ code: '', name: '' });
      props.onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(r: Row) {
    try {
      await api(`/org/${props.kind}/${r.id}`, { method: 'PATCH', body: { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } });
      props.onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <details className="panel" open>
      <summary>
        {props.title} <span className="badge">{props.rows.length}</span>
      </summary>
      <div>
        <ErrorAlert error={error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                {props.extraLabel && <th>{props.extraLabel}</th>}
                <th>Status</th>
                {props.canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.code}</td>
                  <td>{r.name}</td>
                  {props.extraLabel && <td className="muted">{r.extra}</td>}
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  {props.canEdit && (
                    <td>
                      <button className="btn secondary small" onClick={() => toggle(r)}>
                        {r.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {props.canEdit && (
          <form className="row" onSubmit={add} style={{ marginTop: '.75rem' }}>
            <label className="field">
              <span>Code</span>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="field" style={{ flex: '2 1 220px' }}>
              <span>Name</span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            {props.extraField === 'city' && (
              <label className="field">
                <span>City</span>
                <input required value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </label>
            )}
            {Object.entries(props.options ?? {}).map(([field, opts]) => (
              <label className="field" key={field}>
                <span>{field === 'businessUnitId' ? 'Business unit' : 'Department'}</span>
                <select value={form[field] ?? ''} onChange={(e) => setForm({ ...form, [field]: e.target.value })}>
                  <option value="">None</option>
                  {opts.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="field">
              <button className="btn">Add</button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

function Modules({ d, canEdit, onChange }: { d: EntityDetail; canEdit: boolean; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function set(module: string, enabled: boolean) {
    try {
      await api(`/org/entities/${d.id}/features/${module}`, { method: 'PUT', body: { enabled } });
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <section className="card">
      <h2>Modules for this company</h2>
      <p className="muted">Switching a module here affects only {d.name}. Other companies keep their own settings.</p>
      <ErrorAlert error={error} />
      <div className="table-wrap">
        <table>
          <tbody>
            {d.features.map((f) => (
              <tr key={f.module}>
                <td>{f.label}</td>
                <td>{f.enabled ? <span className="badge ok">On</span> : <span className="badge">Off</span>}</td>
                <td>
                  {f.alwaysOn ? (
                    <span className="muted">Always on</span>
                  ) : canEdit ? (
                    <button className="btn secondary small" onClick={() => set(f.module, !f.enabled)}>
                      {f.enabled ? 'Switch off' : 'Switch on'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Details({ d, canEdit, onChange }: { d: EntityDetail; canEdit: boolean; onChange: () => void }) {
  const [form, setForm] = useState({
    name: d.name,
    registrationNumber: d.registrationNumber ?? '',
    taxNumber: d.taxNumber ?? '',
    address: d.address ?? '',
    timeZone: d.timeZone,
    defaultLanguage: d.defaultLanguage,
    fiscalYearStartMonth: d.fiscalYearStartMonth,
    weekendDays: d.weekendDays,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/org/entities/${d.id}`, { method: 'PATCH', body: { ...form, registrationNumber: form.registrationNumber || undefined, taxNumber: form.taxNumber || undefined, address: form.address || undefined } });
      setMsg({ ok: true, text: 'Saved' });
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Company details</h2>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field">
          <span>Registered name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="row">
          <label className="field">
            <span>Registration number</span>
            <input value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
          </label>
          <label className="field">
            <span>Tax number</span>
            <input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Registered address</span>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <div className="row">
          <label className="field">
            <span>Time zone</span>
            <input value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
          </label>
          <label className="field">
            <span>Default language</span>
            <select value={form.defaultLanguage} onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.englishName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fiscal year starts</span>
            <select value={form.fiscalYearStartMonth} onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: '.85rem' }}>Weekend days</legend>
          <div className="row">
            {DAYS.map((day, i) => (
              <label key={day} className="check">
                <input
                  type="checkbox"
                  checked={form.weekendDays.includes(i)}
                  onChange={(e) => setForm({ ...form, weekendDays: e.target.checked ? [...form.weekendDays, i].sort() : form.weekendDays.filter((x) => x !== i) })}
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        {canEdit && <button className="btn">Save changes</button>}
      </fieldset>
      {!canEdit && <p className="muted">Only group administrators can change company details.</p>}
    </form>
  );
}
