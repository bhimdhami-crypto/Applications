'use client';

import { Link2, Undo2, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Account, BankEntry, BankLine, BankWorkspace, Voucher, api, errorText } from '@/lib/api';
import { formatAmount, formatDate, fromUnits, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

const sum = (items: Array<{ amount: string }>) => items.reduce((s, i) => s + toUnits(i.amount), 0n);

function Amount({ value }: { value: string }) {
  const negative = value.startsWith('-');
  return <span className={negative ? 'amount-out' : 'amount-in'}>{negative ? `−${formatAmount(value.slice(1))}` : `+${formatAmount(value)}`}</span>;
}

/**
 * Statement lines on the left, ledger rows on the right. Tick rows on both sides whose totals agree
 * and match them, or drag a ledger row onto a statement line. A line the ledger does not have yet
 * (bank charges, interest) becomes a voucher for approval.
 */
export function MatchBoard({ ws, base, onChange }: { ws: BankWorkspace; base: string; onChange: (notice?: string) => void }) {
  const { company, canPrepare } = useSession();
  const router = useRouter();
  const [lines, setLines] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<Set<string>>(new Set());
  const [dropOn, setDropOn] = useState<number | null>(null);
  const [voucherFor, setVoucherFor] = useState<number | null>(null);
  const [contra, setContra] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLines(new Set());
    setEntries(new Set());
  }, [ws]);
  useEffect(() => {
    if (voucherFor == null || accounts.length) return;
    api<Account[]>(`/companies/${company.code}/accounts`)
      .then((a) => setAccounts(a.filter((x) => x.isPostable && x.isActive && !x.subledger && x.id !== ws.account.glAccount.id)))
      .catch((e) => setError(errorText(e)));
  }, [voucherFor, accounts.length, company.code, ws.account.glAccount.id]);

  const pickedLines = ws.lines.filter((l) => lines.has(l.id));
  const pickedEntries = ws.entries.filter((e) => entries.has(e.id));
  const bankTotal = sum(pickedLines);
  const ledgerTotal = sum(pickedEntries);
  const canMatch = pickedLines.length > 0 && pickedEntries.length > 0 && bankTotal === ledgerTotal;

  async function run(work: () => Promise<string | undefined>) {
    setError('');
    setBusy(true);
    try {
      onChange(await work());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const match = (lineIds: number[], entryIds: string[]) =>
    run(async () => {
      await api(`${base}/matches`, { method: 'POST', body: { lineIds, entryIds } });
      return undefined;
    });

  const toggle = <T,>(set: Set<T>, value: T, update: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const locked = (dates: string[]) => !!ws.lockedTo && dates.some((d) => d <= ws.lockedTo!);

  return (
    <>
      {error && <div className="error">{error}</div>}
      {canPrepare && (
        <div className="card match-bar">
          <button className="btn" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ matched: number }>(`${base}/auto-match`, { method: 'POST' });
            return r.matched ? `Matched ${r.matched} automatically` : 'Nothing more could be matched automatically: same amount within 10 days is needed';
          })}>
            <Wand2 size={15} /> Match automatically
          </button>
          <div className="spacer" />
          <span className="muted">
            Statement {formatAmount(fromUnits(bankTotal))} · Ledger {formatAmount(fromUnits(ledgerTotal))}
            {pickedLines.length + pickedEntries.length > 0 && bankTotal !== ledgerTotal && (
              <strong className="amount-out"> · Difference {formatAmount(fromUnits(bankTotal - ledgerTotal))}</strong>
            )}
          </span>
          <button className="btn primary" disabled={busy || !canMatch} onClick={() => match([...lines], [...entries])}>
            <Link2 size={15} /> Match selected
          </button>
        </div>
      )}
      <div className="match-board">
        <section className="card">
          <h2>
            On the statement, not matched <span className="muted">({ws.lines.length})</span>
          </h2>
          {ws.lines.length === 0 && <div className="empty">Every statement line is matched.</div>}
          <div className="match-list">
            {ws.lines.map((l: BankLine) => (
              <div
                key={l.id}
                className={`match-row${lines.has(l.id) ? ' picked' : ''}${dropOn === l.id ? ' drop-on' : ''}`}
                onClick={() => canPrepare && toggle(lines, l.id, setLines)}
                onDragOver={(e) => {
                  if (!canPrepare || !e.dataTransfer.types.includes('application/x-ledger-row')) return;
                  e.preventDefault();
                  setDropOn(l.id);
                }}
                onDragLeave={() => setDropOn(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropOn(null);
                  const entryId = e.dataTransfer.getData('application/x-ledger-row');
                  if (entryId) void match([l.id], [entryId]);
                }}
              >
                {canPrepare && <input type="checkbox" checked={lines.has(l.id)} readOnly tabIndex={-1} />}
                <div className="match-main">
                  <div>{l.description}</div>
                  <div className="muted">
                    {formatDate(l.txDate)}
                    {l.reference && ` · ${l.reference}`}
                  </div>
                  {voucherFor === l.id && (
                    <div className="line-voucher" onClick={(e) => e.stopPropagation()}>
                      <select value={contra} onChange={(e) => setContra(e.target.value)} aria-label="Other side of the entry">
                        <option value="">Other side, e.g. bank charges</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.description}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn small primary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const v = await api<Voucher>(`${base}/lines/${l.id}/voucher`, { method: 'POST', body: contra ? { contraAccountId: Number(contra) } : {} });
                            router.push(`/vouchers/${encodeURIComponent(v.voucherNo)}`);
                            return `Drafted ${v.voucherNo}`;
                          })
                        }
                      >
                        Draft voucher
                      </button>
                      <button className="btn small ghost" onClick={() => setVoucherFor(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div className="match-amount">
                  <Amount value={l.amount} />
                  {canPrepare && voucherFor !== l.id && (
                    <button
                      className="btn small ghost"
                      title="Not in the ledger yet: start a voucher for it"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVoucherFor(l.id);
                      }}
                    >
                      Add to ledger
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>
            In the ledger, not matched <span className="muted">({ws.entries.length})</span>
          </h2>
          {ws.entries.length === 0 && <div className="empty">Every ledger row is matched.</div>}
          <div className="match-list">
            {ws.entries.map((e: BankEntry) => (
              <div
                key={e.id}
                className={`match-row${entries.has(e.id) ? ' picked' : ''}`}
                draggable={canPrepare}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('application/x-ledger-row', e.id);
                  ev.dataTransfer.effectAllowed = 'link';
                }}
                onClick={() => canPrepare && toggle(entries, e.id, setEntries)}
                title={canPrepare ? 'Tick, or drag onto the statement line it matches' : undefined}
              >
                {canPrepare && <input type="checkbox" checked={entries.has(e.id)} readOnly tabIndex={-1} />}
                <div className="match-main">
                  <div>{e.description}</div>
                  <div className="muted">
                    {formatDate(e.txDate)} · {e.auditNo}
                    {e.reference && ` · ${e.reference}`}
                  </div>
                </div>
                <div className="match-amount">
                  <Amount value={e.amount} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      {ws.matches.length > 0 && (
        <div className="card table-wrap">
          <h2>Matched recently</h2>
          <table>
            <thead>
              <tr>
                <th>Statement</th>
                <th>Ledger</th>
                <th className="num">Amount</th>
                <th>How</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ws.matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.lines.map((l) => (
                      <div key={l.id}>
                        {formatDate(l.txDate)} · {l.description}
                      </div>
                    ))}
                  </td>
                  <td>
                    {m.entries.map((e) => (
                      <div key={e.id}>
                        {e.auditNo} · {e.description}
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    <Amount value={fromUnits(sum(m.lines))} />
                  </td>
                  <td className="muted">
                    {m.method === 'AUTO' ? 'Automatic' : 'By hand'} · {m.matchedBy}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canPrepare &&
                      (locked([...m.lines.map((l) => l.txDate), ...m.entries.map((e) => e.txDate)]) ? (
                        <span className="muted" title={`Part of the reconciliation reviewed at ${formatDate(ws.lockedTo)}`}>
                          Locked
                        </span>
                      ) : (
                        <button className="btn small ghost" disabled={busy} onClick={() => run(async () => {
                          await api(`${base}/matches/${m.id}`, { method: 'DELETE' });
                          return 'Match undone';
                        })}>
                          <Undo2 size={14} /> Undo
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
