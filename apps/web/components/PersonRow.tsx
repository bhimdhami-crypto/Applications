'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { fmtDate } from './ui';
import type { EmployeeRow } from '@/lib/types';

/** One person in a staff table: photo, name, number, job, department, company and hire date */
export function PersonRow({ r, lang, extra }: { r: EmployeeRow; lang: string; extra?: ReactNode }) {
  return (
    <tr>
      <td>
        <div className="person-cell">
          <Avatar employmentId={r.id} name={r.name} />
          <div>
            <Link href={`/people/${r.id}`}>{r.name}</Link>
            <small>
              {r.localName && <span dir="auto">{r.localName} · </span>}
              <span className="mono">{r.employeeNumber}</span>
            </small>
          </div>
        </div>
      </td>
      <td>
        {r.jobTitle ?? '—'}
        {r.grade && <small className="muted"> · {r.grade}</small>}
      </td>
      <td>{r.department?.name ?? '—'}</td>
      <td title={r.entity.name}>
        {r.entity.countryCode} · {r.entity.code}
      </td>
      <td className="muted">{fmtDate(r.hireDate, lang)}</td>
      <td>{extra ?? (r.status === 'ACTIVE' ? <span className="badge ok">Active</span> : <span className="badge">Left {fmtDate(r.endDate, lang)}</span>)}</td>
    </tr>
  );
}
