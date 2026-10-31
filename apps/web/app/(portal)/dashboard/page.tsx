'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BookOpenCheck, Briefcase, CalendarCheck, CalendarDays, ClipboardCheck, Clock, FileWarning, HandCoins, Receipt, Target, TrendingDown,
  TrendingUp, Users, Wallet,
} from 'lucide-react';
import {
  ActivityWeek, api, ApprovalItem, compactMoney, hoursAndMinutes, JobOpening, LeaveBalance, LeaveRequest, LOCATION_LABEL, money, Payslip,
  PayrollRun, periodName, Review, Workforce,
} from '@/lib/api';
import { useSession } from '@/lib/session';
import { ColumnChart, Donut, Kpi, StatusBadge } from '@/components/ui';

interface Task { icon: typeof Clock; title: string; detail: string; href: string; action: string; urgent?: boolean }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const STEP: Record<PayrollRun['status'], number> = { DRAFT: 1, APPROVED: 2, FINALIZED: 3 };

export default function DashboardPage() {
  const { me, can } = useSession();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [latest, setLatest] = useState<Payslip | null>(null);
  const [annual, setAnnual] = useState<LeaveBalance | null>(null);
  const [toApprove, setToApprove] = useState<LeaveRequest[]>([]);
  const [moneyQueue, setMoneyQueue] = useState<ApprovalItem[]>([]);
  const [toRead, setToRead] = useState(0);
  const [day, setDay] = useState<ActivityWeek | null>(null);
  const [owed, setOwed] = useState<{ amount: string; currency: string } | null>(null);
  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [reviews, setReviews] = useState<{ own: Review[]; toGive: Review[] }>({ own: [], toGive: [] });
  const [openings, setOpenings] = useState<JobOpening[]>([]);

  const people = can('HR', 'PAYROLL');
  useEffect(() => {
    if (can('PAYROLL')) api<PayrollRun[]>('/payroll/runs').then(setRuns).catch(() => setRuns([]));
    if (people) api<Workforce>('/analytics/workforce').then(setWorkforce).catch(() => setWorkforce(null));
    if (can('HR', 'MANAGER')) {
      api<LeaveRequest[]>('/leave/approvals').then(setToApprove).catch(() => setToApprove([]));
      api<JobOpening[]>('/recruitment/openings?status=OPEN').then(setOpenings).catch(() => setOpenings([]));
    }
    if (can('HR', 'MANAGER', 'PAYROLL', 'FINANCE')) api<ApprovalItem[]>('/approvals').then(setMoneyQueue).catch(() => setMoneyQueue([]));
    if (me.employee) {
      api<Payslip[]>('/payslips/me').then((p) => setLatest(p[0] ?? null)).catch(() => setLatest(null));
      api<LeaveBalance[]>('/leave/balances').then((b) => setAnnual(b.find((x) => x.type === 'ANNUAL') ?? null)).catch(() => setAnnual(null));
      api<{ count: number }>('/library/pending').then((p) => setToRead(p.count)).catch(() => setToRead(0));
      api<ActivityWeek>('/activity/me').then(setDay).catch(() => setDay(null));
      api<{ own: Review[]; toGive: Review[] }>('/performance/reviews/mine').then(setReviews).catch(() => undefined);
      api<{ outstanding: string; employee: { currency: string } }>('/loans')
        .then((l) => setOwed(Number(l.outstanding) > 0 ? { amount: l.outstanding, currency: l.employee.currency } : null))
        .catch(() => setOwed(null));
    }
  }, [me, can, people]);

  const waiting = runs.filter((r) => r.status !== 'FINALIZED');
  const name = me.employee?.firstName ?? 'Administrator';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const workedToday = day ? day.days.find((d) => d.date === day.today)?.workedMinutes ?? 0 : 0;
  const selfDue = reviews.own.find((r) => r.status === 'SELF_REVIEW' && r.cycle.status === 'OPEN');
  const toReview = reviews.toGive.filter((r) => r.status === 'MANAGER_REVIEW');
  const activeCandidates = openings.reduce((s, o) => s + (o.pipeline ? o.pipeline.APPLIED + o.pipeline.SCREENING + o.pipeline.INTERVIEW + o.pipeline.OFFER : 0), 0);

  const tasks: Task[] = [];
  if (me.role === 'ADMIN') {
    for (const r of waiting) {
      tasks.push({
        icon: Wallet,
        title: `${r.status === 'DRAFT' ? 'Approve' : 'Finalise'} ${periodName(r.periodYear, r.periodMonth)} payroll`,
        detail: `${r.company.name} · net ${money(r.totalNet, r.company.currency)}`,
        href: `/payroll/${r.id}`,
        action: r.status === 'DRAFT' ? 'Review' : 'Finalise',
        urgent: true,
      });
    }
  }
  if (toApprove.length) {
    const overdue = toApprove.filter((r) => r.overdue).length;
    tasks.push({ icon: CalendarCheck, title: `${toApprove.length} leave request${toApprove.length === 1 ? '' : 's'} to decide`, detail: overdue ? `${overdue} past the 3-working-day deadline` : 'Respond within 3 working days', href: '/leave/approvals', action: 'Decide', urgent: overdue > 0 });
  }
  if (moneyQueue.length) tasks.push({ icon: ClipboardCheck, title: `${moneyQueue.length} loan or benefit request${moneyQueue.length === 1 ? '' : 's'} to decide`, detail: 'Advances, loans, IOUs, meals, gym and vouchers', href: '/approvals', action: 'Decide' });
  if (toReview.length) tasks.push({ icon: Target, title: `${toReview.length} performance review${toReview.length === 1 ? '' : 's'} to complete`, detail: `Self reviews are in for ${toReview.map((r) => r.employee.firstName).join(', ')}`, href: '/performance', action: 'Review' });
  if (selfDue) tasks.push({ icon: Target, title: 'Complete your self review', detail: `${selfDue.cycle.name} · due ${new Date(selfDue.cycle.selfDueOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, href: '/performance', action: 'Start' });
  if (toRead) tasks.push({ icon: BookOpenCheck, title: `${toRead} polic${toRead === 1 ? 'y' : 'ies'} to read and confirm`, detail: 'Required reading for your role', href: '/policies', action: 'Read' });
  if (workforce && can('HR') && workforce.totals.documentsToVerify) tasks.push({ icon: FileWarning, title: `${workforce.totals.documentsToVerify.toLocaleString('en-GB')} staff documents to verify`, detail: `${workforce.totals.documentsExpired.toLocaleString('en-GB')} documents have expired`, href: '/employees', action: 'Open' });
  if (day && !day.open && me.employee) tasks.push({ icon: Clock, title: 'You have not clocked in today', detail: 'Record your working time under My day', href: '/activity', action: 'Clock in' });

  return (
    <>
      <div className="hello">
        <div>
          <h1>{greeting()}, {name}</h1>
          <p>
            {today}
            {me.employee && <> · {me.employee.jobTitle}, {me.employee.company.name}</>}
          </p>
        </div>
        <div className="quick">
          {me.employee && <Link className="button secondary" href="/leave"><CalendarDays size={16} /> Request leave</Link>}
          {me.employee && <Link className="button secondary" href="/activity"><Clock size={16} /> {day?.open ? 'Clock out' : 'Clock in'}</Link>}
          {can('HR') && <Link className="button secondary" href="/employees"><Users size={16} /> Add employee</Link>}
          {can('PAYROLL') && <Link className="button" href="/payroll"><Wallet size={16} /> Payroll runs</Link>}
        </div>
      </div>

      {/* Key figures: people operations first for HR and payroll, personal figures for everyone else */}
      <div className="grid">
        {workforce && (
          <>
            <Kpi icon={Users} label="Active headcount" value={workforce.totals.headcount.toLocaleString('en-GB')} note={`${workforce.byCompany.filter((c) => c.headcount).length} companies · ${workforce.totals.remoteShare}% fully remote`} href="/analytics" linkLabel="Workforce analytics" />
            <Kpi icon={TrendingUp} tone="teal" label="Joiners, last 12 months" value={workforce.totals.hires12m.toLocaleString('en-GB')} note={`${workforce.totals.exits12m.toLocaleString('en-GB')} leavers in the same period`} />
            <Kpi icon={TrendingDown} tone="amber" label="Attrition rate" value={workforce.totals.attritionRate} unit="%" note="Leavers over average headcount, last 12 months" />
          </>
        )}
        {can('HR', 'MANAGER') && openings.length > 0 && (
          <Kpi icon={Briefcase} tone="violet" label="Open positions" value={openings.reduce((s, o) => s + o.positions, 0)} note={`${activeCandidates} candidates in progress`} href="/recruitment" linkLabel="Recruitment" />
        )}
        {!workforce && day && (
          <Kpi icon={Clock} label={day.open ? 'Clocked in today' : 'Worked today'} value={hoursAndMinutes(workedToday)} note={day.open ? 'Timer running' : 'Not clocked in'} href="/activity" linkLabel={day.open ? 'Clock out or add a note' : 'Clock in'} />
        )}
        {annual && !workforce && (
          <Kpi icon={CalendarDays} tone="teal" label="Annual leave left" value={annual.left} unit="days" note={`${annual.approved} taken or booked, ${annual.pending} waiting approval`} href="/leave" linkLabel="Request leave" />
        )}
        {latest && !workforce && (
          <Kpi icon={Receipt} tone="violet" label="Latest net pay" value={money(latest.net, latest.currency)} note={latest.run ? periodName(latest.run.periodYear, latest.run.periodMonth) : undefined} href={`/payslips/${latest.id}`} linkLabel="Open payslip" />
        )}
        {owed && !workforce && (
          <Kpi icon={HandCoins} tone="amber" label="Advances and loans owed" value={money(owed.amount, owed.currency)} href="/money" linkLabel="See repayments" />
        )}
      </div>

      {/* Signature: every subsidiary with its payroll month on a three-step track (draft, approved, finalised) */}
      {workforce && (
        <>
          <div className="section-title">
            <h2>Group companies</h2>
            <span className="muted small">Headcount and the latest payroll run for each subsidiary</span>
          </div>
          <div className="entities">
            {workforce.byCompany.filter((c) => c.headcount > 0).map((c) => {
              const r = c.latestRun;
              const step = r ? STEP[r.status] : 0;
              const Tag = can('PAYROLL') && r ? Link : 'div';
              return (
                <Tag key={c.companyId} className="entity" href={r ? `/payroll/${r.id}` : '/payroll'}>
                  <div className="entity-top">
                    <span className="cc">{c.countryCode}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="entity-name">{c.country}</div>
                      <div className="entity-meta">{c.headcount.toLocaleString('en-GB')} staff · {c.currency}</div>
                    </div>
                  </div>
                  <div className={`track s${step}`} aria-hidden="true"><i /><i /><i /></div>
                  <div className="track-label">
                    <span>{r ? periodName(r.periodYear, r.periodMonth) : 'No payroll yet'}</span>
                    {r && <StatusBadge status={r.status} />}
                  </div>
                  {c.lastPayroll && (
                    <div className="entity-meta">Last net pay {compactMoney(c.lastPayroll.totalNet, c.currency)}</div>
                  )}
                </Tag>
              );
            })}
          </div>
        </>
      )}

      <div className="grid-2-1" style={{ marginTop: '1rem' }}>
        <section className="card flush">
          <div className="card-head">
            <div>
              <h2>Waiting for you</h2>
              <p className="sub">{tasks.length ? `${tasks.length} item${tasks.length === 1 ? ' needs' : 's need'} your attention` : 'Nothing needs your attention right now'}</p>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="empty">
              <ClipboardCheck size={36} strokeWidth={1.5} />
              <strong>You are up to date</strong>
              <div className="small">New approvals, reviews and policies will appear here.</div>
            </div>
          ) : (
            <ul className="task-list">
              {tasks.map((t) => (
                <li key={t.href + t.title}>
                  <span className="t-icon" style={t.urgent ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : undefined}>
                    <t.icon size={17} />
                  </span>
                  <div className="t-main">
                    <strong>{t.title}</strong>
                    <span>{t.detail}</span>
                  </div>
                  <Link className="button secondary small" href={t.href}>{t.action}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div>
          {workforce ? (
            <section className="card">
              <h2>Where people work</h2>
              <Donut items={workforce.byLocation} label="active staff" />
            </section>
          ) : (
            me.employee && (
              <section className="card">
                <h2>About you</h2>
                <dl className="fields" style={{ gridTemplateColumns: '1fr' }}>
                  <div><dt>Role</dt><dd>{me.employee.jobTitle}</dd></div>
                  <div><dt>Department</dt><dd>{me.employee.department}</dd></div>
                  <div><dt>Work location</dt><dd>{LOCATION_LABEL[me.employee.workLocation as keyof typeof LOCATION_LABEL]}</dd></div>
                  <div><dt>Employee number</dt><dd>{me.employee.employeeNo}</dd></div>
                </dl>
                <div className="actions" style={{ marginTop: '1rem' }}>
                  <Link className="button secondary small" href="/profile">My profile</Link>
                  <Link className="button secondary small" href="/organisation">My team</Link>
                </div>
              </section>
            )
          )}
        </div>
      </div>

      {workforce && (
        <div className="grid-2">
          <section className="card">
            <div className="card-head" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
              <div>
                <h2>Joiners and leavers</h2>
                <p className="sub">Last 12 months, all companies</p>
              </div>
            </div>
            <ColumnChart items={workforce.monthly.map((m) => ({ label: m.label, a: m.hires, b: m.exits }))} aLabel="Joiners" bLabel="Leavers" />
          </section>
          <section className="card">
            <div className="card-head" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
              <div>
                <h2>Compliance</h2>
                <p className="sub">Records that need HR action</p>
              </div>
            </div>
            <dl className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><dt>Documents to verify</dt><dd className="kpi-value" style={{ fontSize: '1.4rem', marginTop: 4 }}>{workforce.totals.documentsToVerify.toLocaleString('en-GB')}</dd></div>
              <div><dt>Expired documents</dt><dd className="kpi-value" style={{ fontSize: '1.4rem', marginTop: 4, color: 'var(--danger)' }}>{workforce.totals.documentsExpired.toLocaleString('en-GB')}</dd></div>
              <div><dt>On leave today</dt><dd className="kpi-value" style={{ fontSize: '1.4rem', marginTop: 4 }}>{workforce.totals.onLeaveToday}</dd></div>
              <div><dt>People managers</dt><dd className="kpi-value" style={{ fontSize: '1.4rem', marginTop: 4 }}>{workforce.totals.managers.toLocaleString('en-GB')}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
