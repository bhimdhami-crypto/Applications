'use client';

import { LANGUAGES } from '@gpp/shared';
import { FormEvent, useState } from 'react';
import { ErrorAlert, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Country, Currency } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Geography() {
  const { can } = useSession();
  const { t } = usePrefs();
  const countries = useLoad(() => api<Country[]>('/org/countries'), []);
  const currencies = useLoad(() => api<Currency[]>('/org/currencies'), []);
  const manage = can('geo.manage');

  return (
    <>
      <PageHead title={t('nav.geography')} sub="Countries, currencies and languages are configuration: administrators add new ones here without code changes." />
      <ErrorAlert error={countries.error ?? currencies.error} />
      <h2>Countries</h2>
      {!countries.data ? (
        <Loading />
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Country</th>
                <th>Currency</th>
                <th>Languages</th>
                <th>Time zone</th>
                <th>Weekend</th>
                <th>Your companies</th>
              </tr>
            </thead>
            <tbody>
              {countries.data.map((c) => (
                <tr key={c.code}>
                  <td className="mono">{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.currencyCode}</td>
                  <td>{c.languages.map((l) => LANGUAGES.find((x) => x.code === l)?.englishName ?? l).join(', ')}</td>
                  <td className="mono">{c.timeZone}</td>
                  <td>{c.weekendDays.map((d) => DAYS[d]).join(', ')}</td>
                  <td>{c.entityCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && <NewCountry currencies={currencies.data ?? []} onDone={countries.reload} />}

      <h2 style={{ marginTop: '1.5rem' }}>Currencies</h2>
      {!currencies.data ? (
        <Loading />
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Currency</th>
                <th>Symbol</th>
                <th>Decimal places</th>
              </tr>
            </thead>
            <tbody>
              {currencies.data.map((c) => (
                <tr key={c.code}>
                  <td className="mono">{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.symbol}</td>
                  <td>{c.decimals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && <NewCurrency onDone={currencies.reload} />}

      <h2 style={{ marginTop: '1.5rem' }}>Languages</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Language</th>
              <th>Direction</th>
              <th>Portal translation</th>
            </tr>
          </thead>
          <tbody>
            {LANGUAGES.map((l) => (
              <tr key={l.code}>
                <td className="mono">{l.code}</td>
                <td>
                  {l.englishName} · <span lang={l.code}>{l.nativeName}</span>
                </td>
                <td>{l.dir === 'rtl' ? 'Right to left' : 'Left to right'}</td>
                <td>{l.status === 'interface' ? <span className="badge ok">Draft available</span> : <span className="badge">Phase 6</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewCountry({ currencies, onDone }: { currencies: Currency[]; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', currencyCode: '', languages: 'en', timeZone: '', weekendDays: [0, 6], region: 'Africa' });
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/org/countries', { method: 'POST', body: { ...f, languages: f.languages.split(',').map((x) => x.trim()).filter(Boolean) } });
      setF({ ...f, code: '', name: '', timeZone: '' });
      setError(null);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <details className="panel">
      <summary>Add a country</summary>
      <form onSubmit={save}>
        <ErrorAlert error={error} />
        <div className="row">
          <label className="field">
            <span>ISO code</span>
            <input required maxLength={2} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </label>
          <label className="field">
            <span>Name</span>
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select required value={f.currencyCode} onChange={(e) => setF({ ...f, currencyCode: e.target.value })}>
              <option value="">Choose…</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Languages (codes, comma separated)</span>
            <input required value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} />
          </label>
          <label className="field">
            <span>Time zone</span>
            <input required placeholder="Africa/Johannesburg" value={f.timeZone} onChange={(e) => setF({ ...f, timeZone: e.target.value })} />
          </label>
          <label className="field">
            <span>Region</span>
            <select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
              {['Africa', 'Europe', 'Asia', 'Oceania', 'Americas'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn">Add country</button>
      </form>
    </details>
  );
}

function NewCurrency({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', decimals: 2, symbol: '' });
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/org/currencies', { method: 'POST', body: f });
      setF({ code: '', name: '', decimals: 2, symbol: '' });
      setError(null);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <details className="panel">
      <summary>Add a currency</summary>
      <form className="row" onSubmit={save}>
        <ErrorAlert error={error} />
        <label className="field">
          <span>ISO code</span>
          <input required maxLength={3} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </label>
        <label className="field">
          <span>Name</span>
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Symbol</span>
          <input required value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
        </label>
        <label className="field">
          <span>Decimal places</span>
          <input type="number" min={0} max={4} value={f.decimals} onChange={(e) => setF({ ...f, decimals: Number(e.target.value) })} />
        </label>
        <div className="field">
          <button className="btn">Add currency</button>
        </div>
      </form>
    </details>
  );
}
