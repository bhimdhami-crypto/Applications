'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, ROLE_LABEL } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

/** Unread chat messages, policies to read and open reports, refreshed every 30 seconds */
function useCounts() {
  const { me, can } = useSession();
  const path = usePathname();
  const [counts, setCounts] = useState({ chat: 0, policies: 0, reports: 0 });
  const moderator = can('HR');
  useEffect(() => {
    let live = true;
    const load = () => {
      Promise.all([
        api<{ count: number }>('/chat/unread').catch(() => ({ count: 0 })),
        me.employee ? api<{ count: number }>('/library/pending').catch(() => ({ count: 0 })) : { count: 0 },
        moderator ? api<{ count: number }>('/reports/open').catch(() => ({ count: 0 })) : { count: 0 },
      ]).then(([chat, policies, reports]) => live && setCounts({ chat: chat.count, policies: policies.count, reports: reports.count }));
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // Reload on navigation too, so reading a chat or a policy clears its count
  }, [me.employee, moderator, path]);
  return counts;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, signOut } = useSession();
  const path = usePathname();
  const ownProfile = me.employee ? `/employees/${me.employee.id}` : '';
  const counts = useCounts();
  const links: { href: string; label: string; show: boolean; section?: string; count?: number }[] = [
    { href: '/dashboard', label: 'Home', show: true },
    { href: '/profile', label: 'My profile', show: !!me.employee },
    { href: '/activity', label: 'My day', show: !!me.employee },
    { href: '/leave', label: 'My leave', show: !!me.employee },
    { href: '/money', label: 'Advances and loans', show: !!me.employee },
    { href: '/benefits', label: 'Benefits', show: !!me.employee || can('HR', 'PAYROLL', 'FINANCE') },
    { href: '/payslips', label: 'My payslips', show: !!me.employee },
    { href: '/chat', label: 'Chat', show: true, section: 'Workplace', count: counts.chat },
    { href: '/community', label: 'Community', show: true },
    { href: '/policies', label: 'Policies and forms', show: true, count: counts.policies },
    { href: '/leave/calendar', label: 'Leave calendar', show: true },
    { href: '/leave/approvals', label: 'Leave approvals', show: can('HR', 'MANAGER'), section: 'Manage' },
    { href: '/approvals', label: 'Loan and benefit approvals', show: can('HR', 'MANAGER', 'PAYROLL', 'FINANCE') },
    { href: '/activity/team', label: 'Team activity', show: can('HR', 'MANAGER', 'PAYROLL') },
    { href: '/employees', label: me.role === 'MANAGER' ? 'My team' : 'Employees', show: can('HR', 'PAYROLL', 'MANAGER') },
    { href: '/loans', label: 'Loan book', show: can('PAYROLL', 'FINANCE') },
    { href: '/payroll', label: 'Payroll', show: can('PAYROLL') },
    { href: '/moderation', label: 'Moderation', show: can('HR'), count: counts.reports },
  ];
  // The most specific link wins (/leave/approvals over /leave); your own record under /employees highlights "My profile"
  const activeHref = ownProfile && path === ownProfile
    ? '/profile'
    : links.filter((l) => l.show && (path === l.href || path.startsWith(`${l.href}/`))).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (l: (typeof links)[number]) => l.href === activeHref;
  return (
    <div className="shell">
      <nav className="sidebar">
        <img src="/logo.svg" alt="Mindspace" />
        {(() => {
          // A section heading shows above the first visible link of its section
          let section = '';
          return links
            .filter((l) => l.show)
            .map((l, i, shown) => {
              const heading = shown.slice(0, i + 1).reverse().find((x) => x.section)?.section ?? '';
              const first = heading !== section;
              section = heading;
              return (
                <Fragment key={l.href}>
                  {first && <div className="nav-section">{heading}</div>}
                  <Link href={l.href} className={isActive(l) ? 'active' : ''}>
                    {l.label}
                    {!!l.count && <span className="count" aria-label={`${l.count} new`}>{l.count > 99 ? '99+' : l.count}</span>}
                  </Link>
                </Fragment>
              );
            });
        })()}
        <div className="who">
          <div>{me.employee ? `${me.employee.firstName} ${me.employee.lastName}` : me.email}</div>
          <div>{ROLE_LABEL[me.role]}</div>
          <button className="secondary small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
