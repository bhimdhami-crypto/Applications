'use client';

import { useState } from 'react';
import { PersonRow } from '@/components/PersonRow';
import { ErrorAlert, Empty, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { EmployeeRow } from '@/lib/types';

export default function Team() {
  const { t, lang } = usePrefs();
  const [all, setAll] = useState(false);
  const team = useLoad(() => api<EmployeeRow[]>('/employees/team'), []);
  const rows = (team.data ?? []).filter((r) => all || r.level === 1);
  const direct = (team.data ?? []).filter((r) => r.level === 1).length;

  return (
    <>
      <PageHead
        title={t('nav.team')}
        sub={team.data ? `${direct} direct reports, ${team.data.length} people in your reporting line.` : undefined}
        actions={
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include everyone below my direct reports
          </label>
        }
      />
      <ErrorAlert error={team.error} />
      {!team.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No one reports to you in the portal yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Job</th>
                <th>Department</th>
                <th>Company</th>
                <th>Hired</th>
                <th>Reports to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PersonRow key={r.id} r={r} lang={lang} extra={<span className="muted">{r.manager?.name ?? '—'}</span>} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
