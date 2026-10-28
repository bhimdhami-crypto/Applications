'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, Inbox } from 'lucide-react';
import { ReactNode } from 'react';

/* ---------------------------------------------------------------------------
   Shared building blocks for every portal page. Pages stay plain JSX; these
   keep headers, tiles, statuses and charts consistent across modules.
   ------------------------------------------------------------------------- */

export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <Link className="back-link" href={back.href}>
            <ArrowLeft size={14} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

type Tone = 'blue' | 'teal' | 'amber' | 'violet' | 'red';

export function Kpi({
  icon: Icon,
  label,
  value,
  unit,
  note,
  href,
  linkLabel,
  tone = 'blue',
  delta,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  href?: string;
  linkLabel?: string;
  tone?: Tone;
  delta?: { value: string; dir: 'up' | 'down' | 'flat' };
}) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <span className={`kpi-icon ${tone === 'blue' ? '' : tone}`}>
          <Icon size={17} strokeWidth={2} />
        </span>
        <span>{label}</span>
        {delta && <span className={`delta ${delta.dir}`} style={{ marginLeft: 'auto' }}>{delta.value}</span>}
      </div>
      <div className="kpi-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {note && <div className="kpi-note">{note}</div>}
      {href && (
        <Link className="kpi-link" href={href}>
          {linkLabel ?? 'Open'} <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_MANAGER: 'With manager',
  PENDING_HR: 'With HR',
  PENDING_PAYROLL: 'With payroll',
  PENDING_FINANCE: 'With finance',
  PENDING_COUNTRY_HEAD: 'With country head',
  FINALIZED: 'Finalised',
  TERMINATED: 'Left',
  SELF_REVIEW: 'Self review',
  MANAGER_REVIEW: 'Manager review',
};

/** Turns an enum like PENDING_MANAGER into readable text. */
export function statusText(status: string) {
  if (STATUS_TEXT[status]) return STATUS_TEXT[status];
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${status}`}>{label ?? statusText(status)}</span>;
}

export function Empty({ icon: Icon = Inbox, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={36} strokeWidth={1.5} />
      <strong>{title}</strong>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export const CHART_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

const fmt = (n: number) => n.toLocaleString('en-GB');

/** Horizontal bars: one row per item, scaled to the largest. */
export function BarList({ items, color = 'var(--c1)', format = fmt }: { items: { label: string; value: number; color?: string }[]; color?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar-row" key={i.label}>
          <span className="bar-label" title={i.label}>{i.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color, display: 'block' }} />
          </span>
          <span className="bar-value">{format(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** One stacked bar with a legend: parts of a whole. */
export function StackBar({ items }: { items: { label: string; value: number }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div>
      <div className="stack" role="img" aria-label={items.map((i) => `${i.label} ${i.value}`).join(', ')}>
        {items.map((i, n) => (
          <span key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: CHART_COLORS[n % CHART_COLORS.length] }} />
        ))}
      </div>
      <div className="stack-legend">
        {items.map((i, n) => (
          <span key={i.label}>
            <i style={{ background: CHART_COLORS[n % CHART_COLORS.length] }} />
            {i.label} <b>{fmt(i.value)}</b>
            <span className="muted">({Math.round((i.value / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut with the total in the middle. */
export function Donut({ items, label = 'Total', size = 148 }: { items: { label: string; value: number }[]; label?: string; size?: number }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = 15.9155;
  let offset = 25;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={`${label}: ${total}`}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
        {total > 0 &&
          items.map((i, n) => {
            const pct = (i.value / total) * 100;
            const el = (
              <circle
                key={i.label}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                stroke={CHART_COLORS[n % CHART_COLORS.length]}
                strokeWidth="5"
                strokeDasharray={`${Math.max(pct - 0.6, 0)} ${100 - Math.max(pct - 0.6, 0)}`}
                strokeDashoffset={offset}
              />
            );
            offset = (offset - pct + 100) % 100;
            return el;
          })}
        <text x="21" y="21.5" textAnchor="middle" className="donut-center">{fmt(total)}</text>
        <text x="21" y="26.5" textAnchor="middle" className="donut-sub">{label}</text>
      </svg>
      <div className="stack-legend" style={{ flexDirection: 'column', marginTop: 0 }}>
        {items.map((i, n) => (
          <span key={i.label}>
            <i style={{ background: CHART_COLORS[n % CHART_COLORS.length] }} />
            {i.label} <b>{fmt(i.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical columns, optionally paired (a, b) per period, e.g. hires and leavers. */
export function ColumnChart({ items, aLabel, bLabel }: { items: { label: string; a: number; b?: number }[]; aLabel: string; bLabel?: string }) {
  const max = Math.max(1, ...items.flatMap((i) => [i.a, i.b ?? 0]));
  return (
    <div>
      <div className="colchart" role="img" aria-label={`${aLabel}${bLabel ? ` and ${bLabel}` : ''} by month`}>
        {items.map((i) => (
          <div className="col" key={i.label} title={`${i.label}: ${aLabel} ${i.a}${bLabel ? `, ${bLabel} ${i.b ?? 0}` : ''}`}>
            <div className="col-bars">
              <span className="col-bar" style={{ height: `${(i.a / max) * 100}%` }} />
              {bLabel && <span className="col-bar b" style={{ height: `${((i.b ?? 0) / max) * 100}%` }} />}
            </div>
            <span className="col-label">{i.label}</span>
          </div>
        ))}
      </div>
      <div className="stack-legend">
        <span><i style={{ background: 'var(--c1)' }} />{aLabel}</span>
        {bLabel && <span><i style={{ background: 'var(--c2)' }} />{bLabel}</span>}
      </div>
    </div>
  );
}

export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="stars" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? '' : 'off'}>★</span>
      ))}
    </span>
  );
}
