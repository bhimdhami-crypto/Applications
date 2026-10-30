'use client';

import { useState } from 'react';
import { DropZone } from '@/components/DropZone';
import { StatementLayout, StatementPreview, api, errorText } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/money';

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD.MM.YYYY'];

/**
 * Drop the bank's CSV export, check that the columns were read the right way round, then import.
 * The column choice is remembered for the account, so next month it is drop and import.
 */
export function StatementImport({ base, currency, onImported }: { base: string; currency: string; onImported: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [layout, setLayout] = useState<StatementLayout | null>(null);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function form(f: File, l: StatementLayout | null) {
    const data = new FormData();
    data.append('file', f);
    if (l) data.append('layout', JSON.stringify(l));
    if (opening.trim()) data.append('openingBalance', opening.replace(/,/g, '').trim());
    return data;
  }

  async function check(f: File, l: StatementLayout | null) {
    setError('');
    setBusy(true);
    try {
      const p = await api<StatementPreview>(`${base}/statements/preview`, { method: 'POST', body: form(f, l) });
      setPreview(p);
      setLayout(p.layout);
    } catch (e) {
      setError(errorText(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function importIt() {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const r = await api<{ imported: number; skipped: number; matched: number }>(`${base}/statements`, { method: 'POST', body: form(file, layout) });
      setFile(null);
      setPreview(null);
      onImported(
        `Imported ${r.imported} line${r.imported === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already imported` : ''}. ${r.matched} matched to the ledger automatically.`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const setCol = (key: keyof StatementLayout, value: string) => {
    if (!layout || !file) return;
    const next = { ...layout, [key]: value || null } as StatementLayout;
    if (key === 'amount' && value) Object.assign(next, { moneyOut: null, moneyIn: null });
    if ((key === 'moneyOut' || key === 'moneyIn') && value) next.amount = null;
    setLayout(next);
    void check(file, next);
  };

  const headings = preview?.headings.filter((h) => h.trim()) ?? [];
  const column = (label: string, key: keyof StatementLayout, optional = true) => (
    <label className="field">
      {label}
      <select value={(layout?.[key] as string) ?? ''} onChange={(e) => setCol(key, e.target.value)}>
        {optional && <option value="">None</option>}
        {headings.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card">
      <h2>Import a statement</h2>
      <DropZone
        title={file ? file.name : 'Drop the bank statement here'}
        hint="CSV export from the bank's online banking. From Excel, save as CSV first."
        accept=".csv,.txt"
        multiple={false}
        disabled={busy}
        onFiles={(files) => {
          setFile(files[0]);
          void check(files[0], null);
        }}
      />
      {error && (
        <div className="error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {preview && file && (
        <div style={{ marginTop: 16 }}>
          {layout ? (
            <div className="fields" style={{ alignItems: 'end' }}>
              {column('Date', 'date', false)}
              {column('Description', 'description', false)}
              {column('Reference', 'reference')}
              {column('Amount (signed)', 'amount')}
              {column('Money out', 'moneyOut')}
              {column('Money in', 'moneyIn')}
              {column('Balance', 'balance')}
              <label className="field">
                Date format
                <select value={layout.dateFormat} onChange={(e) => setCol('dateFormat', e.target.value)}>
                  {DATE_FORMATS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="warning">The heading row could not be found. Check that the file is the bank's transaction export.</div>
          )}
          {preview.needsOpeningBalance && (
            <label className="field" style={{ maxWidth: 260, marginTop: 12 }}>
              Balance before the first line ({currency})
              <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} onBlur={() => file && check(file, layout)} />
            </label>
          )}
          {preview.problems.map((p) => (
            <div key={p} className="warning">
              {p}
            </div>
          ))}
          <div className="muted" style={{ margin: '12px 0 6px' }}>
            {preview.lineCount} lines read · {preview.newLines} new{preview.skipped ? ` · ${preview.skipped} already imported` : ''}
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th className="num">Money in</th>
                  <th className="num">Money out</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.row}>
                    <td>{formatDate(l.txDate)}</td>
                    <td>{l.description}</td>
                    <td className="muted">{l.reference}</td>
                    <td className="num">{l.amount.startsWith('-') ? '' : formatAmount(l.amount)}</td>
                    <td className="num">{l.amount.startsWith('-') ? formatAmount(l.amount.slice(1)) : ''}</td>
                    <td className="num muted">{l.balance ? formatAmount(l.balance) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions-bar" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy || !preview.newLines || preview.problems.length > 0 || preview.needsOpeningBalance} onClick={importIt}>
              Import {preview.newLines} lines
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setFile(null);
                setPreview(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
