'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Building2, Network, ShieldCheck, ShieldAlert, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Empty, PageHeader } from '@/components/ui';
import { api, LOCATION_LABEL, OrgEntity, OrgNode } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Chart { chain: OrgNode[]; root: OrgNode | null; reports: OrgNode[] }
interface Dept { department: string; headcount: number; heads: OrgNode[] }

export default function OrganisationPage() {
  return (
    <Suspense>
      <Organisation />
    </Suspense>
  );
}

function Node({ n, root, onPick, canOpen }: { n: OrgNode; root?: boolean; onPick: (id: string) => void; canOpen: boolean }) {
  const name = `${n.firstName} ${n.lastName}`;
  return (
    <div className={`org-node${root ? ' root' : ''}`}>
      <button type="button" className="org-pick" onClick={() => onPick(n.id)} title={`Show ${name}'s team`}>
        <Avatar employeeId={n.id} name={name} hasPhoto={n.hasPhoto && canOpen} size={44} />
        <strong>{name}</strong>
        <span>{n.jobTitle}</span>
        <span>{n.department}{n.grade ? ` · ${n.grade}` : ''}</span>
      </button>
      <div className="org-meta">
        {n.reportCount > 0 ? <span className="tag"><Users size={12} /> {n.reportCount}</span> : <span className="tag">{LOCATION_LABEL[n.workLocation]}</span>}
        {canOpen && <Link href={`/employees/${n.id}`} className="small">Profile</Link>}
      </div>
    </div>
  );
}

