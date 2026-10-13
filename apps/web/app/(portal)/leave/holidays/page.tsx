'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, COUNTRY_NAME, formatDate, Holiday } from '@/lib/api';
import { useSession } from '@/lib/session';

const thisYear = new Date().getFullYear();

export default function HolidaysPage() {
  const { me, can } = useSession();
  const [countryCode, setCountryCode] = useState(me.employee?.company.countryCode ?? 'KE');
  const [year, setYear] = useState(thisYear);
  const [list, setList] = useState<Holiday[] | null>(null);
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isHr = can('HR');

  const load = useCallback(() => {
    api<Holiday[]>(`/leave/holidays?countryCode=${countryCode}&year=${year}`).then(setList).catch((e) => setError(e.message));
  }, [countryCode, year]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api('/leave/holidays', { method: 'POST', body: { countryCode, ...form } });
      setNotice(`${form.name} added.`);
      setForm({ date: '', name: '' });
      if (Number(form.date.slice(0, 4)) !== year) setYear(Number(form.date.slice(0, 4)));
      else load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(h: Holiday) {
    if (!window.confirm(`Remove ${h.name} on ${formatDate(h.date)}? Leave already booked over it keeps its day count.`)) return;
    setError('');
    try {
      await api(`/leave/holidays/${h.id}`, { method: 'DELETE' });
      setNotice(`${h.name} removed.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Public holidays</h1>
      <div className="toolbar">
        <label>
          Country
          <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
            {Object.entries(COUNTRY_NAME).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label>
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">
        These days are not counted as leave. Dates marked “estimated” depend on the moon sighting{isHr ? ', so check them against the official gazette each year and correct them here.' : ' and may move by a day.'}
      </p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Day</th><th>Holiday</th>{isHr && <th />}</tr></thead>
          <tbody>
            {list?.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.date)}</td>
                <td>{new Date(h.date).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}</td>
                <td>{h.name}</td>
                {isHr && <td className="actions"><button className="danger small" onClick={() => remove(h)}>Remove</button></td>}
              </tr>
            ))}
            {list && list.length === 0 && <tr><td colSpan={4} className="muted">No holidays listed.</td></tr>}
          </tbody>
        </table>
        {isHr && (
          <form onSubmit={add} style={{ marginTop: '1rem' }}>
            <h3>Add a holiday in {COUNTRY_NAME[countryCode]}</h3>
            <div className="form-grid">
              <label>Date<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            </div>
            <button type="submit">Add holiday</button>
          </form>
        )}
      </div>
    </>
  );
}
