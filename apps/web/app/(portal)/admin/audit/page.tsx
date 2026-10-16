'use client';

import { useState } from 'react';
import { ErrorAlert, fmtDate, Loading, PageHead, Pager, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { AuditRow, Paged } from '@/lib/types';

export default function Audit() {
  const { me, entityId } = useSession();
  const { t, lang } = usePrefs();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50', ...(action ? { action } : {}), ...(entityId ? { legalEntityId: entityId } : {}) });
  const list = useLoad(() => api<Paged<AuditRow>>(`/audit?${qs}`), [qs.toString()]);
  const names = new Map(me.entities.map((e) => [e.id, `${e.countryCode} · ${e.code}`]));

  return (
    <>
      <PageHead
        title={t('nav.audit')}
        sub="Every sign-in, change, approval and export, newest first. Entries cannot be edited or deleted."
        actions={
          <select
            aria-label="Filter by action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            <option value="auth.">Sign-in and sessions</option>
            <option value="users.">Users and roles</option>
            <option value="org.">Organisation</option>
          </select>
        }
      />
      <ErrorAlert error={list.error} />
      {!list.data ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Company</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(r.createdAt, lang, true)}
                    </td>
                    <td>{r.actor?.displayName ?? 'System'}</td>
                    <td className="mono">{r.action}</td>
                    <td>{r.legalEntityId ? (names.get(r.legalEntityId) ?? '—') : 'Group'}</td>
                    <td className="mono" style={{ maxWidth: 380, overflowWrap: 'anywhere', fontSize: '.8rem' }}>
                      {r.detail ? JSON.stringify(r.detail) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
