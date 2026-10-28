'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck, BarChart3, Bell, BookOpenCheck, Briefcase, CalendarCheck, CalendarDays, CalendarRange, ChevronDown, ChevronRight,
  Clock, ClipboardCheck, Gift, HandCoins, History, LayoutDashboard, Landmark, LogOut, Menu, MessagesSquare, Monitor, Moon,
  Network, PanelLeftClose, PanelLeftOpen, Receipt, Search, ShieldAlert, Sun, Target, User, Users, UsersRound, Wallet, Megaphone,
  CalendarClock, Settings2, Scale,
} from 'lucide-react';
import { api, ROLE_LABEL } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { Theme, useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { AppFooter } from '@/components/AppFooter';

interface Counts { chat: number; policies: number; reports: number; leave: number; money: number }

/** Badge counts for the menu and the bell: refreshed every 30 seconds and on navigation. */
function useCounts() {
  const { me, can } = useSession();
  const path = usePathname();
  const [counts, setCounts] = useState<Counts>({ chat: 0, policies: 0, reports: 0, leave: 0, money: 0 });
  const moderator = can('HR');
  const leaveApprover = can('HR', 'MANAGER');
  const moneyApprover = can('HR', 'MANAGER', 'PAYROLL', 'FINANCE');
  useEffect(() => {
    let live = true;
    const zero = { count: 0 };
    const load = () => {
      Promise.all([
        api<{ count: number }>('/chat/unread').catch(() => zero),
        me.employee ? api<{ count: number }>('/library/pending').catch(() => zero) : zero,
        moderator ? api<{ count: number }>('/reports/open').catch(() => zero) : zero,
        leaveApprover ? api<unknown[]>('/leave/approvals').then((l) => ({ count: l.length })).catch(() => zero) : zero,
        moneyApprover ? api<unknown[]>('/approvals').then((l) => ({ count: l.length })).catch(() => zero) : zero,
      ]).then(([chat, policies, reports, leave, money]) =>
        live && setCounts({ chat: chat.count, policies: policies.count, reports: reports.count, leave: leave.count, money: money.count }),
      );
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [me.employee, moderator, leaveApprover, moneyApprover, path]);
  return counts;
}

interface NavLink { href: string; label: string; icon: LucideIcon; show: boolean; count?: number }
interface NavGroup { id: string; label: string; links: NavLink[] }

function useNav(counts: Counts): NavGroup[] {
  const { me, can } = useSession();
  const self = !!me.employee;
  return [
    {
      id: 'overview',
      label: 'Overview',
      links: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { href: '/analytics', label: 'Workforce analytics', icon: BarChart3, show: can('HR', 'PAYROLL') },
      ],
    },
    {
      id: 'self',
      label: 'My workspace',
      links: [
        { href: '/profile', label: 'My profile', icon: User, show: self },
        { href: '/activity', label: 'My day', icon: Clock, show: self },
        { href: '/leave', label: 'My leave', icon: CalendarDays, show: self },
        { href: '/payslips', label: 'My payslips', icon: Receipt, show: self },
        { href: '/money', label: 'Advances and loans', icon: HandCoins, show: self },
        { href: '/benefits', label: 'Benefits', icon: Gift, show: self || can('HR', 'PAYROLL', 'FINANCE') },
        { href: '/performance', label: 'Performance', icon: Target, show: self || can('HR') },
      ],
    },
    {
      id: 'people',
      label: 'People',
      links: [
        { href: '/employees', label: me.role === 'MANAGER' ? 'My team' : 'Employees', icon: Users, show: can('HR', 'PAYROLL', 'MANAGER') },
        { href: '/organisation', label: 'Organisation', icon: Network, show: true },
        { href: '/recruitment', label: 'Recruitment', icon: Briefcase, show: can('HR', 'MANAGER') },
        { href: '/activity/team', label: 'Team attendance', icon: CalendarClock, show: can('HR', 'MANAGER', 'PAYROLL') },
        { href: '/leave/calendar', label: 'Leave calendar', icon: CalendarRange, show: true },
      ],
    },
    {
      id: 'approvals',
      label: 'Approvals',
      links: [
        { href: '/leave/approvals', label: 'Leave approvals', icon: CalendarCheck, show: can('HR', 'MANAGER'), count: counts.leave },
        { href: '/approvals', label: 'Loans and benefits', icon: ClipboardCheck, show: can('HR', 'MANAGER', 'PAYROLL', 'FINANCE'), count: counts.money },
      ],
    },
    {
      id: 'payroll',
      label: 'Payroll and finance',
      links: [
        { href: '/payroll', label: 'Payroll runs', icon: Wallet, show: can('PAYROLL') },
        { href: '/loans', label: 'Loan book', icon: Landmark, show: can('PAYROLL', 'FINANCE') },
      ],
    },
    {
      id: 'workplace',
      label: 'Workplace',
      links: [
        { href: '/chat', label: 'Chat', icon: MessagesSquare, show: true, count: counts.chat },
        { href: '/community', label: 'Community', icon: Megaphone, show: true },
        { href: '/policies', label: 'Policies and forms', icon: BookOpenCheck, show: true, count: counts.policies },
      ],
    },
    {
      id: 'admin',
      label: 'Administration',
      links: [
        { href: '/policies/manage', label: 'Manage policies', icon: Settings2, show: can('HR') },
        { href: '/benefits/manage', label: 'Benefit options', icon: BadgeCheck, show: can('HR', 'PAYROLL', 'FINANCE') },
        { href: '/leave/holidays', label: 'Public holidays', icon: CalendarDays, show: can('HR') },
        { href: '/moderation', label: 'Moderation', icon: ShieldAlert, show: can('HR'), count: counts.reports },
        { href: '/audit', label: 'Audit trail', icon: History, show: me.role === 'ADMIN' },
      ],
    },
  ]
    .map((g) => ({ ...g, links: g.links.filter((l) => l.show) }))
    .filter((g) => g.links.length > 0);
}

const load = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the default is fine */
  }
};

