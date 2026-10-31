'use client';

import { ArrowRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalMatrix, Role, RuleBand, api, errorText } from '@/lib/api';
import { cleanAmount, formatAmount, formatDate, toUnits } from '@/lib/money';
import { useSession } from '@/lib/session';

const ROLE_LABEL: Record<string, string> = {
  ACCOUNTANT: 'Accountant',
  FINANCE_MANAGER: 'Finance manager',
  DIRECTOR: 'Director',
  ADMIN: 'Administrator',
};
const APPROVERS = Object.keys(ROLE_LABEL) as Role[];
const STAGE_DRAG = 'application/x-mfi-stage';

/** A band while it is being edited. Its lower limit is the previous band's upper limit, so bands can never gap or overlap. */
interface BandDraft {
  key: number;
  name: string;
  sopReference: string;
  upTo: string;
  stages: { key: number; name: string; approverRole: Role }[];
}

let nextKey = 1;

function draftFrom(bands: RuleBand[]): BandDraft[] {
  return bands.map((b) => ({
    key: nextKey++,
    name: b.name,
    sopReference: b.sopReference ?? '',
    upTo: b.maxAmount ?? '',
    stages: b.stages.map((s) => ({ key: nextKey++, name: s.name, approverRole: s.approverRole })),
  }));
}

/** Same check as the server: a band needing two directors needs two different people who can act as one */
function staffingWarnings(bands: BandDraft[], users: Record<string, number>) {
  const out: string[] = [];
  for (const b of bands) {
    const need = new Map<string, number>();
    for (const s of b.stages) need.set(s.approverRole, (need.get(s.approverRole) ?? 0) + 1);
    for (const [role, n] of need) {
      const have = (users[role] ?? 0) + (role === 'ADMIN' ? 0 : (users.ADMIN ?? 0));
      if (have < n) out.push(`"${b.name || 'Unnamed band'}" needs ${n} different ${ROLE_LABEL[role].toLowerCase()} approvers; only ${have} user${have === 1 ? '' : 's'} can act as one`);
    }
  }
  return out;
}

