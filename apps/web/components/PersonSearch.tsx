'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, Employee, Page } from '@/lib/api';

/** Type-ahead over active employees of one company (HR, payroll and admins). */
export function PersonSearch({
  companyId,
  value,
  onChange,
  placeholder = 'Search by name or job',
}: {
  companyId?: string;
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: term, pageSize: '8' });
      if (companyId) params.set('companyId', companyId);
      api<Page<Employee>>(`/employees?${params}`).then((p) => setResults(p.items)).catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, companyId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (value) {
    return (
      <span className="chip" style={{ marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between', minHeight: 38, borderRadius: 8 }}>
        {value.name}
        <button type="button" className="link" aria-label="Clear" onClick={() => onChange(null)}><X size={14} /></button>
      </span>
    );
  }
  return (
    <div className="pop-wrap" ref={box}>
      <input value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && results.length > 0 && (
        <div className="popover" style={{ left: 0, right: 'auto', width: '100%', maxHeight: 280, overflowY: 'auto' }}>
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="pop-item"
              onClick={() => { onChange({ id: r.id, name: `${r.firstName} ${r.lastName}` }); setQ(''); setOpen(false); }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span>{r.firstName} {r.lastName}</span>
                <span className="muted small">{r.jobTitle} · {r.department}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