/** Closes a popover when the user clicks outside it or presses Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { me, can, signOut } = useSession();
  const path = usePathname();
  const router = useRouter();
  const counts = useCounts();
  const groups = useNav(counts);
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const [menu, setMenu] = useState<'' | 'bell' | 'user'>('');
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const closeMenu = () => setMenu('');
  const bellRef = useDismiss(menu === 'bell', closeMenu);
  const userRef = useDismiss(menu === 'user', closeMenu);

  useEffect(() => {
    setCollapsed(load('mindspace.nav.collapsed') === '1');
    setClosedGroups((load('mindspace.nav.closed') ?? '').split(',').filter(Boolean));
  }, []);
  useEffect(() => {
    setNavOpen(false);
    setMenu('');
  }, [path]);
  // "/" focuses the search box, like most admin tools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const ownProfile = me.employee ? `/employees/${me.employee.id}` : '';
  const allLinks = groups.flatMap((g) => g.links);
  // The most specific link wins (/leave/approvals over /leave); your own record highlights "My profile"
  const activeHref = ownProfile && path === ownProfile
    ? '/profile'
    : allLinks.filter((l) => path === l.href || path.startsWith(`${l.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = allLinks.find((l) => l.href === activeHref);
  const activeGroup = groups.find((g) => g.links.some((l) => l.href === activeHref));

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    save('mindspace.nav.collapsed', collapsed ? '0' : '1');
  };
  const toggleGroup = (id: string) => {
    const next = closedGroups.includes(id) ? closedGroups.filter((g) => g !== id) : [...closedGroups, id];
    setClosedGroups(next);
    save('mindspace.nav.closed', next.join(','));
  };

  const canSearch = can('HR', 'PAYROLL', 'MANAGER');
  function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/employees?q=${encodeURIComponent(term)}` : '/employees');
    setQ('');
    searchRef.current?.blur();
  }

  const alerts = [
    { href: '/leave/approvals', label: 'Leave requests to decide', icon: CalendarCheck, count: counts.leave },
    { href: '/approvals', label: 'Loan and benefit requests to decide', icon: ClipboardCheck, count: counts.money },
    { href: '/policies', label: 'Policies to read and confirm', icon: BookOpenCheck, count: counts.policies },
    { href: '/chat', label: 'Unread chat messages', icon: MessagesSquare, count: counts.chat },
    { href: '/moderation', label: 'Reports to review', icon: ShieldAlert, count: counts.reports },
  ].filter((a) => a.count > 0);
  const alertTotal = alerts.reduce((s, a) => s + a.count, 0);

  const name = me.employee ? `${me.employee.firstName} ${me.employee.lastName}` : 'Administrator';
  const now = new Date();
  const period = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const themes: { id: Theme; label: string; icon: LucideIcon }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'Auto', icon: Monitor },
  ];

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <nav className="sidebar" aria-label="Main menu">
        <Link href="/dashboard" className="side-brand" style={{ textDecoration: 'none' }}>
          <span className="tile"><img src="/logo-mark.svg" alt="" /></span>
          <span className="words">
            <strong>mindspace</strong>
            <span>HR and payroll</span>
          </span>
        </Link>
        <div className="side-nav">
          {groups.map((g) => {
            const closed = closedGroups.includes(g.id) && g.id !== activeGroup?.id;
            return (
              <div key={g.id} className={`nav-group${closed ? ' closed' : ''}`}>
                <button type="button" className="nav-group-head" onClick={() => toggleGroup(g.id)} aria-expanded={!closed}>
                  <span>{g.label}</span>
                  <ChevronDown size={14} />
                </button>
                <div className="nav-items">
                  {g.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`nav-item${l.href === activeHref ? ' active' : ''}`}
                      title={collapsed ? l.label : undefined}
                      aria-current={l.href === activeHref ? 'page' : undefined}
                    >
                      <l.icon size={18} strokeWidth={1.9} />
                      <span className="label">{l.label}</span>
                      {!!l.count && <span className="count" aria-label={`${l.count} new`}>{l.count > 99 ? '99+' : l.count}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="side-foot">
          <button type="button" className="side-collapse" onClick={toggleCollapsed} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>Collapse menu</span>
          </button>
        </div>
      </nav>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="workspace">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="crumbs">
            {activeGroup && <span>{activeGroup.label}</span>}
            {activeGroup && <ChevronRight size={14} />}
            <strong>{active?.label ?? 'Mindspace HR'}</strong>
          </div>
          {canSearch ? (
            <form className="top-search" onSubmit={search} role="search">
              <Search size={16} />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name, number or job" aria-label="Search people" />
              <kbd>/</kbd>
            </form>
          ) : (
            <span className="spacer" />
          )}
          <span className="period-pill" title="Current payroll month">
            <i /> Pay period {period}
          </span>
          <div className="pop-wrap" ref={bellRef}>
            <button type="button" className="icon-btn" onClick={() => setMenu(menu === 'bell' ? '' : 'bell')} aria-label={`Notifications${alertTotal ? `: ${alertTotal}` : ''}`} aria-expanded={menu === 'bell'}>
              <Bell size={19} />
              {alertTotal > 0 && <span className="dot">{alertTotal > 99 ? '99+' : alertTotal}</span>}
            </button>
            {menu === 'bell' && (
              <div className="popover" style={{ minWidth: 320 }}>
                <div className="pop-head">
                  <strong>Needs your attention</strong>
                  <span>{alertTotal ? `${alertTotal} item${alertTotal === 1 ? '' : 's'} waiting` : 'You are up to date'}</span>
                </div>
                {alerts.length === 0 && <div className="pop-empty">Nothing is waiting for you.</div>}
                {alerts.map((a) => (
                  <Link key={a.href} href={a.href} className="pop-item">
                    <a.icon size={17} /> {a.label}
                    <span className="count">{a.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="pop-wrap" ref={userRef}>
            <button type="button" className="user-btn" onClick={() => setMenu(menu === 'user' ? '' : 'user')} aria-expanded={menu === 'user'} aria-label="Account menu">
              {me.employee ? (
                <Avatar employeeId={me.employee.id} name={name} hasPhoto={!!me.employee.hasPhoto} size={32} />
              ) : (
                <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>AD</span>
              )}
              <span className="who-text">
                <strong>{name}</strong>
                <span>{ROLE_LABEL[me.role]}</span>
              </span>
              <ChevronDown size={14} className="muted" />
            </button>
            {menu === 'user' && (
              <div className="popover">
                <div className="pop-head">
                  <strong>{name}</strong>
                  <span>{me.email}</span>
                </div>
                {me.employee && (
                  <Link href="/profile" className="pop-item"><User size={17} /> My profile</Link>
                )}
                {me.employee && (
                  <Link href="/payslips" className="pop-item"><Receipt size={17} /> My payslips</Link>
                )}
                <Link href="/organisation" className="pop-item"><UsersRound size={17} /> Organisation</Link>
                <Link href="/legal" className="pop-item"><Scale size={17} /> Disclaimer and privacy</Link>
                <div className="theme-switch" role="radiogroup" aria-label="Theme">
                  {themes.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} onClick={() => setTheme(t.id)}>
                      <t.icon size={14} /> {t.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="pop-item danger" onClick={signOut}><LogOut size={17} /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main id="main">{children}</main>
        <AppFooter />
      </div>
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