export default function ApprovalRules() {
  const { company, can } = useSession();
  const [matrix, setMatrix] = useState<ApprovalMatrix | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<BandDraft[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isAdmin = can('ADMIN');

  const load = useCallback(() => {
    api<ApprovalMatrix>(`/companies/${company.code}/approval-matrix`)
      .then(setMatrix)
      .catch((e) => setError(errorText(e)));
  }, [company.code]);
  useEffect(load, [load]);
  useEffect(() => setEditing(null), [company.code]);

  function edit(documentType: string) {
    const dt = matrix!.documentTypes.find((d) => d.documentType === documentType)!;
    setDraft(dt.bands.length ? draftFrom(dt.bands) : [{ key: nextKey++, name: '', sopReference: '', upTo: '', stages: [{ key: nextKey++, name: 'Finance manager review', approverRole: 'FINANCE_MANAGER' }] }]);
    setReason('');
    setError('');
    setNotice('');
    setEditing(documentType);
  }

  const patchBand = (key: number, patch: Partial<BandDraft>) => setDraft((d) => d.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const patchStage = (bandKey: number, stageKey: number, patch: Partial<BandDraft['stages'][number]>) =>
    setDraft((d) => d.map((b) => (b.key === bandKey ? { ...b, stages: b.stages.map((s) => (s.key === stageKey ? { ...s, ...patch } : s)) } : b)));

  function addBand() {
    setDraft((d) => {
      const last = d[d.length - 1];
      return [
        ...d,
        { key: nextKey++, name: '', sopReference: last?.sopReference ?? '', upTo: '', stages: last ? last.stages.map((s) => ({ ...s, key: nextKey++ })) : [] },
      ];
    });
  }

  function moveStage(bandKey: number, from: number, to: number) {
    setDraft((d) =>
      d.map((b) => {
        if (b.key !== bandKey) return b;
        const stages = [...b.stages];
        const [s] = stages.splice(from, 1);
        stages.splice(to > from ? to - 1 : to, 0, s);
        return { ...b, stages };
      }),
    );
  }

  // Lower limits follow from the band before; the last band has no upper limit
  const lowerOf = (i: number) => (i === 0 ? '0' : (cleanAmount(draft[i - 1].upTo) ?? ''));

  function problems() {
    const out: string[] = [];
    draft.forEach((b, i) => {
      const label = `Band ${i + 1}`;
      if (!b.name.trim()) out.push(`${label}: give it a name`);
      if (!b.stages.length) out.push(`${label}: add at least one approval stage`);
      if (b.stages.some((s) => !s.name.trim())) out.push(`${label}: name every stage`);
      if (i < draft.length - 1) {
        const upTo = toUnits(b.upTo);
        if (upTo <= 0n) out.push(`${label}: enter where it ends`);
        else if (upTo <= toUnits(lowerOf(i))) out.push(`${label}: must end above ${formatAmount(lowerOf(i))}`);
      }
    });
    return out;
  }

  async function save() {
    const found = problems();
    if (found.length) {
      setError(found.join('. '));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const bands = draft.map((b, i) => ({
        name: b.name.trim(),
        sopReference: b.sopReference.trim() || undefined,
        minAmount: lowerOf(i),
        maxAmount: i === draft.length - 1 ? null : cleanAmount(b.upTo)!,
        stages: b.stages.map((s) => ({ name: s.name.trim(), approverRole: s.approverRole })),
      }));
      const res = await api<{ created: number; retired: number; kept: number; matrix: ApprovalMatrix }>(
        `/companies/${company.code}/approval-matrix/${editing}`,
        { method: 'PUT', body: { bands, reason: reason.trim() } },
      );
      setMatrix(res.matrix);
      setEditing(null);
      setNotice(
        res.created || res.retired
          ? `Saved: ${res.created} new rule${res.created === 1 ? '' : 's'}, ${res.retired} retired, ${res.kept} unchanged. Vouchers already submitted finish their current route.`
          : 'Nothing changed',
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!matrix) return error ? <div className="error">{error}</div> : <div className="loading-page">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Approval rules</h1>
        <span className="muted">Who approves each transaction, by type and amount ({matrix.currency})</span>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {matrix.documentTypes.map((dt) => (
        <div className="card" key={dt.documentType}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{dt.label}</h2>
            <div className="spacer" />
            {isAdmin && editing !== dt.documentType && (
              <button className="btn" onClick={() => edit(dt.documentType)} disabled={!!editing}>
                Change
              </button>
            )}
          </div>

          {editing === dt.documentType ? (
            <>
              <div className="bands">
                {draft.map((b, i) => (
                  <div className="band edit" key={b.key}>
                    <div className="band-range">
                      <span>From {formatAmount(lowerOf(i) || '0')}</span>
                      {i < draft.length - 1 ? (
                        <label className="field">
                          up to (not including)
                          <input inputMode="decimal" value={b.upTo} onChange={(e) => patchBand(b.key, { upTo: e.target.value })} placeholder="e.g. 500000" />
                        </label>
                      ) : (
                        <span className="muted">and above</span>
                      )}
                    </div>
                    <div className="fields">
                      <label className="field">
                        Name
                        <input value={b.name} onChange={(e) => patchBand(b.key, { name: e.target.value })} maxLength={200} placeholder="e.g. Journals under KES 500,000" />
                      </label>
                      <label className="field">
                        SOP reference
                        <input value={b.sopReference} onChange={(e) => patchBand(b.key, { sopReference: e.target.value })} maxLength={50} placeholder="e.g. SOP-FIN-004" />
                      </label>
                    </div>
                    <div className="stage-list">
                      {b.stages.map((s, si) => (
                        <div
                          className="stage-row"
                          key={s.key}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            const from = e.dataTransfer.getData(STAGE_DRAG);
                            if (from) {
                              e.preventDefault();
                              moveStage(b.key, Number(from), si);
                            }
                          }}
                        >
                          <span
                            className="handle"
                            draggable
                            title="Drag to change the order"
                            onDragStart={(e) => e.dataTransfer.setData(STAGE_DRAG, String(si))}
                          >
                            <GripVertical size={15} />
                          </span>
                          <span className="stage-no">{si + 1}</span>
                          <input value={s.name} onChange={(e) => patchStage(b.key, s.key, { name: e.target.value })} maxLength={100} aria-label="Stage name" />
                          <select value={s.approverRole} onChange={(e) => patchStage(b.key, s.key, { approverRole: e.target.value as Role })} aria-label="Who approves">
                            {APPROVERS.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                          <button
                            className="icon-btn"
                            title="Remove stage"
                            onClick={() => patchBand(b.key, { stages: b.stages.filter((x) => x.key !== s.key) })}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="actions-bar">
                        <button
                          className="btn small ghost"
                          onClick={() => patchBand(b.key, { stages: [...b.stages, { key: nextKey++, name: 'Director approval', approverRole: 'DIRECTOR' }] })}
                          disabled={b.stages.length >= 6}
                        >
                          <Plus size={14} /> Add stage
                        </button>
                        {draft.length > 1 && (
                          <button className="btn small ghost danger" onClick={() => setDraft((d) => d.filter((x) => x.key !== b.key))}>
                            Remove band
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn small" onClick={addBand} style={{ marginTop: 10 }} disabled={draft.length >= 20}>
                <Plus size={14} /> Add a higher band
              </button>
              {staffingWarnings(draft, matrix.usersByRole).map((w) => (
                <div className="warning" key={w}>
                  {w}
                </div>
              ))}
              <div className="fields" style={{ marginTop: 16, alignItems: 'end' }}>
                <label className="field" style={{ gridColumn: 'span 2' }}>
                  Reason for the change (kept in the audit trail)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder="e.g. Board resolution 14/2026" />
                </label>
                <div className="actions-bar">
                  <button className="btn primary" onClick={save} disabled={busy || reason.trim().length < 3}>
                    Save rules
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bands">
                {dt.bands.map((b) => (
                  <div className="band" key={b.id}>
                    <div className="band-range">
                      <strong>
                        {formatAmount(b.minAmount)} {b.maxAmount ? `to under ${formatAmount(b.maxAmount)}` : 'and above'}
                      </strong>
                      <span className="muted">
                        {b.name}
                        {b.sopReference && ` · ${b.sopReference}`}
                      </span>
                    </div>
                    <div className="stages">
                      {b.stages.map((s, i) => (
                        <span key={s.stageNo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {i > 0 && <ArrowRight size={13} className="muted" />}
                          <span className="stage">
                            {s.name} <span className="muted">({ROLE_LABEL[s.approverRole] ?? s.approverRole})</span>
                          </span>
                        </span>
                      ))}
                    </div>
                    <div className="muted band-meta">
                      {b.createdBy ? `Set by ${b.createdBy}, ${formatDate(b.createdAt)}` : `Starting rule, ${formatDate(b.createdAt)}`}
                      {b.waiting > 0 && ` · ${b.waiting} voucher${b.waiting === 1 ? '' : 's'} waiting`}
                    </div>
                  </div>
                ))}
                {dt.bands.length === 0 && <div className="empty">No rules: {dt.label.toLowerCase()} cannot be submitted until an administrator sets them.</div>}
              </div>
              {dt.problems.map((p) => (
                <div className="error" key={p} style={{ marginTop: 10, marginBottom: 0 }}>
                  {p}
                </div>
              ))}
              {dt.warnings.map((w) => (
                <div className="warning" key={w}>
                  {w}
                </div>
              ))}
            </>
          )}
        </div>
      ))}

      <div className="card">
        <div className="page-head" style={{ marginBottom: showHistory ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>Earlier versions</h2>
          <span className="muted">{matrix.history.length} retired rule{matrix.history.length === 1 ? '' : 's'}</span>
          <div className="spacer" />
          {matrix.history.length > 0 && (
            <button className="btn small" onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {showHistory && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Band</th>
                  <th>Stages</th>
                  <th>In force</th>
                  <th>Retired by</th>
                </tr>
              </thead>
              <tbody>
                {matrix.history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.documentType === 'JOURNAL' ? 'Journals' : 'Reversals'}</td>
                    <td>
                      {formatAmount(r.minAmount)} {r.maxAmount ? `to under ${formatAmount(r.maxAmount)}` : 'and above'}
                      <div className="muted">{r.name}</div>
                    </td>
                    <td>{r.stages.map((s) => ROLE_LABEL[s.approverRole] ?? s.approverRole).join(' → ')}</td>
                    <td>
                      {formatDate(r.createdAt)} to {formatDate(r.retiredAt)}
                      {r.waiting > 0 && <div className="muted">{r.waiting} still finishing this route</div>}
                    </td>
                    <td>{r.retiredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