function Organisation() {
  const { me, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const employeeId = params.get('employeeId') ?? '';
  const [entities, setEntities] = useState<OrgEntity[]>([]);
  const [chart, setChart] = useState<Chart | null>(null);
  const [depts, setDepts] = useState<Dept[] | null>(null);
  const [companyId, setCompanyId] = useState('');
  // HR, payroll and admins usually browse by department; everyone else starts at their own place in the chart
  const [tab, setTab] = useState<'chart' | 'departments'>(params.get('employeeId') || !can('HR', 'PAYROLL') ? 'chart' : 'departments');
  const [error, setError] = useState('');
  const seesAll = can('HR', 'PAYROLL');
  // Profiles open for HR, payroll and admins; managers can open their own team's
  const canOpen = (n: OrgNode) =>
    seesAll || n.id === me.employee?.id || (me.role === 'MANAGER' && chart?.root?.id === me.employee?.id && !!chart?.reports.some((r) => r.id === n.id));

  useEffect(() => {
    api<OrgEntity[]>('/organisation/entities').then((e) => {
      setEntities(e);
      if (!companyId) setCompanyId(e.find((x) => x.countryCode === (me.employee?.company.countryCode ?? 'KE'))?.id ?? e.find((x) => x.headcount)?.id ?? '');
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!employeeId && (!me.employee || seesAll)) {
      setChart({ chain: [], root: null, reports: [] });
      return;
    }
    setChart(null);
    api<Chart>(`/organisation/chart${employeeId ? `?employeeId=${employeeId}` : ''}`).then(setChart).catch((e) => setError(e.message));
    if (employeeId) setTab('chart');
  }, [employeeId, me.employee, seesAll]);

  useEffect(() => {
    if (tab !== 'departments' || !companyId) return;
    setDepts(null);
    api<Dept[]>(`/organisation/departments${seesAll ? `?companyId=${companyId}` : ''}`).then(setDepts).catch((e) => setError(e.message));
  }, [tab, companyId, seesAll]);

  const pick = (id: string) => router.push(`/organisation?employeeId=${id}`);
  const shown = entities.filter((e) => e.headcount > 0);

  return (
    <>
      <PageHeader
        title="Organisation"
        sub="The Mindspace group: legal entities, departments and reporting lines. Only names, job titles and departments are shown here."
      />
      {error && <div className="notice error">{error}</div>}

      <div className="org-entities">
        {shown.map((e) => (
          <button
            type="button"
            key={e.id}
            className={`org-entity${companyId === e.id && tab === 'departments' ? ' on' : ''}`}
            onClick={() => { if (seesAll || e.countryCode === me.employee?.company.countryCode) { setCompanyId(e.id); setTab('departments'); } }}
            title={e.name}
          >
            <span className="cc">{e.countryCode}</span>
            <span className="org-entity-text">
              <strong>{e.country}</strong>
              <span>{e.headcount.toLocaleString('en-GB')} staff · {e.departments} depts · {e.currency}</span>
            </span>
            {e.payrollRules && (
              <span className="org-rules" title={`Payroll rules ${e.payrollRules.version}${e.payrollRules.verified ? '' : ', not yet signed off'}`}>
                {e.payrollRules.verified ? <ShieldCheck size={15} color="var(--success)" /> : <ShieldAlert size={15} color="var(--warn)" />}
              </span>
            )}
          </button>
        ))}
      </div>

      <nav className="tabs">
        <button className={tab === 'chart' ? 'active' : ''} onClick={() => setTab('chart')}><Network size={15} /> Reporting line</button>
        <button className={tab === 'departments' ? 'active' : ''} onClick={() => setTab('departments')}><Building2 size={15} /> Departments</button>
      </nav>

      {tab === 'chart' && (
        <section className="card">
          {!chart && <div className="loading"><span className="spinner" /> Loading…</div>}
          {chart && !chart.root && (
            <Empty icon={Network} title="Choose someone to start">Open Departments and pick a department head to see their team.</Empty>
          )}
          {chart?.root && (
            <div className="org-tree">
              {chart.chain.map((n) => (
                <div className="org-level" key={n.id}>
                  <Node n={n} onPick={pick} canOpen={canOpen(n)} />
                  <i className="org-line" />
                </div>
              ))}
              <div className="org-level">
                <Node n={chart.root} root onPick={pick} canOpen={canOpen(chart.root)} />
              </div>
              {chart.reports.length > 0 ? (
                <>
                  <i className="org-line" />
                  <div className="org-reports-head">
                    {chart.reports.length} direct report{chart.reports.length === 1 ? '' : 's'}
                  </div>
                  <div className="org-reports">
                    {chart.reports.map((n) => <Node key={n.id} n={n} onPick={pick} canOpen={canOpen(n)} />)}
                  </div>
                </>
              ) : (
                <p className="muted small" style={{ marginTop: '1rem' }}>No direct reports.</p>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'departments' && (
        <div className="card table-wrap">
          <div className="card-head">
            <div>
              <h2>{entities.find((e) => e.id === companyId)?.name ?? 'Departments'}</h2>
              <p className="sub">Department heads lead a reporting line. Pick one to see their team.</p>
            </div>
            {seesAll && (
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ width: 'auto', margin: 0 }} aria-label="Company">
                {shown.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
          <table>
            <thead>
              <tr><th>Department</th><th className="num">Headcount</th><th>Led by</th></tr>
            </thead>
            <tbody>
              {!depts && <tr><td colSpan={3} className="loading"><span className="spinner" /></td></tr>}
              {depts?.map((d) => (
                <tr key={d.department}>
                  <td><strong style={{ fontWeight: 550 }}>{d.department}</strong></td>
                  <td className="num">{d.headcount.toLocaleString('en-GB')}</td>
                  <td>
                    <div className="actions">
                      {d.heads.length === 0 && <span className="muted">No reporting line recorded</span>}
                      {d.heads.slice(0, 3).map((h) => (
                        <button key={h.id} type="button" className="link" onClick={() => pick(h.id)}>
                          {h.firstName} {h.lastName}
                          <span className="muted small"> · {h.jobTitle} ({h.reportCount})</span>
                        </button>
                      ))}
                      {d.heads.length > 3 && <span className="muted small">and {d.heads.length - 3} more</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {depts?.length === 0 && <tr><td colSpan={3} className="empty">No departments.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
