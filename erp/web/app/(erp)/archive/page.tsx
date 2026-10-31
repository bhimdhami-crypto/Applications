'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArchiveHit, api, download, errorText } from '@/lib/api';
import { formatDate, formatSize } from '@/lib/money';
import { useSession } from '@/lib/session';

export default function ArchivePage() {
  const { company } = useSession();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hits, setHits] = useState<ArchiveHit[] | null>(null);
  const [error, setError] = useState('');

  const search = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setError('');
    api<ArchiveHit[]>(`/companies/${company.code}/archive?${params}`)
      .then(setHits)
      .catch((e) => setError(errorText(e)));
    // q, from and to are read when the form is sent, not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.code]);

  useEffect(search, [search]);

  function submit(e: FormEvent) {
    e.preventDefault();
    search();
  }

  return (
    <>
      <div className="page-head">
        <h1>Document archive</h1>
      </div>
      <form className="card fields" onSubmit={submit} style={{ alignItems: 'end' }}>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="File name, voucher number, reference or description" />
        </label>
        <label className="field">
          Uploaded from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn primary">Search</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Voucher</th>
              <th>Description</th>
              <th>Uploaded</th>
              <th className="num">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hits?.map((h) => (
              <tr key={h.id}>
                <td>{h.fileName}</td>
                <td>{h.voucherNo && <Link href={`/vouchers/${h.voucherNo}`}>{h.voucherNo}</Link>}</td>
                <td>{h.description}</td>
                <td>{formatDate(h.uploadedAt)}</td>
                <td className="num">{formatSize(h.size)}</td>
                <td>
                  <button className="btn small" onClick={() => download(company.code, h).catch((e) => setError(errorText(e)))}>
                    <Download size={14} /> Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hits?.length === 0 && <div className="empty">No documents match.</div>}
      </div>
    </>
  );
}
