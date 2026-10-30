'use client';

import { Download, GripVertical, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DropZone, filesForm } from '@/components/DropZone';
import { RecordHistory } from '@/components/RecordHistory';
import { StatusBadge } from '@/components/StatusBadge';
import { Account, Attachment, Party, Voucher, api, download, errorText } from '@/lib/api';
import { cleanAmount, formatAmount, formatDate, formatSize, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

/** One row of the grid while it is being edited */
interface LineDraft {
  key: number;
  accountId: number | null;
  accountText: string;
  description: string;
  debit: string;
  credit: string;
  fx: { currencyCode: string; exchangeRate: string; foreignAmount: string } | null;
  ic: { partnerCompany: string; partnerAccountId: number | null; partnerAccountText: string } | null;
  /** Customer or supplier, on a Debtors or Creditors Control line */
  partyId: number | null;
  partyText: string;
  dueDate: string;
}

const ACCOUNT_DRAG = 'application/x-mfi-account';
const LINE_DRAG = 'application/x-mfi-line';
let nextKey = 1;

const accountLabel = (a: { code: string; description: string }) => `${a.code} · ${a.description}`;
const partyLabel = (p: { code: string; name: string }) => `${p.code} · ${p.name}`;
const KIND_FOR = { AR: 'CUSTOMER', AP: 'SUPPLIER' } as const;

function blankLine(account?: Account): LineDraft {
  return {
    key: nextKey++,
    accountId: account?.id ?? null,
    accountText: account ? accountLabel(account) : '',
    description: '',
    debit: '',
    credit: '',
    fx: null,
    ic: null,
    partyId: null,
    partyText: '',
    dueDate: '',
  };
}

function findParty(parties: Party[], text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return parties.find((p) => partyLabel(p).toLowerCase() === t) ?? parties.find((p) => p.code.toLowerCase() === t);
}

/** Choosing another account keeps the customer or supplier only while the line stays on the same kind of control account */
function withAccount(from: Account | undefined, to: Account | undefined): Partial<LineDraft> {
  const keep = !!to?.subledger && to.subledger === from?.subledger;
  return keep ? {} : { partyId: null, partyText: '', dueDate: '' };
}

/** Matches what the user typed or picked to an account: the "code · description" label, or the code alone */
function findAccount(accounts: Account[], text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return accounts.find((a) => accountLabel(a).toLowerCase() === t) ?? accounts.find((a) => a.code.toLowerCase() === t);
}

/** Home amount of a foreign line, as the API works it out: rate × foreign amount, rounded once to the cent */
function fxHomeUnits(rate: string, foreign: string): bigint {
  const m = /^(\d*)(?:\.(\d{0,6}))?$/.exec(rate.trim());
  if (!m) return 0n;
  const micro = BigInt(m[1] || '0') * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  const raw = (toUnits(foreign) * micro) / 1_000_000n; // in 0.0001
  const abs = raw < 0n ? -raw : raw;
  const rounded = ((abs + 50n) / 100n) * 100n;
  return raw < 0n ? -rounded : rounded;
}

function draftFrom(v: Voucher): LineDraft[] {
  return v.lines.map((l) => ({
    key: nextKey++,
    accountId: l.partnerCompanyId ? null : l.accountId,
    accountText: l.account && !l.partnerCompanyId ? accountLabel(l.account) : '',
    description: l.description ?? '',
    debit: l.foreignAmount ? '' : toUnits(l.debit) > 0n ? l.debit : '',
    credit: l.foreignAmount ? '' : toUnits(l.credit) > 0n ? l.credit : '',
    fx: l.currencyCode && l.foreignAmount ? { currencyCode: l.currencyCode, exchangeRate: l.exchangeRate ?? '', foreignAmount: l.foreignAmount } : null,
    ic: l.partnerCompany
      ? { partnerCompany: l.partnerCompany.code, partnerAccountId: l.partnerAccountId, partnerAccountText: l.partnerAccount ? accountLabel(l.partnerAccount) : '' }
      : null,
    partyId: l.partyId,
    partyText: l.party ? partyLabel(l.party) : '',
    dueDate: l.dueDate?.slice(0, 10) ?? '',
  }));
}

export function VoucherEditor({ voucherNo }: { voucherNo?: string }) {
  const router = useRouter();
  const { company, companies, user, canPrepare } = useSession();
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partnerAccounts, setPartnerAccounts] = useState<Record<string, Account[]>>({});
  const [parties, setParties] = useState<Party[]>([]);
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine(), blankLine()]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!voucherNo) return;
    const v = await api<Voucher>(`/companies/${company.code}/vouchers/${voucherNo}`);
    setVoucher(v);
    setTxDate(v.txDate.slice(0, 10));
    setDescription(v.description);
    setReference(v.reference ?? '');
    setLines(v.lines.length ? draftFrom(v) : [blankLine(), blankLine()]);
  }, [company.code, voucherNo]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  useEffect(() => {
    api<Account[]>(`/companies/${company.code}/accounts`)
      .then((a) => setAccounts(a.filter((x) => x.isActive)))
      .catch((e) => setError(errorText(e)));
  }, [company.code]);

  useEffect(() => {
    api<Party[]>(`/companies/${company.code}/parties`)
      .then((p) => setParties(p.filter((x) => x.isActive)))
      .catch((e) => setError(errorText(e)));
  }, [company.code]);

  const loadPartner = useCallback(
    (code: string) => {
      if (!code || partnerAccounts[code]) return;
      api<Account[]>(`/companies/${code}/accounts`)
        .then((a) => setPartnerAccounts((p) => ({ ...p, [code]: a.filter((x) => x.isActive && x.isPostable) })))
        .catch((e) => setError(errorText(e)));
    },
    [partnerAccounts],
  );

  useEffect(() => {
    for (const l of lines) if (l.ic?.partnerCompany) loadPartner(l.ic.partnerCompany);
  }, [lines, loadPartner]);

  const postable = useMemo(() => accounts.filter((a) => a.isPostable), [accounts]);
  const isAuthor = !voucher || voucher.createdById === user.id;
  const editable = canPrepare && isAuthor && (!voucher || voucher.status === 'DRAFT' || voucher.status === 'REJECTED');
  const stage = voucher?.rule?.stages.find((s) => s.stageNo === voucher.currentStage);
  const canApprove = voucher?.status === 'SUBMITTED' && !isAuthor && !!stage && (user.role === 'ADMIN' || user.role === stage.approverRole);

  // Live totals, worked out exactly as the ledger will post them
  const totals = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    for (const l of lines) {
      if (l.fx) {
        const home = fxHomeUnits(l.fx.exchangeRate, l.fx.foreignAmount);
        if (home > 0n) debit += home;
        else credit -= home;
      } else {
        debit += toUnits(l.debit);
        credit += toUnits(l.credit);
      }
    }
    return { debit, credit, difference: debit - credit };
  }, [lines]);

  function change(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function setAccountText(key: number, text: string) {
    const a = findAccount(postable, text);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...withAccount(accountObj(l), a), accountText: text, accountId: a?.id ?? null } : l)));
  }

  function moveLine(from: number, to: number) {
    setLines((ls) => {
      const copy = [...ls];
      const [row] = copy.splice(from, 1);
      copy.splice(to > from ? to - 1 : to, 0, row);
      return copy;
    });
  }

  function dropOnLine(e: React.DragEvent, index: number, key: number) {
    const accountId = e.dataTransfer.getData(ACCOUNT_DRAG);
    const lineIndex = e.dataTransfer.getData(LINE_DRAG);
    setDragOver(null);
    if (accountId) {
      e.preventDefault();
      const a = postable.find((x) => x.id === Number(accountId));
      if (a) setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...withAccount(accountObj(l), a), accountId: a.id, accountText: accountLabel(a), ic: null } : l)));
    } else if (lineIndex !== '') {
      e.preventDefault();
      moveLine(Number(lineIndex), index);
    }
  }

  // The typed text decides when the id is missing, e.g. a sister company's accounts arrived after it was typed
  const accountOf = (l: LineDraft) => l.accountId ?? findAccount(postable, l.accountText)?.id ?? null;
  const partnerAccountOf = (ic: NonNullable<LineDraft['ic']>) =>
    ic.partnerAccountId ?? findAccount(partnerAccounts[ic.partnerCompany] ?? [], ic.partnerAccountText)?.id ?? null;
  function accountObj(l: LineDraft) {
    const id = accountOf(l);
    return id ? postable.find((a) => a.id === id) : undefined;
  }
  const controlOf = (l: LineDraft) => (l.ic ? null : (accountObj(l)?.subledger ?? null));
  const partiesFor = (control: 'AR' | 'AP' | null) => (control ? parties.filter((p) => p.kind === KIND_FOR[control]) : []);
  const partyOf = (l: LineDraft) => l.partyId ?? findParty(partiesFor(controlOf(l)), l.partyText)?.id ?? null;
  /** Only a control account line carries a customer or supplier */
  const partyFields = (l: LineDraft) =>
    controlOf(l) ? { partyId: partyOf(l) ?? undefined, dueDate: l.dueDate || undefined } : {};

  function payload() {
    const used = lines.filter((l) => l.accountId || l.accountText.trim() || l.ic || l.debit || l.credit || l.fx);
    return {
      txDate,
      description: description.trim(),
      reference: reference.trim() || undefined,
      lines: used.map((l) => {
        const base = { description: l.description.trim() || undefined };
        if (l.ic) {
          return {
            ...base,
            debit: cleanAmount(l.debit),
            credit: cleanAmount(l.credit),
            partnerCompany: l.ic.partnerCompany,
            partnerAccountId: partnerAccountOf(l.ic) ?? undefined,
          };
        }
        if (l.fx) {
          return {
            ...base,
            ...partyFields(l),
            accountId: accountOf(l) ?? undefined,
            currencyCode: l.fx.currencyCode.toUpperCase(),
            exchangeRate: l.fx.exchangeRate.trim(),
            foreignAmount: l.fx.foreignAmount.trim().replace(/,/g, ''),
          };
        }
        return { ...base, ...partyFields(l), accountId: accountOf(l) ?? undefined, debit: cleanAmount(l.debit), credit: cleanAmount(l.credit) };
      }),
    };
  }

  function validate() {
    if (!description.trim()) return 'Add a description for the voucher';
    const used = payload().lines;
    if (used.length < 2) return 'A voucher needs at least two lines';
    const missing = lines.findIndex((l) => (l.debit || l.credit || l.fx) && !l.ic && !accountOf(l));
    if (missing >= 0) return `Line ${missing + 1}: pick an account from the list, or drag one from the chart on the right`;
    const noPartner = lines.findIndex((l) => l.ic && !partnerAccountOf(l.ic));
    if (noPartner >= 0) return `Line ${noPartner + 1}: pick the sister company's account that takes the amount`;
    const noParty = lines.findIndex((l) => controlOf(l) && !partyOf(l));
    if (noParty >= 0) {
      const l = lines[noParty];
      return `Line ${noParty + 1}: ${accountObj(l)!.code} is a control account, so choose the ${controlOf(l) === 'AR' ? 'customer' : 'supplier'}`;
    }
    return '';
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (label) setNotice(label);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<string> {
    const problem = validate();
    if (problem) throw new Error(problem);
    if (!voucher) {
      const v = await api<Voucher>(`/companies/${company.code}/vouchers`, { method: 'POST', body: payload() });
      return v.voucherNo;
    }
    await api(`/companies/${company.code}/vouchers/${voucher.voucherNo}`, { method: 'PUT', body: payload() });
    return voucher.voucherNo;
  }

  const saveDraft = () =>
    run('Draft saved', async () => {
      const no = await save();
      if (!voucher) router.replace(`/vouchers/${no}`);
      else await load();
    });

  const submit = () =>
    run('Submitted for approval', async () => {
      const no = await save();
      await api(`/companies/${company.code}/vouchers/${no}/submit`, { method: 'POST', body: {} });
      if (!voucher) router.replace(`/vouchers/${no}`);
      else await load();
    });

  const act = (action: 'approve' | 'reject' | 'recall' | 'cancel', label: string, body: object = {}) =>
    run(label, async () => {
      await api(`/companies/${company.code}/vouchers/${voucher!.voucherNo}/${action}`, { method: 'POST', body });
      setRejecting(false);
      setComment('');
      await load();
    });

  const reverse = () =>
    run('', async () => {
      const draft = await api<Voucher>(`/companies/${company.code}/journals/${voucher!.postedBatch!.auditNo}/reverse`, { method: 'POST', body: {} });
      router.push(`/vouchers/${draft.voucherNo}`);
    });

  const attach = (files: File[]) =>
    run(`${files.length} file${files.length > 1 ? 's' : ''} added to the archive`, async () => {
      if (!voucher) throw new Error('Save the draft first, then drop its documents here');
      await api(`/companies/${company.code}/vouchers/${voucher.voucherNo}/attachments`, { method: 'POST', body: filesForm(files) });
      await load();
    });

  const removeFile = (f: Attachment) =>
    run('File removed', async () => {
      await api(`/companies/${company.code}/vouchers/${voucher!.voucherNo}/attachments/${f.id}`, { method: 'DELETE' });
      await load();
    });

  const shown = postable.filter((a) => !filter || accountLabel(a).toLowerCase().includes(filter.toLowerCase()));
  const sisters = companies.filter((c) => c.code !== company.code);

  return (
    <>
      <div className="page-head">
        <Link href="/vouchers" className="muted">
          Vouchers
        </Link>
        <span className="muted">/</span>
        <h1>{voucher ? voucher.voucherNo : 'New voucher'}</h1>
        {voucher && <StatusBadge status={voucher.status} />}
        {voucher?.documentType === 'REVERSAL' && <span className="muted">Reversal</span>}
        {voucher?.postedBatch && <span className="muted">Posted as {voucher.postedBatch.auditNo}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className={editable ? 'editor' : ''}>
        <div>
          <div className="card">
            <div className="fields" style={{ marginBottom: 16 }}>
              <label className="field">
                Date
                <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} disabled={!editable} />
              </label>
              <label className="field" style={{ gridColumn: 'span 2' }}>
                Description
                <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} placeholder="What this voucher is for" maxLength={400} />
              </label>
              <label className="field">
                Reference
                <input value={reference} onChange={(e) => setReference(e.target.value)} disabled={!editable} placeholder="Invoice or cheque no." maxLength={50} />
              </label>
            </div>

            <datalist id="accounts">
              {postable.map((a) => (
                <option key={a.id} value={accountLabel(a)} />
              ))}
            </datalist>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    {editable && <th style={{ width: 28 }} />}
                    <th style={{ minWidth: 240 }}>Account</th>
                    <th>Line description</th>
                    <th className="num" style={{ width: 140 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Credit
                    </th>
                    {editable && <th style={{ width: 96 }} />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <LineRow
                      key={l.key}
                      line={l}
                      index={i}
                      editable={editable}
                      sisters={sisters.map((c) => c.code)}
                      partnerAccounts={l.ic ? (partnerAccounts[l.ic.partnerCompany] ?? []) : []}
                      control={controlOf(l)}
                      parties={partiesFor(controlOf(l))}
                      dragOver={dragOver}
                      setDragOver={setDragOver}
                      onDrop={(e) => dropOnLine(e, i, l.key)}
                      onChange={(patch) => change(l.key, patch)}
                      onAccountText={(t) => setAccountText(l.key, t)}
                      onRemove={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                    />
                  ))}
                  {editable && (
                    <tr
                      className={dragOver === 'end' ? 'drop-target' : ''}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver('end');
                      }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => {
                        setDragOver(null);
                        const accountId = e.dataTransfer.getData(ACCOUNT_DRAG);
                        const lineIndex = e.dataTransfer.getData(LINE_DRAG);
                        e.preventDefault();
                        if (accountId) {
                          const a = postable.find((x) => x.id === Number(accountId));
                          if (a) setLines((ls) => [...ls, blankLine(a)]);
                        } else if (lineIndex !== '') moveLine(Number(lineIndex), lines.length);
                      }}
                    >
                      <td colSpan={6}>
                        <button className="btn small ghost" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                          <Plus size={14} /> Add line
                        </button>
                        <span className="muted"> or drop an account here to add a line for it</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="totals">
              <span>Debits {formatAmount(totals.debit)}</span>
              <span>Credits {formatAmount(totals.credit)}</span>
              {totals.difference === 0n ? (
                <span className="ok">Balanced</span>
              ) : (
                <span className="off">Out by {formatAmount(totals.difference < 0n ? -totals.difference : totals.difference)}</span>
              )}
            </div>

            <div className="actions-bar" style={{ marginTop: 16 }}>
              {editable && (
                <>
                  <button className="btn" onClick={saveDraft} disabled={busy}>
                    Save draft
                  </button>
                  <button className="btn primary" onClick={submit} disabled={busy || totals.difference !== 0n}>
                    Submit for approval
                  </button>
                  {voucher && (
                    <button className="btn danger" onClick={() => act('cancel', 'Voucher cancelled')} disabled={busy}>
                      Cancel voucher
                    </button>
                  )}
                </>
              )}
              {voucher?.status === 'SUBMITTED' && isAuthor && (
                <button className="btn" onClick={() => act('recall', 'Recalled to draft')} disabled={busy}>
                  Recall to edit
                </button>
              )}
              {canApprove && (
                <>
                  <button className="btn success" onClick={() => act('approve', 'Approved', { comment: comment || undefined })} disabled={busy}>
                    Approve {stage?.name.toLowerCase()}
                  </button>
                  <button className="btn danger" onClick={() => setRejecting((r) => !r)} disabled={busy}>
                    Reject
                  </button>
                </>
              )}
              {voucher?.status === 'POSTED' && voucher.documentType === 'JOURNAL' && canPrepare && (
                <button className="btn" onClick={reverse} disabled={busy}>
                  Draft a reversal
                </button>
              )}
            </div>
            {rejecting && (
              <div className="reject-box" style={{ marginTop: 10 }}>
                <input autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why it is rejected, so the author can fix it" />
                <button className="btn danger" disabled={busy || comment.trim().length < 3} onClick={() => act('reject', 'Sent back to the author', { comment })}>
                  Send back
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Documents</h2>
            <DropZone
              compact
              title={voucher ? 'Drop documents here' : 'Save the draft, then drop its documents here'}
              hint="PDF, scans, Excel, Word, e-mails. Each file is fingerprinted and kept in the archive."
              onFiles={attach}
              disabled={!voucher || busy}
            />
            <div className="files">
              {voucher?.attachments.map((f) => (
                <div className="file" key={f.id}>
                  <span className="name" title={f.fileName}>
                    {f.fileName}
                  </span>
                  <span className="muted">{formatSize(f.size)}</span>
                  <button className="btn small ghost" onClick={() => download(company.code, f).catch((e) => setError(errorText(e)))}>
                    <Download size={14} />
                  </button>
                  {editable && (
                    <button className="icon-btn" title="Remove" onClick={() => removeFile(f)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {voucher && (
            <div className="card">
              <h2>Approval</h2>
              {voucher.rule ? (
                <>
                  <div className="muted">
                    {voucher.rule.name}
                    {voucher.rule.sopReference && ` · ${voucher.rule.sopReference}`}
                  </div>
                  <div className="stages">
                    {voucher.rule.stages.map((s) => (
                      <span
                        key={s.stageNo}
                        className={`stage${voucher.status === 'POSTED' || (voucher.currentStage ?? 0) > s.stageNo ? ' done' : voucher.status === 'SUBMITTED' && voucher.currentStage === s.stageNo ? ' current' : ''}`}
                      >
                        {s.stageNo}. {s.name}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="muted">The approval route is chosen from the company's rules when the voucher is submitted.</div>
              )}
              {voucher.actions.length > 0 && (
                <ul className="timeline" style={{ marginTop: 14 }}>
                  {voucher.actions.map((a) => (
                    <li key={a.id} className={a.action}>
                      <strong>{a.action.charAt(0) + a.action.slice(1).toLowerCase()}</strong> by {a.user.name}
                      <span className="muted"> · {new Date(a.at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}</span>
                      {a.comment && <div>{a.comment}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {voucher && (
            <details className="card">
              <summary>
                <h2 style={{ display: 'inline' }}>History</h2> <span className="muted">every edit with its old values, approvals and files</span>
              </summary>
              <div style={{ marginTop: 12 }}>
                <RecordHistory entity="Voucher" id={voucher.id} refresh={voucher} />
              </div>
            </details>
          )}
        </div>

        {editable && (
          <aside className="card palette">
            <h2>Chart of accounts</h2>
            <div className="muted" style={{ marginBottom: 8, fontSize: 13 }}>
              Drag an account onto a line, or onto “Add line”.
            </div>
            <input placeholder="Search accounts" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="palette-list">
              {shown.slice(0, 300).map((a) => (
                <div
                  key={a.id}
                  className="chip"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ACCOUNT_DRAG, String(a.id));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => setLines((ls) => [...ls, blankLine(a)])}
                  title="Drag onto a line, or double-click to add a line"
                >
                  <b>{a.code}</b>
                  {a.description}
                  {a.subledger && <span className="tag">{a.subledger}</span>}
                </div>
              ))}
              {shown.length === 0 && <div className="muted">No accounts match.</div>}
            </div>
          </aside>
        )}
      </div>
      {voucher && <div className="muted">Prepared by {voucher.createdBy.name} · dated {formatDate(voucher.txDate)}</div>}
    </>
  );
}

function LineRow({
  line: l,
  index,
  editable,
  sisters,
  partnerAccounts,
  control,
  parties,
  dragOver,
  setDragOver,
  onDrop,
  onChange,
  onAccountText,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  editable: boolean;
  sisters: string[];
  partnerAccounts: Account[];
  control: 'AR' | 'AP' | null;
  parties: Party[];
  dragOver: string | null;
  setDragOver: (k: string | null) => void;
  onDrop: (e: React.DragEvent) => void;
  onChange: (patch: Partial<LineDraft>) => void;
  onAccountText: (text: string) => void;
  onRemove: () => void;
}) {
  const rowKey = `row-${l.key}`;
  const listId = `partner-${l.key}`;
  const partyListId = `party-${l.key}`;
  const word = control === 'AR' ? 'Customer' : 'Supplier';
  const homeOfFx = l.fx ? fxHomeUnits(l.fx.exchangeRate, l.fx.foreignAmount) : 0n;

  return (
    <>
      <tr
        className={dragOver === rowKey ? 'drop-target' : ''}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDragOver(rowKey);
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => editable && onDrop(e)}
      >
        {editable && (
          <td>
            <span
              className="handle"
              draggable
              title="Drag to reorder"
              onDragStart={(e) => {
                e.dataTransfer.setData(LINE_DRAG, String(index));
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <GripVertical size={15} />
            </span>
          </td>
        )}
        <td className="acct-cell">
          {l.ic ? (
            <span className="muted">Current account with {l.ic.partnerCompany}</span>
          ) : (
            <input
              list="accounts"
              value={l.accountText}
              onChange={(e) => onAccountText(e.target.value)}
              placeholder="Account code or name"
              disabled={!editable}
              style={l.accountText && !l.accountId ? { borderColor: 'var(--danger)' } : undefined}
            />
          )}
        </td>
        <td>
          <input value={l.description} onChange={(e) => onChange({ description: e.target.value })} disabled={!editable} maxLength={400} />
        </td>
        <td>
          {l.fx ? (
            <span className="num" style={{ display: 'block' }}>
              {homeOfFx > 0n ? formatAmount(homeOfFx) : ''}
            </span>
          ) : (
            <input
              className="amount"
              inputMode="decimal"
              value={l.debit}
              onChange={(e) => onChange({ debit: e.target.value, credit: e.target.value ? '' : l.credit })}
              disabled={!editable}
            />
          )}
        </td>
        <td>
          {l.fx ? (
            <span className="num" style={{ display: 'block' }}>
              {homeOfFx < 0n ? formatAmount(-homeOfFx) : ''}
            </span>
          ) : (
            <input
              className="amount"
              inputMode="decimal"
              value={l.credit}
              onChange={(e) => onChange({ credit: e.target.value, debit: e.target.value ? '' : l.debit })}
              disabled={!editable}
            />
          )}
        </td>
        {editable && (
          <td style={{ whiteSpace: 'nowrap' }}>
            <button
              className="btn small ghost"
              title="Foreign currency"
              onClick={() => onChange({ fx: l.fx ? null : { currencyCode: 'USD', exchangeRate: '', foreignAmount: '' }, ic: null })}
            >
              FX
            </button>
            <button
              className="btn small ghost"
              title="Charge a sister company"
              onClick={() => onChange({ ic: l.ic ? null : { partnerCompany: sisters[0] ?? '', partnerAccountId: null, partnerAccountText: '' }, fx: null, accountId: null, accountText: '' })}
              disabled={!sisters.length}
            >
              IC
            </button>
            <button className="icon-btn" title="Remove line" onClick={onRemove}>
              <Trash2 size={14} />
            </button>
          </td>
        )}
      </tr>
      {l.fx && (
        <tr>
          {editable && <td />}
          <td colSpan={5}>
            <div className="line-extra">
              <label className="field">
                Currency
                <input value={l.fx.currencyCode} maxLength={3} onChange={(e) => onChange({ fx: { ...l.fx!, currencyCode: e.target.value.toUpperCase() } })} disabled={!editable} />
              </label>
              <label className="field">
                Exchange rate
                <input inputMode="decimal" value={l.fx.exchangeRate} onChange={(e) => onChange({ fx: { ...l.fx!, exchangeRate: e.target.value } })} disabled={!editable} />
              </label>
              <label className="field">
                Foreign amount (minus for a credit)
                <input inputMode="decimal" value={l.fx.foreignAmount} onChange={(e) => onChange({ fx: { ...l.fx!, foreignAmount: e.target.value } })} disabled={!editable} />
              </label>
            </div>
          </td>
        </tr>
      )}
      {control && (
        <tr>
          {editable && <td />}
          <td colSpan={5}>
            <div className="line-extra">
              <label className="field" style={{ gridColumn: 'span 2' }}>
                {word}
                <input
                  list={partyListId}
                  value={l.partyText}
                  onChange={(e) => {
                    const p = findParty(parties, e.target.value);
                    onChange({ partyText: e.target.value, partyId: p?.id ?? null });
                  }}
                  disabled={!editable}
                  placeholder={`${word} code or name`}
                  style={l.partyText && !l.partyId && !findParty(parties, l.partyText) ? { borderColor: 'var(--danger)' } : undefined}
                />
                <datalist id={partyListId}>
                  {parties.map((p) => (
                    <option key={p.id} value={partyLabel(p)} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Due date (blank: from the terms)
                <input type="date" value={l.dueDate} onChange={(e) => onChange({ dueDate: e.target.value })} disabled={!editable} />
              </label>
            </div>
          </td>
        </tr>
      )}
      {l.ic && (
        <tr>
          {editable && <td />}
          <td colSpan={5}>
            <div className="line-extra">
              <label className="field">
                Sister company
                <select value={l.ic.partnerCompany} onChange={(e) => onChange({ ic: { partnerCompany: e.target.value, partnerAccountId: null, partnerAccountText: '' } })} disabled={!editable}>
                  {sisters.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ gridColumn: 'span 2' }}>
                Its account that takes the amount
                <input
                  list={listId}
                  value={l.ic.partnerAccountText}
                  onChange={(e) => {
                    const a = findAccount(partnerAccounts, e.target.value);
                    onChange({ ic: { ...l.ic!, partnerAccountText: e.target.value, partnerAccountId: a?.id ?? null } });
                  }}
                  disabled={!editable}
                  placeholder="Account in the sister company"
                />
                <datalist id={listId}>
                  {partnerAccounts.map((a) => (
                    <option key={a.id} value={accountLabel(a)} />
                  ))}
                </datalist>
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
