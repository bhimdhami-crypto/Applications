'use client';

import { useParams } from 'next/navigation';
import { VoucherEditor } from '@/components/VoucherEditor';

export default function VoucherPage() {
  const { no } = useParams<{ no: string }>();
  return <VoucherEditor voucherNo={decodeURIComponent(no)} />;
}
