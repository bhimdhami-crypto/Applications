'use client';

import { BRAND, Permission } from '@gpp/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { AccentSelect, LanguageSelect, ThemeSelect } from './Prefs';
import { Credit } from './ui';

interface NavItem {
  href: string;
  label: MessageKey;
  /** Every one of these is needed somewhere in the user's scope */
  needs?: Permission[];
}

const SECTIONS: { title: MessageKey; items: NavItem[] }[] = [
  {
    title: 'nav.me',
    items: [
      { href: '/home', label: 'nav.home' },
      { href: '/me', label: 'nav.myProfile', needs: ['self.service'] },
      { href: '/team', label: 'nav.team', needs: ['team.read'] },
      { href: '/account', label: 'nav.account' },
    ],
  },
  {
    title: 'nav.people',
    items: [
      { href: '/people', label: 'nav.directory', needs: ['people.read'] },
      { href: '/people/headcount', label: 'nav.headcount', needs: ['people.read'] },
      { href: '/people/requests', label: 'nav.changeRequests', needs: ['people.manage', 'people.sensitive.read'] },
    ],
  },
  {
    title: 'nav.admin',
    items: [
      { href: '/organisation', label: 'nav.organisation', needs: ['org.read'] },
      { href: '/admin/users', label: 'nav.users', needs: ['users.read'] },
      { href: '/admin/geography', label: 'nav.geography', needs: ['org.read'] },
      { href: '/admin/audit', label: 'nav.audit', needs: ['audit.read'] },
    ],
  },
];

const COMING: { label: MessageKey; phase: number }[] = [
  { label: 'nav.leave', phase: 3 },
  { label: 'nav.payroll', phase: 4 },
  { label: 'nav.insight', phase: 6 },
];

/** The longest matching menu entry is the current page, so /people/headcount does not also light up /people */
function current(path: string, href: string, items: NavItem[]) {
  const matches = (h: string) => path === h || path.startsWith(`${h}/`);
  if (!matches(href)) return false;
  return !items.some((o) => o.href.length > href.length && matches(o.href));
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, can, entityId, setEntityId, signOut } = useSession();
  const { t } = usePrefs();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main menu">
        <Link className="brand" href="/home">
          <img src="/logo.svg" alt="" />
          <div>
            <strong>{BRAND.shortName}</strong>
            <span>Global People & Payroll</span>
          </div>
        </Link>
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter((i) => !i.needs || i.needs.every((p) => can(p)));
            if (!items.length) return null;
            return (
              <div key={s.title}>
                <h4>{t(s.title)}</h4>
                {items.map((i) => (
                  <Link key={i.href} href={i.href} aria-current={current(path, i.href, items) ? 'page' : undefined}>
                    {t(i.label)}
                  </Link>
                ))}
              </div>
            );
          })}
          <h4>{t('nav.comingSoon')}</h4>
          {COMING.map((c) => (
            <span key={c.label} className="soon" aria-disabled="true">
              {t(c.label)} <small>{c.phase}</small>
            </span>
          ))}
        </nav>
        <div className="sidebar-credit">
          <Credit compact />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn secondary small menu-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            ☰ <span className="sr-only">Menu</span>
          </button>
          <label>
            {t('top.company')}
            <select value={entityId ?? ''} onChange={(e) => setEntityId(e.target.value || null)}>
              {me.entities.length > 1 && <option value="">{t('top.allCompanies')}</option>}
              {me.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.countryCode} · {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="spacer" />
          <LanguageSelect />
          <ThemeSelect />
          <AccentSelect />
          <div>
            <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{me.user.displayName}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>
              {me.roles.map((r) => r.label).join(', ') || '—'}
            </div>
          </div>
          <button className="btn secondary small" onClick={signOut}>
            {t('top.signOut')}
          </button>
        </header>
        <main className="content" id="main">
          {children}
        </main>
        <Credit />
      </div>
    </div>
  );
}
