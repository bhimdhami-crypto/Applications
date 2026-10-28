'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, Me, Role, setToken } from './api';

interface Session {
  me: Me;
  signOut: () => void;
  can: (...roles: Role[]) => boolean;
}

const SessionContext = createContext<Session | null>(null);

/** Loads the signed-in user, sending anyone without a valid token back to the sign-in page. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => router.replace('/'));
  }, [router]);

  const signOut = useCallback(() => {
    setToken(null);
    router.replace('/');
  }, [router]);

  if (!me)
    return (
      <div className="splash">
        <div className="splash-inner">
          <img src="/logo-mark.svg" alt="" />
          <span><span className="spinner" /> Opening your workspace…</span>
        </div>
      </div>
    );
  // Admin passes every role check, matching the API.
  const can = (...roles: Role[]) => me.role === 'ADMIN' || roles.includes(me.role);
  return <SessionContext.Provider value={{ me, signOut, can }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
