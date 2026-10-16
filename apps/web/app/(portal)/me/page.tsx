'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorAlert, Empty, Loading, PageHead, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { EmployeeRow } from '@/lib/types';

/** My profile: opens the signed-in user's current employee record */
export default function MyProfile() {
  const router = useRouter();
  const { t } = usePrefs();
  const mine = useLoad(() => api<EmployeeRow[]>('/employees/mine'), []);
  const current = mine.data?.find((m) => m.status === 'ACTIVE') ?? mine.data?.[0];
  useEffect(() => {
    if (current) router.replace(`/people/${current.id}`);
  }, [current, router]);

  return (
    <>
      <PageHead title={t('nav.myProfile')} />
      <ErrorAlert error={mine.error} />
      {!mine.data || current ? <Loading /> : <Empty>Your account is not linked to an employee record. HR can link it when they add you as an employee.</Empty>}
    </>
  );
}
