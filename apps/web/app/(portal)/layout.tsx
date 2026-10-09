'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLE_LABEL } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, signOut } = useSession();
  const path = usePathname();
  const links = [
    { href: '/dashboard', label: 'Home', show: true },
    { href: '/employees', label: 'Employees', show: can('HR', 'PAYROLL', 'MANAGER') },
    { href: '/payroll', label: 'Payroll', show: can('PAYROLL') },
    { href: '/payslips', label: 'My payslips', show: !!me.employee },
  ];
  return (
    <div className="shell">
      <nav className="sidebar">
        <img src="/logo.svg" alt="Mindspace" />
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? 'active' : ''}>
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
