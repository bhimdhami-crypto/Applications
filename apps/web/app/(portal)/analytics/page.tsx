'use client';

import { useEffect, useState } from 'react';
import { Briefcase, CalendarClock, Download, Hourglass, TrendingDown, TrendingUp, Users, UserRoundCheck } from 'lucide-react';
import { api, Company, compactMoney, periodName, Workforce } from '@/lib/api';
import { BarList, ColumnChart, Donut, Kpi, PageHeader, StackBar, StatusBadge } from '@/components/ui';

/** Workforce analytics for HR, payroll and admins: counts only, never individual records. */
export default function AnalyticsPage() {
  const [data, setData] = useState<Workforce | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Company[]>('/companies').then((c) => setCompanies(c.filter((x) => x.payrollRules))).catch(() => setCompanies([]));
  }, []);
  useEffect(() => {
    setData(null);
    api<Workforce>(`/analytics/workforce${companyId ? `?companyId=${companyId}` : ''}`).then(setData).catch((e) => setError(e.message));
  }, [companyId]);

  /** Every breakdown in one CSV, for a board pack or spreadsheet */
  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [['Section', 'Item', 'Value']];
    for (const [k, v] of Object.entries(data.totals)) rows.push(['Totals', k, v]);
    const add = (section: string, list: { label: string; value: number }[]) => list.forEach((i) => rows.push([section, i.label, i.value]));
    add('Department', data.byDepartment);
    add('Work location', data.byLocation);
    add('Contract', data.byContract);
    add('Gender', data.byGender);
    add('Grade', data.byGrade);
    add('Tenure', data.tenure);
    add('Age', data.age);
    add('Exit reason', data.exitReasons);
    data.monthly.forEach((m) => rows.push(['Joiners by month', m.label, m.hires], ['Leavers by month', m.label, m.exits]));
    data.byCompany.forEach((c) => rows.push(['Headcount by company', c.name, c.headcount]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `workforce-${data.asOf}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const t = data?.totals;
  const companiesShown = data?.byCompany.filter((c) => c.headcount > 0) ?? [];

  return (
    <>
      <PageHeader
        title="Workforce analytics"
        sub={data ? `Active staff as of ${new Date(data.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Movement covers the last 12 months.` : 'Headcount, movement and make-up of the workforce.'}
        actions={
          <>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company" style={{ width: 'auto', margin: 0, minWidth: 220 }}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="secondary" onClick={exportCsv} disabled={!data}><Download size={16} /> Export CSV</button>
          </>
        }
      />
      {error && <div className="notice error">{error}</div>}
      {!data && !error && <div className="loading"><span className="spinner" /> Crunching the numbers…</div>}

      {data && t && (
        <>
          <div className="grid kpi-6">
            <Kpi icon={Users} label="Active headcount" value={t.headcount.toLocaleString('en-GB')} note={`${t.managers.toLocaleString('en-GB')} people managers`} />
            <Kpi icon={TrendingUp} tone="teal" label="Joiners" value={t.hires12m.toLocaleString('en-GB')} note="Last 12 months" />
            <Kpi icon={TrendingDown} tone="red" label="Leavers" value={t.exits12m.toLocaleString('en-GB')} note={`Attrition ${t.attritionRate}% a year`} />
            <Kpi icon={Hourglass} tone="violet" label="Average tenure" value={t.avgTenureYears} unit="years" note={`Average age ${t.avgAge}`} />
            <Kpi icon={CalendarClock} tone="amber" label="On leave today" value={t.onLeaveToday} note={`${t.remoteShare}% of staff fully remote`} />
            <Kpi icon={Briefcase} label="Open positions" value={t.openPositions} note="Across open job openings" href="/recruitment" linkLabel="Recruitment" />
          </div>

          <div className="grid-2-1">
            <section className="card">
              <div className="card-head" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
                <div>
                  <h2>Joiners and leavers by month</h2>
                  <p className="sub">Net change {t.hires12m - t.exits12m >= 0 ? '+' : ''}{(t.hires12m - t.exits12m).toLocaleString('en-GB')} people over 12 months</p>
                </div>
              </div>
              <ColumnChart items={data.monthly.map((m) => ({ label: m.label, a: m.hires, b: m.exits }))} aLabel="Joiners" bLabel="Leavers" />
            </section>
            <section className="card">
              <h2>Contract types</h2>
              <Donut items={data.byContract} label="staff" size={136} />
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>Headcount by department</h2>
              <BarList items={data.byDepartment.slice(0, 12)} />
            </section>
            <section className="card">
              <h2>Headcount by grade</h2>
              <BarList items={data.byGrade} color="var(--c4)" />
            </section>
          </div>

          <div className="grid-3">
            <section className="card">
              <h2>Length of service</h2>
              <BarList items={data.tenure} color="var(--c5)" />
            </section>
            <section className="card">
              <h2>Age profile</h2>
              <BarList items={data.age} color="var(--c6)" />
            </section>
            <section className="card">
              <h2>Why people left</h2>
              {data.exitReasons.length ? <BarList items={data.exitReasons} color="var(--c8)" /> : <p className="muted">No leavers in the last 12 months.</p>}
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>Gender balance</h2>
              <StackBar items={data.byGender} />
            </section>
            <section className="card">
              <h2>Work location</h2>
              <StackBar items={data.byLocation} />
            </section>
          </div>

          {companiesShown.length > 0 && (
            <div className="card table-wrap">
              <div className="card-head">
                <div>
                  <h2>By company</h2>
                  <p className="sub">Each subsidiary pays in its own currency, so pay figures are not added up across companies.</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="num">Headcount</th>
                    <th className="num">Joiners</th>
                    <th className="num">Leavers</th>
                    <th className="num">Turnover</th>
                    <th>Latest payroll</th>
                    <th className="num">Last net pay</th>
                    <th className="num">Last employer cost</th>
                  </tr>
                </thead>
                <tbody>
                  {companiesShown.map((c) => (
                    <tr key={c.companyId}>
                      <td>
                        <span className="person">
                          <span className="cc">{c.countryCode}</span>
                          <span>{c.country}<span className="sub">{c.currency}</span></span>
                        </span>
                      </td>
                      <td className="num">{c.headcount.toLocaleString('en-GB')}</td>
                      <td className="num">{c.hires12m.toLocaleString('en-GB')}</td>
                      <td className="num">{c.exits12m.toLocaleString('en-GB')}</td>
                      <td className="num">{c.headcount ? `${Math.round((c.exits12m / c.headcount) * 1000) / 10}%` : ''}</td>
                      <td>{c.latestRun ? <span className="actions" style={{ gap: '0.4rem' }}>{periodName(c.latestRun.periodYear, c.latestRun.periodMonth)} <StatusBadge status={c.latestRun.status} /></span> : <span className="muted">None yet</span>}</td>
                      <td className="num">{c.lastPayroll ? compactMoney(c.lastPayroll.totalNet, c.currency) : ''}</td>
                      <td className="num">{c.lastPayroll ? compactMoney(c.lastPayroll.employerCost, c.currency) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <UserRoundCheck size={14} /> Figures are counts of records, never individual details. Turnover is leavers in the last 12 months over today&apos;s headcount.
          </p>
        </>
      )}
    </>
  );
}
