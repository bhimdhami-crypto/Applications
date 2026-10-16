'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorAlert, PageHead } from '@/components/ui';
import { Initials, whenLabel } from '@/components/WorkplaceBits';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import type { ChatMessage, Conversation, PersonCard } from '@/lib/types';

const POLL_MS = 4000;

/** Searches colleagues with a portal account and picks one */
function PeoplePicker({ onPick, exclude = [] }: { onPick: (p: PersonCard) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PersonCard[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<PersonCard[]>(`/chat/people?q=${encodeURIComponent(q)}`)
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = (found ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <div>
      <input autoFocus aria-label="Search people" placeholder="Search by name or job title" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick">
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)}>
              <Initials name={p.name} size={28} />
              <span>
                {p.name}
                <span className="muted small">
                  {' '}
                  · {p.jobTitle}
                  {p.company ? ` · ${p.company}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
        {found && shown.length === 0 && <li className="muted small">Nobody found. Only people with a portal account can chat.</li>}
      </ul>
    </div>
  );
}

/** Direct and group chats with colleagues anywhere in the group */
export default function ChatPage() {
  const { t, lang } = usePrefs();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'' | 'direct' | 'group' | 'add'>('');
  const [group, setGroup] = useState<{ name: string; people: PersonCard[] }>({ name: '', people: [] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useRef('');
  const active = list?.find((c) => c.id === activeId);

  const loadList = useCallback(() => {
    api<Conversation[]>('/chat/conversations')
      .then((l) => {
        setList(l);
        setActiveId((id) => id || (window.innerWidth > 760 ? (l[0]?.id ?? '') : ''));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(loadList, [loadList]);

  // Opening a chat loads the newest page, then polls for new messages
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    setMessages([]);
    lastId.current = '';
    api<{ messages: ChatMessage[]; hasOlder: boolean }>(`/chat/conversations/${activeId}/messages`)
      .then((r) => {
        if (!live) return;
        setMessages(r.messages);
        setHasOlder(r.hasOlder);
        lastId.current = r.messages.at(-1)?.id ?? '';
        setTimeout(() => bottom.current?.scrollIntoView({ block: 'nearest' }), 0);
        loadList();
      })
      .catch((e) => setError(e.message));
    const timer = setInterval(() => {
      const after = lastId.current ? `?after=${lastId.current}` : '';
      api<{ messages: ChatMessage[] }>(`/chat/conversations/${activeId}/messages${after}`)
        .then((r) => {
          if (!live || !r.messages.length) return;
          setMessages((m) => (after ? [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))] : r.messages));
          lastId.current = r.messages.at(-1)!.id;
          setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
          loadList();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [activeId, loadList]);

  // Keeps unread counts fresh for chats that are not open
  useEffect(() => {
    const timer = setInterval(loadList, 15_000);
    return () => clearInterval(timer);
  }, [loadList]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const older = () =>
    guard(async () => {
      const first = messages[0];
      if (!first) return;
      const r = await api<{ messages: ChatMessage[]; hasOlder: boolean }>(`/chat/conversations/${activeId}/messages?before=${first.id}`);
      setMessages((m) => [...r.messages, ...m]);
      setHasOlder(r.hasOlder);
    });

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    guard(async () => {
      const m = await api<ChatMessage>(`/chat/conversations/${activeId}/messages`, { method: 'POST', body: { body } });
      setDraft('');
      setMessages((all) => [...all, m]);
      lastId.current = m.id;
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
      loadList();
    });
  };

  const start = (userIds: string[], name?: string) =>
    guard(async () => {
      const r = await api<{ id: string }>('/chat/conversations', { method: 'POST', body: { userIds, name } });
      setMode('');
      setGroup({ name: '', people: [] });
      loadList();
      setActiveId(r.id);
    });

  const addPerson = (p: PersonCard) =>
    guard(async () => {
      await api(`/chat/conversations/${activeId}/members`, { method: 'POST', body: { userIds: [p.id] } });
      setMode('');
      setNotice(`${p.name} was added to ${active?.name}.`);
      loadList();
    });

  const leave = () => {
    if (!active || !window.confirm(`Leave ${active.name}? You will still see what was said before you left.`)) return;
    guard(async () => {
      await api(`/chat/conversations/${active.id}/leave`, { method: 'POST' });
      loadList();
    });
  };

  const remove = (m: ChatMessage) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    guard(async () => {
      await api(`/chat/messages/${m.id}`, { method: 'DELETE' });
      setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, body: null, removed: 'Deleted by the sender' } : x)));
    });
  };

  const report = (m: ChatMessage) => {
    const reason = window.prompt('Why are you reporting this message? HR reviews reports within 1 working day.');
    if (!reason) return;
    guard(async () => {
      await api('/community/reports', { method: 'POST', body: { target: 'MESSAGE', targetId: m.id, reason } });
      setNotice('Thank you. The message was reported to HR.');
    });
  };

  return (
    <>
      <PageHead
        title={t('nav.chat')}
        sub={
          <>
            Chats are company records. Keep them professional, and keep client data, source code and passwords out of them (<Link href="/policies">POL-20</Link>).
          </>
        }
      />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error} />
      <div className={`chat${activeId ? ' has-active' : ''}`}>
        <aside className="card chat-list" aria-label="Chats">
          <div className="chat-new">
            <button type="button" className="btn small" aria-expanded={mode === 'direct'} onClick={() => setMode(mode === 'direct' ? '' : 'direct')}>
              New chat
            </button>
            <button type="button" className="btn secondary small" aria-expanded={mode === 'group'} onClick={() => setMode(mode === 'group' ? '' : 'group')}>
              New group
            </button>
          </div>
          {mode === 'direct' && <PeoplePicker onPick={(p) => start([p.id])} />}
          {mode === 'group' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start(
                  group.people.map((p) => p.id),
                  group.name,
                );
              }}
            >
              <label className="field">
                <span>Group name</span>
                <input required minLength={2} maxLength={80} value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} />
              </label>
              <div className="chips">
                {group.people.map((p) => (
                  <span className="chip" key={p.id}>
                    {p.name}{' '}
                    <button type="button" className="linkish muted" aria-label={`Remove ${p.name}`} onClick={() => setGroup({ ...group, people: group.people.filter((x) => x.id !== p.id) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <PeoplePicker exclude={group.people.map((p) => p.id)} onPick={(p) => setGroup({ ...group, people: [...group.people, p] })} />
              <button type="submit" className="btn small" style={{ marginTop: '.5rem' }} disabled={!group.people.length}>
                Create group
              </button>
            </form>
          )}
          <ul className="convos">
            {list?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`convo${c.id === activeId ? ' active' : ''}`}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  onClick={() => {
                    setActiveId(c.id);
                    setMode('');
                  }}
                >
                  <Initials name={c.name} group={c.kind === 'GROUP'} />
                  <span className="convo-text">
                    <span className="convo-name">
                      {c.name}
                      {c.left && <span className="muted small"> (left)</span>}
                    </span>
                    <span className="muted small">{c.preview ? `${c.preview.from}: ${c.preview.text}` : c.kind === 'GROUP' ? `${c.members.length} people` : 'No messages yet'}</span>
                  </span>
                  {c.unread > 0 && (
                    <span className="count" aria-label={`${c.unread} unread`}>
                      {c.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {list && list.length === 0 && <li className="muted small">No chats yet. Start one with “New chat”.</li>}
          </ul>
        </aside>

        <section className="card chat-pane" aria-label={active?.name ?? 'Chat'}>
          {!active ? (
            <p className="muted" style={{ padding: '1rem' }}>
              Choose a chat, or start a new one.
            </p>
          ) : (
            <>
              <header className="chat-head">
                <button type="button" className="linkish back" onClick={() => setActiveId('')}>
                  ← Chats
                </button>
                <div>
                  <strong>{active.name}</strong>
                  <div className="muted small">{active.kind === 'GROUP' ? active.members.map((m) => m.name).join(', ') : active.members.find((m) => m.name === active.name)?.jobTitle}</div>
                </div>
                {active.kind === 'GROUP' && !active.left && (
                  <span className="chat-new">
                    <button type="button" className="btn secondary small" onClick={() => setMode(mode === 'add' ? '' : 'add')}>
                      Add people
                    </button>
                    <button type="button" className="btn secondary small" onClick={leave}>
                      Leave
                    </button>
                  </span>
                )}
              </header>
              {mode === 'add' && (
                <div style={{ padding: '.6rem 1rem' }}>
                  <PeoplePicker exclude={active.members.map((m) => m.id)} onPick={addPerson} />
                </div>
              )}
              <div className="messages" aria-live="polite">
                {hasOlder && (
                  <button type="button" className="linkish small" onClick={older}>
                    Show older messages
                  </button>
                )}
                {messages.map((m, i) => {
                  const showName = !m.mine && active.kind === 'GROUP' && messages[i - 1]?.sender.id !== m.sender.id;
                  return (
                    <div key={m.id} className={`msg${m.mine ? ' mine' : ''}`}>
                      {showName && <div className="muted small">{m.sender.name}</div>}
                      <div className={`bubble${m.removed ? ' removed' : ''}`}>{m.body ?? m.removed}</div>
                      <div className="msg-meta muted">
                        <time dateTime={m.createdAt}>{whenLabel(m.createdAt, lang)}</time>
                        {!m.removed &&
                          (m.mine ? (
                            <button type="button" className="linkish muted" onClick={() => remove(m)}>
                              Delete
                            </button>
                          ) : (
                            <button type="button" className="linkish muted" onClick={() => report(m)}>
                              Report
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              {active.left ? (
                <p className="muted small" style={{ padding: '0 1rem 1rem' }}>
                  You left this group.
                </p>
              ) : (
                <form className="composer" onSubmit={send}>
                  <textarea
                    rows={2}
                    maxLength={4000}
                    aria-label="Message"
                    placeholder="Write a message. Enter sends, Shift+Enter adds a line."
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button type="submit" className="btn" disabled={!draft.trim()}>
                    Send
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
