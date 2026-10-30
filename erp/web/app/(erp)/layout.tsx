'use client';

import { Archive, BookOpen, CheckSquare, Clock, FileText, History, ListChecks, LogOut, Notebook, Scale, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PendingVoucher, api } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator',
  DIRECTOR: 'Director',
  FINANCE_MANAGER: 'Finance manager',
  ACCOUNTANT: 'Accountant',
  VIEWER: 'Viewer',
};

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, companies, company, setCompany, signOut, can } = useSession();
  const [pending, setPending] = useState(0);

  // The count beside "Approvals" is everything waiting for this person, in every company
  useEffect(() => {
    api<PendingVoucher[]>('/approvals/pending')
      .then((p) => setPending(p.length))
      .catch(() => setPending(0));
  }, [path]);

  const groups = [
    {
      title: '',
      links: [
        { href: '/approvals', label: 'Approvals', icon: CheckSquare, count: pending },
        { href: '/vouchers', label: 'Vouchers', icon: FileText },
        { href: '/archive', label: 'Archive', icon: Archive },
      ],
    },
    {
      title: 'Reports',
      links: [
        { href: '/trial-balance', label: 'Trial balance', icon: Scale },
        { href: '/reports/general-ledger', label: 'General ledger', icon: Notebook },
        { href: '/reports/aged-debtors', label: 'Aged debtors', icon: Clock },
        { href: '/reports/aged-creditors', label: 'Aged creditors', icon: Clock },
      ],
    },
    {
      title: 'Records',
      links: [
        { href: '/customers', label: 'Customers', icon: Users },
        { href: '/suppliers', label: 'Suppliers', icon: Truck },
        { href: '/accounts', label: 'Chart of accounts', icon: BookOpen },
        { href: '/approval-rules', label: 'Approval rules', icon: ListChecks },
        ...(can('FINANCE_MANAGER', 'DIRECTOR') ? [{ href: '/history', label: 'Change history', icon: History }] : []),
      ],
    },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          MFI <span>ERP</span>
        </div>
        {groups.map((g) => (
          <div key={g.title} style={{ display: 'contents' }}>
            {g.title && <div className="nav-group">{g.title}</div>}
            {g.links.map(({ href, label, icon: Icon, ...rest }) => {
              const count = 'count' in rest ? rest.count : 0;
              return (
                <Link key={href} href={href} className={`nav-link${path.startsWith(href) ? ' active' : ''}`}>
                  <Icon size={17} />
                  {label}
                  {!!count && <span className="nav-count">{count}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="sidebar-foot">
          <div>
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user.name ?? user.email}</div>
            <div>{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
          <button className="btn small" onClick={signOut}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <label className="muted" htmlFor="company">
            Company
          </label>
          <select id="company" value={company.code} onChange={(e) => setCompany(e.target.value)}>
            {companies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name && c.name !== c.code ? `${c.code} · ${c.name}` : c.code}
              </option>
            ))}
          </select>
          <span className="muted">Amounts in {company.homeCurrency}</span>
          <div className="spacer" />
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
