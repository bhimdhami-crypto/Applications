'use client';

import type { Permission } from '@gpp/shared';
import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, logout } from './api';
import type { Me } from './types';

interface Session {
  me: Me;
  reload: () => Promise<void>;
  /** The company chosen in the switcher, or null for all of the user's companies */
  entityId: string | null;
  setEntityId: (id: string | null) => void;
  can: (permission: Permission, entityId?: string) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [entityId, setEntityIdState] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/sign-in');
      else throw e;
    }
  }, [router]);

  useEffect(() => {
    reload();
    try {
      setEntityIdState(sessionStorage.getItem('gpp.entity'));
    } catch {
      // storage unavailable: start on all companies
    }
  }, [reload]);

  const setEntityId = useCallback((id: string | null) => {
    setEntityIdState(id);
    try {
      if (id) sessionStorage.setItem('gpp.entity', id);
      else sessionStorage.removeItem('gpp.entity');
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<Session | null>(() => {
    if (!me) return null;
    const valid = entityId && me.entities.some((e) => e.id === entityId) ? entityId : null;
    return {
      me,
      reload,
      entityId: valid,
      setEntityId,
      can: (p, id) => {
        const s = me.permissions[p];
        if (!s) return false;
        return id === undefined || s.group || s.legalEntityIds.includes(id);
      },
      signOut: async () => {
        await logout();
        router.replace('/sign-in');
      },
    };
  }, [me, entityId, reload, setEntityId, router]);

  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
