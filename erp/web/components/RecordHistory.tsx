'use client';

import { History, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HistoryEntry, api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { HistoryList } from './HistoryList';

/** One record's own history: who created it, every change with its old value, and every approval */
export function RecordHistory({ entity, id, refresh }: { entity: string; id: number; refresh?: unknown }) {
  const { company } = useSession();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<HistoryEntry[]>(`/companies/${company.code}/history/${entity}/${id}`)
      .then(setEntries)
      .catch((err) => setError(errorText(err)));
  }, [company.code, entity, id, refresh]);

  if (error) return <div className="error">{error}</div>;
  if (!entries) return <div className="muted">Loading…</div>;
  return <HistoryList entries={[...entries].reverse()} />;
}

/** A button that opens a record's history in a side panel */
export function HistoryButton({ entity, id, title }: { entity: string; id: number; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn small ghost"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Change history"
      >
        <History size={14} /> History
      </button>
      {open &&
        // Rendered on the page body so the table cell it is opened from does not restyle it
        createPortal(
          <div className="drawer-backdrop" onClick={() => setOpen(false)}>
            <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`History of ${title}`}>
              <div className="page-head" style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>{title}</h2>
                <div className="spacer" />
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <RecordHistory entity={entity} id={id} />
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
