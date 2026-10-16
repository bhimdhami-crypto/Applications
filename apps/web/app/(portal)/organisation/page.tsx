'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorAlert, Loading, PageHead, StatusBadge, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Country, Currency, EntitySummary } from '@/lib/types';

export default function Organisation() {
  const { me, can, entityId, reload: reloadMe } = useSession();
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const list = useLoad(() => api<EntitySummary[]>(`/org/entities${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const shown = (list.data ?? []).filter((e) => !entityId || e.id === entityId);
  const byCountry = [...new Set(shown.map((e) => e.countryCode))];
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHead
        title={t('nav.organisation')}
        sub={`${me.group.name} → country → company → business unit → branch → department → cost centre`}
        actions={
          <>
            <input aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            {can('org.entities.manage') && (
              <button className="btn" onClick={() => setAdding(!adding)}>
                {t('common.add')} company
              </button>
            )}
          </>
        }
      />
      {adding && (
        <NewEntity
          onDone={async () => {
            setAdding(false);
            await list.reload();
            await reloadMe();
          }}
        />
      )}
      <ErrorAlert error={list.error} />
      {list.loading && !list.data ? (
        <Loading />
      ) : (
        byCountry.map((cc) => {
          const rows = shown.filter((e) => e.countryCode === cc);
          return (
            <section key={cc} style={{ marginBottom: '1.25rem' }}>
              <h2>
                {rows[0].country.name} <span className="badge">{cc}</span>
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Legal entity</th>
                      <th>Currency</th>
                      <th>Business units</th>
                      <th>Branches</th>
                      <th>Departments</th>
                      <th>Cost centres</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td className="mono">{e.code}</td>
                        <td>
                          <Link href={`/organisation/${e.id}`}>{e.name}</Link> {e.isSharedServiceCentre && <span className="badge">Shared service centre</span>}
                        </td>
                        <td>{e.functionalCurrency}</td>
                        <td>{e._count.businessUnits}</td>
                        <td>{e._count.branches}</td>
                        <td>{e._count.departments}</td>
                        <td>{e._count.costCentres}</td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}

function NewEntity({ onDone }: { onDone: () => void }) {
  const countries = useLoad(() => api<Country[]>('/org/countries'), []);
  const currencies = useLoad(() => api<Currency[]>('/org/currencies'), []);
  const [form, setForm] = useState({ code: '', name: '', countryCode: '', functionalCurrency: '', isSharedServiceCentre: false });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/org/entities', { method: 'POST', body: { ...form, functionalCurrency: form.functionalCurrency || undefined } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={save} style={{ marginBottom: '1rem' }}>
      <h2>New legal entity</h2>
      <ErrorAlert error={error} />
      <div className="row">
        <label className="field">
          <span>Code</span>
          <input required value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="KE03" />
        </label>
        <label className="field" style={{ flex: '3 1 300px' }}>
          <span>Registered name</span>
          <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Country</span>
          <select required value={form.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
            <option value="">Choose…</option>
            {countries.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Functional currency</span>
          <select value={form.functionalCurrency} onChange={(e) => set('functionalCurrency', e.target.value)}>
            <option value="">The country&apos;s currency</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field check">
          <input type="checkbox" checked={form.isSharedServiceCentre} onChange={(e) => set('isSharedServiceCentre', e.target.checked)} />
          <span>Shared service centre</span>
        </label>
      </div>
      <button className="btn">Create company</button>
    </form>
  );
}
