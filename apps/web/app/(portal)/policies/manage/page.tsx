'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, Company, LibraryItem, openFile } from '@/lib/api';

interface Report {
  item: { id: string; code: string; title: string; version: string };
  perCompany: Array<{ companyId: string; company: string; staff: number; read: number }>;
  notRead: Array<{ id: string; name: string; employeeNo: string; hasLogin: boolean }>;
}

const EMPTY_NEW = { kind: 'POLICY' as 'POLICY' | 'FORM', code: '', title: '', category: '', owner: '', summary: '', version: '1.0' };

export default function ManagePoliciesPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [version, setVersion] = useState({ version: '', keep: false, file: null as File | null });
  const [created, setCreated] = useState(EMPTY_NEW);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadItems = useCallback(() => {
    api<LibraryItem[]>('/library').then((list) => {
      setItems(list);
      setSelected((s) => s || list.find((i) => i.kind === 'POLICY')?.id || '');
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(loadItems, [loadItems]);
  useEffect(() => {
    api<Company[]>('/companies').then(setCompanies).catch(() => setCompanies([]));
  }, []);
  const item = items.find((i) => i.id === selected);
  const loadReport = useCallback(() => {
    if (!selected || item?.kind !== 'POLICY') return setReport(null);
    api<Report>(`/library/${selected}/report${companyId ? `?companyId=${companyId}` : ''}`).then(setReport).catch((e) => setError(e.message));
  }, [selected, companyId, item?.kind]);
  useEffect(loadReport, [loadReport]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const remind = () => run(async () => {
    const r = await api<{ sent: number }>(`/library/${selected}/remind${companyId ? `?companyId=${companyId}` : ''}`, { method: 'POST' });
    return r.sent ? `Reminder emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'} with a portal login.` : 'Everyone with a portal login has read it.';
  });

  const publish = (e: FormEvent) => {
    e.preventDefault();
    if (!item || !version.file) return;
    run(async () => {
      const form = new FormData();
      form.append('version', version.version);
      form.append('keepAcknowledgements', String(version.keep));
      form.append('file', version.file!);
      await api(`/library/${item.id}/versions`, { method: 'POST', body: form });
      setVersion({ version: '', keep: false, file: null });
      loadItems();
      return `${item.code} version ${version.version} is published.${version.keep || item.kind === 'FORM' ? '' : ' Everyone will be asked to read it again.'}`;
    });
  };

  const toggle = () => item && run(async () => {
    await api(`/library/${item.id}`, { method: 'PATCH', body: { active: !item.active } });
    loadItems();
    return item.active ? `${item.code} is hidden from staff.` : `${item.code} is visible to staff again.`;
  });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newFile) return;
    run(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(created)) if (v) form.append(k, v);
      form.append('file', newFile);
      const saved = await api<{ id: string; code: string }>('/library', { method: 'POST', body: form });
      setCreated(EMPTY_NEW);
      setNewFile(null);
      loadItems();
      setSelected(saved.id);
      return `${saved.code} is published.`;
    });
  };

  const total = report?.perCompany.reduce((s, c) => ({ staff: s.staff + c.staff, read: s.read + c.read }), { staff: 0, read: 0 });
  const pct = (read: number, staff: number) => (staff ? `${Math.round((read / staff) * 100)}%` : '');

  return (
    <>
      <h1>Manage policies and forms</h1>
      <p className="muted"><Link href="/policies">Back to Policies and forms</Link></p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <div className="form-grid">
          <label>
            Policy or form
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.title}{i.active ? '' : ' (hidden)'}</option>)}
            </select>
          </label>
          {item?.kind === 'POLICY' && (
            <label>
              Company
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {item && (
          <p className="small">
            Version {item.version}, published {new Date(item.publishedAt).toLocaleDateString('en-GB')}.{' '}
            <button type="button" className="secondary small" onClick={() => openFile(`/library/${item.id}/file`).catch((e) => setError(e.message))}>Open</button>{' '}
            <button type="button" className="secondary small" disabled={busy} onClick={toggle}>{item.active ? 'Hide from staff' : 'Show to staff'}</button>
          </p>
        )}

        {report && total && (
          <>
            <h2>Who has read version {report.item.version}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Company</th><th className="num">Staff</th><th className="num">Read</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {report.perCompany.map((c) => (
                    <tr key={c.companyId}><td>{c.company}</td><td className="num">{c.staff.toLocaleString('en-GB')}</td><td className="num">{c.read.toLocaleString('en-GB')}</td><td className="num">{pct(c.read, c.staff)}</td></tr>
                  ))}
                  <tr className="total"><td>All companies</td><td className="num">{total.staff.toLocaleString('en-GB')}</td><td className="num">{total.read.toLocaleString('en-GB')}</td><td className="num">{pct(total.read, total.staff)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="small">
              Not read yet{companyId ? '' : ' (all companies)'}: first {report.notRead.length} shown. Staff without a portal login cannot confirm online; HR can collect a signed copy.{' '}
              <button type="button" className="small" disabled={busy} onClick={remind}>Email a reminder to those with a login</button>
            </p>
            <div className="chips">
              {report.notRead.map((p) => <span key={p.id} className={`chip${p.hasLogin ? '' : ' muted'}`}>{p.name} <span className="muted">{p.employeeNo}</span></span>)}
            </div>
          </>
        )}
      </section>

      {item && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Publish a new version of {item.code}</h2>
          <form onSubmit={publish}>
            <div className="form-grid">
              <label>New version number<input required pattern="\d{1,3}(\.\d{1,3}){0,2}" placeholder={`Higher than ${item.version}`} value={version.version} onChange={(e) => setVersion({ ...version, version: e.target.value })} /></label>
              <label>PDF file<input type="file" required accept="application/pdf" onChange={(e) => setVersion({ ...version, file: e.target.files?.[0] ?? null })} /></label>
            </div>
            {item.kind === 'POLICY' && (
              <label className="inline-check"><input type="checkbox" checked={version.keep} onChange={(e) => setVersion({ ...version, keep: e.target.checked })} /> Small correction only (typos, layout): keep everyone’s earlier confirmation</label>
            )}
            <button type="submit" disabled={busy}>Publish version</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Add a policy or form</h2>
        <form onSubmit={add}>
          <div className="form-grid">
            <label>
              Type
              <select value={created.kind} onChange={(e) => setCreated({ ...created, kind: e.target.value as 'POLICY' | 'FORM' })}>
                <option value="POLICY">Policy (staff confirm they read it)</option>
                <option value="FORM">Form (download only)</option>
              </select>
            </label>
            <label>Code<input required placeholder={created.kind === 'POLICY' ? 'POL-23' : 'HR-F21'} value={created.code} onChange={(e) => setCreated({ ...created, code: e.target.value.toUpperCase() })} /></label>
            <label>Title<input required minLength={3} value={created.title} onChange={(e) => setCreated({ ...created, title: e.target.value })} /></label>
            <label>Category<input required minLength={2} list="categories" value={created.category} onChange={(e) => setCreated({ ...created, category: e.target.value })} /></label>
            <label>Owner<input value={created.owner} onChange={(e) => setCreated({ ...created, owner: e.target.value })} /></label>
            <label>Version<input required value={created.version} onChange={(e) => setCreated({ ...created, version: e.target.value })} /></label>
            <label>PDF file<input type="file" required accept="application/pdf" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} /></label>
          </div>
          <datalist id="categories">{[...new Set(items.map((i) => i.category))].map((c) => <option key={c} value={c} />)}</datalist>
          <label>Summary<input maxLength={400} value={created.summary} onChange={(e) => setCreated({ ...created, summary: e.target.value })} /></label>
          <button type="submit" disabled={busy}>Publish</button>
        </form>
      </section>
    </>
  );
}
