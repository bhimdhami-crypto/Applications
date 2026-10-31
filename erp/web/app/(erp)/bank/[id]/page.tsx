'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MatchBoard } from '@/components/bank/MatchBoard';
import { ReconciliationPanel } from '@/components/bank/ReconciliationPanel';
import { StatementImport } from '@/components/bank/StatementImport';
import { RecordHistory } from '@/components/RecordHistory';
import { BankWorkspace, api, downloadFrom, errorText } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { useSession } from '@/lib/session';

type Tab = 'match' | 'import' | 'reconcile' | 'statements';

interface StatementRow {
  id: number;
  fileName: string;
  fromDate: string;
  toDate: string;
  lineCount: number;
  skipped: number;
  importedAt: string;
  importedBy: { name: string };
}

/** One bank account: import statements, match them to the ledger, and reconcile */
export default function BankAccountPage() {
  const { id } = useParams<{ id: string }>();
  const { company, canPrepare } = useSession();
  const base = `/companies/${company.code}/bank-accounts/${id}`;
  const [tab, setTab] = useState<Tab>('match');
  const [ws, setWs] = useState<BankWorkspace | null>(null);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<BankWorkspace>(`${base}/workspace`)
      .then(setWs)
      .catch((e) => setError(errorText(e)));
    api<StatementRow[]>(`${base}/statements`)
      .then(setStatements)
      .catch(() => setStatements([]));
  }, [base]);
  useEffect(load, [load]);

  if (error && !ws) return <div className="error">{error}</div>;
  if (!ws) return <div className="loading-page">Loading…</div>;
  const latest = statements.reduce<string | null>((d, s) => (!d || s.toDate > d ? s.toDate.slice(0, 10) : d), null);

  const tabs: Array<[Tab, string]> = [
    ['match', `Match (${ws.lines.length + ws.entries.length})`],
    ...(canPrepare ? ([['import', 'Import statement']] as Array<[Tab, string]>) : []),
    ['reconcile', 'Reconciliation'],
    ['statements', 'Statements and history'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted">
            <Link href="/bank">Bank reconciliation</Link>
          </div>
          <h1 style={{ margin: 0 }}>{ws.account.name}</h1>
          <div className="muted">
            {[ws.account.bankName, ws.account.accountNumber, `GL ${ws.account.glAccount.code}`, ws.account.currencyCode, `from ${formatDate(ws.account.reconcileFrom)}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="spacer" />
        <div className="tabs no-print">
          {tabs.map(([t, label]) => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {tab === 'match' && (
        <MatchBoard
          ws={ws}
          base={base}
          onChange={(n) => {
            setNotice(n ?? '');
            load();
          }}
        />
      )}
      {tab === 'import' && (
        <StatementImport
          base={base}
          currency={ws.account.currencyCode}
          onImported={(n) => {
            setNotice(n);
            setTab('match');
            load();
          }}
        />
      )}
      {tab === 'reconcile' && <ReconciliationPanel base={base} currency={ws.account.currencyCode} defaultDate={latest ?? new Date().toISOString().slice(0, 10)} onChange={load} />}
      {tab === 'statements' && (
        <>
          <div className="card table-wrap">
            <h2>Imported statements</h2>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Covers</th>
                  <th className="num">Lines</th>
                  <th>Imported</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id}>
                    <td>{s.fileName}</td>
                    <td>
                      {formatDate(s.fromDate)} to {formatDate(s.toDate)}
                    </td>
                    <td className="num">
                      {s.lineCount}
                      {s.skipped > 0 && <div className="muted">{s.skipped} already in</div>}
                    </td>
                    <td>
                      {s.importedBy.name}
                      <div className="muted">{formatDate(s.importedAt)}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn small ghost" onClick={() => downloadFrom(`${base}/statements/${s.id}/download`, s.fileName).catch((e) => setError(errorText(e)))}>
                        <Download size={14} /> Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {statements.length === 0 && <div className="empty">No statements imported yet.</div>}
          </div>
          <div className="card">
            <h2>History</h2>
            <RecordHistory entity="BankAccount" id={ws.account.id} />
          </div>
        </>
      )}
    </>
  );
}
