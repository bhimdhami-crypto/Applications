'use client';

import { COUNTRIES, DELEGABLE_ROLES, Role, ROLE_LABELS, ROLES, ScopeType } from '@gpp/shared';
import { FormEvent, useState } from 'react';
import { ErrorAlert, fmtDate, Loading, PageHead, Pager, useLoad } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Paged, UserRow } from '@/lib/types';

interface Grant {
  role: Role;
  scopeType: ScopeType;
  countryCode?: string;
  legalEntityId?: string;
}

export default function Users() {
  const { can } = useSession();
  const { t, lang } = usePrefs();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad(() => api<Paged<UserRow>>(`/users?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`), [page, q]);

  return (
    <>
      <PageHead
        title={t('nav.users')}
        sub="Each role applies to the whole group, one country or one company. You only see people inside your own scope."
        actions={
          <>
            <input
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              style={{ width: 220 }}
            />
            {can('users.manage') && (
              <button className="btn" onClick={() => setInviting(!inviting)}>
                Invite user
              </button>
            )}
          </>
        }
      />
      {inviting && (
        <Invite
          onDone={() => {
            setInviting(false);
            list.reload();
          }}
        />
      )}
      <ErrorAlert error={list.error} />
      {!list.data ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <UserLine key={u.id} u={u} open={openId === u.id} onToggle={() => setOpenId(openId === u.id ? null : u.id)} onChange={list.reload} lang={lang} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

function UserLine({ u, open, onToggle, onChange, lang }: { u: UserRow; open: boolean; onToggle: () => void; onChange: () => void; lang: string }) {
  const { can, me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const manage = can('users.manage') && u.id !== me.user.id;
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <tr>
        <td>{u.displayName}</td>
        <td className="mono">{u.email}</td>
        <td>
          <div className="chips">
            {u.roles.map((r) => (
              <span key={r.id} className="badge" title={r.scopeLabel}>
                {r.label} · {r.scopeType === 'GROUP' ? 'Group' : r.scopeType === 'COUNTRY' ? r.countryCode : r.scopeLabel}
              </span>
            ))}
          </div>
        </td>
        <td className="muted">{fmtDate(u.lastLoginAt, lang, true)}</td>
        <td>
          {!u.isActive ? <span className="badge bad">Deactivated</span> : u.invitePending ? <span className="badge warn">Invited</span> : u.locked ? <span className="badge warn">Locked</span> : <span className="badge ok">Active</span>}
        </td>
        <td>
          {manage && (
            <button className="btn secondary small" aria-expanded={open} onClick={onToggle}>
              Manage
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-alt)' }}>
            <ErrorAlert error={error} />
            <h3>Roles</h3>
            <ul>
              {u.roles.map((r) => (
                <li key={r.id} style={{ marginBottom: '.3rem' }}>
                  {r.label} · {r.scopeLabel}{' '}
                  <button className="btn danger small" onClick={() => act(() => api(`/users/${u.id}/roles/${r.id}`, { method: 'DELETE' }))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <GrantForm submitLabel="Give role" onSubmit={(g) => act(() => api(`/users/${u.id}/roles`, { method: 'POST', body: g }))} />
            <div className="row" style={{ marginTop: '.5rem' }}>
              <button className="btn secondary small" onClick={() => act(() => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }))}>
                {u.isActive ? 'Deactivate and sign out everywhere' : 'Reactivate'}
              </button>
              {u.invitePending && (
                <button className="btn secondary small" onClick={() => act(() => api(`/users/${u.id}/resend-invite`, { method: 'POST' }))}>
                  Resend invitation
                </button>
              )}
              {u.locked && (
                <button className="btn secondary small" onClick={() => act(() => api(`/users/${u.id}/unlock`, { method: 'POST' }))}>
                  Unlock
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function GrantForm({ onSubmit, submitLabel }: { onSubmit: (g: Grant) => void; submitLabel: string }) {
  const { me } = useSession();
  const groupAdmin = me.roles.some((r) => r.role === 'GROUP_ADMIN' && r.scopeType === 'GROUP');
  const manageGroup = me.permissions['users.manage']?.group;
  const roles = groupAdmin ? ROLES : DELEGABLE_ROLES;
  const countries = [...new Set(me.entities.map((e) => e.countryCode))];
  const [g, setG] = useState<Grant>({ role: roles[0], scopeType: 'LEGAL_ENTITY', legalEntityId: me.entities[0]?.id });

  return (
    <div className="row">
      <label className="field">
        <span>Role</span>
        <select value={g.role} onChange={(e) => setG({ ...g, role: e.target.value as Role })}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Applies to</span>
        <select value={g.scopeType} onChange={(e) => setG({ ...g, scopeType: e.target.value as ScopeType, countryCode: countries[0], legalEntityId: me.entities[0]?.id })}>
          {manageGroup && <option value="GROUP">Whole group</option>}
          <option value="COUNTRY">One country</option>
          <option value="LEGAL_ENTITY">One company</option>
        </select>
      </label>
      {g.scopeType === 'COUNTRY' && (
        <label className="field">
          <span>Country</span>
          <select value={g.countryCode} onChange={(e) => setG({ ...g, countryCode: e.target.value })}>
            {countries.map((c) => (
              <option key={c} value={c}>
                {COUNTRIES.find((x) => x.code === c)?.name ?? c}
              </option>
            ))}
          </select>
        </label>
      )}
      {g.scopeType === 'LEGAL_ENTITY' && (
        <label className="field">
          <span>Company</span>
          <select value={g.legalEntityId} onChange={(e) => setG({ ...g, legalEntityId: e.target.value })}>
            {me.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.countryCode} · {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <button
          type="button"
          className="btn small"
          onClick={() =>
            onSubmit({
              role: g.role,
              scopeType: g.scopeType,
              ...(g.scopeType === 'COUNTRY' ? { countryCode: g.countryCode } : {}),
              ...(g.scopeType === 'LEGAL_ENTITY' ? { legalEntityId: g.legalEntityId } : {}),
            })
          }
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Invite({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setName] = useState('');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!grants.length) return setError('Give at least one role');
    try {
      await api('/users', { method: 'POST', body: { email, displayName, roles: grants } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={send} style={{ marginBottom: '1rem' }}>
      <h2>Invite a user</h2>
      <p className="muted">They get an email with a link to set their password. The link works for 72 hours.</p>
      <ErrorAlert error={error} />
      <div className="row">
        <label className="field">
          <span>Work email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Full name</span>
          <input required value={displayName} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <GrantForm submitLabel="Add role" onSubmit={(g) => setGrants([...grants, g])} />
      {grants.length > 0 && (
        <ul>
          {grants.map((g, i) => (
            <li key={i}>
              {ROLE_LABELS[g.role]} · {g.scopeType === 'GROUP' ? 'Whole group' : g.countryCode ?? 'Company'}{' '}
              <button type="button" className="btn danger small" onClick={() => setGrants(grants.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn">Send invitation</button>
    </form>
  );
}
