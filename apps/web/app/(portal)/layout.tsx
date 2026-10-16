'use client';

import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { Loading } from '@/components/ui';
import { SessionProvider } from '@/lib/session';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="auth-form">
          <Loading />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
