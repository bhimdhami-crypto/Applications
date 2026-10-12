'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLE_LABEL } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, signOut } = useSession();
  const path = usePathname();
  const ownProfile = me.employee ? `/employees/${me.employee.id}` : '';
  const links: { href: string; label: string; show: boolean; match?: string }[] = [
    { href: '/dashboard', label: 'Home', show: true },
    { href: '/profile', label: 'My profile', show: !!me.employee, match: ownProfile },
    { href: '/employees', label: me.role === 'MANAGER' ? 'My team' : 'Employees', show: can('HR', 'PAYROLL', 'MANAGER') },
    { href: '/payroll', label: 'Payroll', show: can('PAYROLL') },
    { href: '/payslips', label: 'My payslips', show: !!me.employee },
  ];
  // Your own record lives under /employees, so it highlights "My profile" rather than the staff list
  const isActive = (l: (typeof links)[number]) =>
    l.match ? path === l.match || path.startsWith(l.href) : path.startsWith(l.href) && !(ownProfile && path === ownProfile);
  return (
    <div className="shell">
      <nav className="sidebar">
        <img src="/logo.svg" alt="Mindspace" />
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
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
