'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Company, Role, User, api, getToken, setToken } from './api';

const COMPANY_KEY = 'mfi-erp.company';
/** The sign-in page keeps the user's name here, since /auth/me returns only the id, email and role */
export const NAME_KEY = 'mfi-erp.name';

interface Session {
  user: User;
  companies: Company[];
  company: Company;
  setCompany: (code: string) => void;
  signOut: () => void;
  /** Roles that may draft and edit vouchers */
  canPrepare: boolean;
  can: (...roles: Role[]) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

function readCompany() {
  try {
    return window.localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ user: User; companies: Company[]; code: string } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    Promise.all([api<User>('/auth/me'), api<Company[]>('/companies')])
      .then(([user, companies]) => {
        const saved = readCompany();
        const code = companies.some((c) => c.code === saved) ? saved! : companies[0]?.code;
        setState({ user: { ...user, name: window.sessionStorage.getItem(NAME_KEY) ?? undefined }, companies, code });
      })
      .catch(() => router.replace('/'));
  }, [router]);

  const setCompany = useCallback((code: string) => {
    try {
      window.localStorage.setItem(COMPANY_KEY, code);
    } catch {
      // Private window: the choice lasts for this page only
    }
    setState((s) => (s ? { ...s, code } : s));
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    router.replace('/');
  }, [router]);

  if (!state) return <div className="loading-page">Loading…</div>;
  const company = state.companies.find((c) => c.code === state.code) ?? state.companies[0];
  const can = (...roles: Role[]) => state.user.role === 'ADMIN' || roles.includes(state.user.role);
  return (
    <SessionContext.Provider
      value={{ user: state.user, companies: state.companies, company, setCompany, signOut, can, canPrepare: can('FINANCE_MANAGER', 'ACCOUNTANT') }}
    >
      {children}
    </SessionContext.Provider>
  );
}
