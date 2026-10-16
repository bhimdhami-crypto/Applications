'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PersonRow } from '@/components/PersonRow';
import { ErrorAlert, Empty, Loading, PageHead, Pager, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { EmployeeRow, EntityDetail, Paged } from '@/lib/types';

export default function Directory() {
  const { entityId, can, me } = useSession();
  const { t, lang } = usePrefs();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'TERMINATED' | 'ALL'>('ACTIVE');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);

  // Search after typing stops, not on every key
  useEffect(() => {
    const h = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    setDepartmentId('');
    setPage(1);
  }, [entityId]);

  const entity = useLoad(() => (entityId ? api<EntityDetail>(`/org/entities/${entityId}`) : Promise.resolve(null)), [entityId]);
  const params = new URLSearchParams({ page: String(page), pageSize: '25', status });
  if (entityId) params.set('entityId', entityId);
  if (query) params.set('q', query);
  if (departmentId) params.set('departmentId', departmentId);
  const list = useLoad(() => api<Paged<EmployeeRow>>(`/employees?${params}`), [params.toString()]);
  const canHire = can('people.manage', entityId ?? undefined);
  const company = me.entities.find((e) => e.id === entityId);

  return (
    <>
      <PageHead
        title={t('nav.directory')}
        sub={company ? company.name : 'Everyone in the companies you look after. Choose a company in the top bar to filter by department.'}
        actions={
          canHire && (
            <Link className="btn" href="/people/new">
              Hire someone
            </Link>
          )
        }
      />
      <div className="filters" role="search">
        <label className="field">
          <span>{t('common.search')}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, number or email" style={{ width: 280 }} />
        </label>
        {entity.data && (
          <label className="field">
            <span>Department</span>
            <select
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All departments</option>
              {entity.data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="ACTIVE">Current staff</option>
            <option value="TERMINATED">Leavers</option>
            <option value="ALL">Everyone</option>
          </select>
        </label>
      </div>
      <ErrorAlert error={list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <Empty>No one matches these filters.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Job</th>
                  <th>Department</th>
                  <th>Company</th>
                  <th>Hired</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <PersonRow key={r.id} r={r} lang={lang} />
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
