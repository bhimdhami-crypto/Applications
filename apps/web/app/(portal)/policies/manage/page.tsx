'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorAlert, fmtDate, Loading, PageHead, useLoad } from '@/components/ui';
import { api, apiUpload, openFile } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { LibraryList } from '@/lib/types';

interface Report {
  item: { id: string; code: string; title: string; version: string };
  perCompany: Array<{ entityId: string; code: string; name: string; staff: number; read: number }>;
  notRead: Array<{ id: string; name: string; employeeNumber: string; entityCode: string; hasLogin: boolean }>;
}

const EMPTY_NEW = { kind: 'POLICY' as 'POLICY' | 'FORM', code: '', title: '', category: '', owner: '', summary: '', version: '1.0' };

/** Group HR administrators publish; HR in each country sees who has read a policy and sends reminders */
export default function ManagePoliciesPage() {
  const { t, lang } = usePrefs();
  const { me, can } = useSession();
  const list = useLoad(() => api<LibraryList>('/library'), []);
  const [selected, setSelected] = useState('');
  const [entityId, setEntityId] = useState('');
  const [version, setVersion] = useState({ version: '', keep: false, file: null as File | null });
  const [created, setCreated] = useState(EMPTY_NEW);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = list.data?.items ?? [];
  const canEdit = !!list.data?.canEdit;
  useEffect(() => {
    if (!selected && items.length) setSelected(items.find((i) => i.kind === 'POLICY')?.id ?? items[0].id);
  }, [items, selected]);
  const item = items.find((i) => i.id === selected);
  const companies = me.entities.filter((e) => can('people.read', e.id));
  const report = useLoad(
    () => (selected && item?.kind === 'POLICY' && list.data?.canReport ? api<Report>(`/library/${selected}/report${entityId ? `?entityId=${entityId}` : ''}`) : Promise.resolve(null)),
    [selected, entityId, item?.kind, item?.version, list.data?.canReport],
  );

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const remind = () =>
    run(async () => {
      const r = await api<{ sent: number }>(`/library/${selected}/remind${entityId ? `?entityId=${entityId}` : ''}`, { method: 'POST' });
      return r.sent ? `Reminder emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'} with a portal account.` : 'Everyone with a portal account has read it.';
    });

  const publish = (e: FormEvent) => {
    e.preventDefault();
    if (!item || !version.file) return;
    run(async () => {
      const form = new FormData();
      form.append('version', version.version);
      form.append('keepAcknowledgements', String(version.keep));
      form.append('file', version.file!);
      await apiUpload(`/library/${item.id}/versions`, form);
      setVersion({ version: '', keep: false, file: null });
      list.reload();
      return `${item.code} version ${version.version} is published.${version.keep || item.kind === 'FORM' ? '' : ' Everyone will be asked to read it again.'}`;
    });
  };

  const toggle = () =>
    item &&
    run(async () => {
      await api(`/library/${item.id}`, { method: 'PATCH', body: { active: !item.active } });
      list.reload();
      return item.active ? `${item.code} is hidden from staff.` : `${item.code} is visible to staff again.`;
    });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newFile) return;
    run(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(created)) if (v) form.append(k, v);
      form.append('file', newFile);
      const saved = await apiUpload<{ id: string; code: string }>('/library', form);
      setCreated(EMPTY_NEW);
      setNewFile(null);
      list.reload();
      setSelected(saved.id);
      return `${saved.code} is published.`;
    });
  };

  const r = report.data;
  const total = r?.perCompany.reduce((s, c) => ({ staff: s.staff + c.staff, read: s.read + c.read }), { staff: 0, read: 0 });
  const pct = (read: number, staff: number) => (staff ? `${Math.round((read / staff) * 100)}%` : '');
  const n = (v: number) => v.toLocaleString(lang);

  return (
    <>
      <PageHead title={t('nav.policiesManage')} crumbs={<Link href="/policies">{t('nav.policies')}</Link>} />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error || list.error || report.error} />

      {!list.data ? (
        <Loading />
      ) : (
        <section className="card">
          <div className="row">
            <label className="field">
              <span>Policy or form</span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} {i.title}
                    {i.active ? '' : ' (hidden)'}
                  </option>
                ))}
              </select>
            </label>
            {item?.kind === 'POLICY' && list.data.canReport && (
              <label className="field">
                <span>Company</span>
                <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                  <option value="">All my companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {item && (
            <p className="small">
              Version {item.version}, published {fmtDate(item.publishedAt, lang)}.{' '}
              <button type="button" className="btn secondary small" onClick={() => openFile(`/library/${item.id}/file`, item.fileName).catch((e) => setError(e.message))}>
                Open
              </button>{' '}
              {canEdit && (
                <button type="button" className="btn secondary small" disabled={busy} onClick={toggle}>
                  {item.active ? 'Hide from staff' : 'Show to staff'}
                </button>
              )}
            </p>
          )}

          {r && total && (
            <>
              <h2>Who has read version {r.item.version}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th className="num">Staff</th>
                      <th className="num">Read</th>
                      <th className="num">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.perCompany.map((c) => (
                      <tr key={c.entityId}>
                        <td>
                          {c.code} · {c.name}
                        </td>
                        <td className="num">{n(c.staff)}</td>
                        <td className="num">{n(c.read)}</td>
                        <td className="num">{pct(c.read, c.staff)}</td>
                      </tr>
                    ))}
                    {r.perCompany.length > 1 && (
                      <tr>
                        <td>
                          <strong>All shown</strong>
                        </td>
                        <td className="num">
                          <strong>{n(total.staff)}</strong>
                        </td>
                        <td className="num">
                          <strong>{n(total.read)}</strong>
                        </td>
                        <td className="num">
                          <strong>{pct(total.read, total.staff)}</strong>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="small">
                Not read yet: the first {r.notRead.length} shown. Staff without a portal account cannot confirm online; HR can collect a signed copy.{' '}
                {can('people.manage') && (
                  <button type="button" className="btn small" disabled={busy} onClick={remind}>
                    Email a reminder to those with an account
                  </button>
                )}
              </p>
              <div className="chips">
                {r.notRead.map((p) => (
                  <span key={p.id} className={`chip${p.hasLogin ? '' : ' muted'}`}>
                    {p.name} <span className="muted">{p.employeeNumber}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {canEdit && item && (
        <section className="card">
          <h2>Publish a new version of {item.code}</h2>
          <form onSubmit={publish}>
            <div className="row">
              <label className="field">
                <span>New version number</span>
                <input required pattern="\d{1,3}(\.\d{1,3}){0,2}" placeholder={`Higher than ${item.version}`} value={version.version} onChange={(e) => setVersion({ ...version, version: e.target.value })} />
              </label>
              <label className="field">
                <span>PDF file</span>
                <input type="file" required accept="application/pdf" onChange={(e) => setVersion({ ...version, file: e.target.files?.[0] ?? null })} />
              </label>
            </div>
            {item.kind === 'POLICY' && (
              <label className="check" style={{ marginBottom: '.8rem' }}>
                <input type="checkbox" checked={version.keep} onChange={(e) => setVersion({ ...version, keep: e.target.checked })} /> Small correction only (typos, layout): keep everyone’s earlier confirmation
              </label>
            )}
            <button className="btn" type="submit" disabled={busy}>
              Publish version
            </button>
          </form>
        </section>
      )}

      {canEdit && (
        <section className="card">
          <h2>Add a policy or form</h2>
          <form onSubmit={add}>
            <div className="row">
              <label className="field">
                <span>Type</span>
                <select value={created.kind} onChange={(e) => setCreated({ ...created, kind: e.target.value as 'POLICY' | 'FORM' })}>
                  <option value="POLICY">Policy (staff confirm they read it)</option>
                  <option value="FORM">Form (download only)</option>
                </select>
              </label>
              <label className="field">
                <span>Code</span>
                <input required placeholder={created.kind === 'POLICY' ? 'POL-23' : 'HR-F21'} value={created.code} onChange={(e) => setCreated({ ...created, code: e.target.value.toUpperCase() })} />
              </label>
              <label className="field">
                <span>Title</span>
                <input required minLength={3} maxLength={120} value={created.title} onChange={(e) => setCreated({ ...created, title: e.target.value })} />
              </label>
              <label className="field">
                <span>Category</span>
                <input required minLength={2} maxLength={60} list="categories" value={created.category} onChange={(e) => setCreated({ ...created, category: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Owner</span>
                <input maxLength={80} value={created.owner} onChange={(e) => setCreated({ ...created, owner: e.target.value })} />
              </label>
              <label className="field">
                <span>Version</span>
                <input required value={created.version} onChange={(e) => setCreated({ ...created, version: e.target.value })} />
              </label>
              <label className="field">
                <span>PDF file</span>
                <input type="file" required accept="application/pdf" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <datalist id="categories">
              {[...new Set(items.map((i) => i.category))].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <label className="field">
              <span>Summary</span>
              <input maxLength={400} value={created.summary} onChange={(e) => setCreated({ ...created, summary: e.target.value })} />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              Publish
            </button>
          </form>
        </section>
      )}
    </>
  );
}
