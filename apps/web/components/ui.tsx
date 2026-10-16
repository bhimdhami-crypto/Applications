'use client';

import { BRAND } from '@gpp/shared';
import { DependencyList, ReactNode, useCallback, useEffect, useState } from 'react';
import { usePrefs } from '@/lib/prefs';

/** Loads data for a page and tracks loading and error states */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function ErrorAlert({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      {error}
    </div>
  );
}

export function Loading() {
  const { t } = usePrefs();
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = usePrefs();
  return <div className="empty">{children ?? t('common.none')}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = usePrefs();
  return status === 'ACTIVE' ? <span className="badge ok">{t('common.active')}</span> : <span className="badge">{t('common.inactive')}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = usePrefs();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted">
        {total.toLocaleString()} · {page} / {pages}
      </span>
      <button className="btn secondary small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.previous')}
      </button>
      <button className="btn secondary small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')}
      </button>
    </nav>
  );
}

export function PageHead({ title, sub, crumbs, actions }: { title: string; sub?: ReactNode; crumbs?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/** The developer credit and copyright, on every screen */
export function Credit({ compact = false }: { compact?: boolean }) {
  const { t } = usePrefs();
  if (compact)
    return (
      <span dir="ltr" lang="en">
        {BRAND.developerCredit}
        <br />
        {BRAND.copyright()}
      </span>
    );
  return (
    <footer className="footer">
      <span dir="ltr" lang="en">
        <strong>{BRAND.developerCredit}</strong> · {BRAND.copyright()}
      </span>
      <span>{t('footer.disclaimer')}</span>
    </footer>
  );
}

export function fmtDate(iso: string | null | undefined, lang = 'en', withTime = false) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));
}
