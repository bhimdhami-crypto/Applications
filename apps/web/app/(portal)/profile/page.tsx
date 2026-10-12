'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

/** Short link to the signed-in person's own profile. */
export default function MyProfile() {
  const { me } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (me.employee) router.replace(`/employees/${me.employee.id}`);
  }, [me, router]);
  return me.employee ? <div className="loading">Loading…</div> : <p className="muted">This account is not linked to an employee record, so it has no staff profile.</p>;
}
