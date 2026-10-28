'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ChatMessage, Conversation, initials, Person, whenLabel } from '@/lib/api';
import { PageHeader } from '@/components/ui';

const POLL_MS = 4000;

/** Search people with a portal login; picks one or more */
function PeoplePicker({ onPick, exclude = [] }: { onPick: (p: Person) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Person[]>(`/chat/people?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input autoFocus placeholder="Search by name or job title" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick">
        {found.filter((p) => !exclude.includes(p.id)).map((p) => (
          <li key={p.id}>
            <button type="button" className="link" onClick={() => onPick(p)}>
              <span className="avatar">{initials(p.name)}</span>
              <span>{p.name}<span className="muted small"> · {p.jobTitle}{p.country ? ` · ${p.country}` : ''}</span></span>
            </button>
          </li>
        ))}
        {found.length === 0 && <li className="muted small">Nobody found. Only people with a portal login can chat.</li>}
      </ul>
    </div>
  );
}

export default function ChatPage() {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'' | 'direct' | 'group' | 'add'>('');
  const [group, setGroup] = useState<{ name: string; people: Person[] }>({ name: '', people: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useRef('');
  const active = list?.find((c) => c.id === activeId);

  const loadList = useCallback(() => {
    api<Conversation[]>('/chat/conversations').then((l) => {
      setList(l);
      setActiveId((id) => id || (typeof window !== 'undefined' && window.innerWidth > 760 ? l[0]?.id ?? '' : ''));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(loadList, [loadList]);

  // Open a chat: newest page, then poll for new messages
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    setMessages([]);
    lastId.current = '';
    api<{ messages: ChatMessage[]; hasOlder: boolean }>(`/chat/conversations/${activeId}/messages`).then((r) => {
      if (!live) return;
      setMessages(r.messages);
      setHasOlder(r.hasOlder);
      lastId.current = r.messages[r.messages.length - 1]?.id ?? '';
      setTimeout(() => bottom.current?.scrollIntoView(), 0);
      loadList();
    }).catch((e) => setError(e.message));
    const timer = setInterval(() => {
      const after = lastId.current ? `?after=${lastId.current}` : '';
      api<{ messages: ChatMessage[] }>(`/chat/conversations/${activeId}/messages${after}`).then((r) => {
        if (!live || !r.messages.length) return;
        setMessages((m) => (after ? [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))] : r.messages));
        lastId.current = r.messages[r.messages.length - 1].id;
        setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 0);
        loadList();
      }).catch(() => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [activeId, loadList]);

  // Keep the list fresh for chats that are not open
  useEffect(() => {
    const t = setInterval(loadList, 15_000);
    return () => clearInterval(t);
  }, [loadList]);

  async function older() {
    const first = messages[0];
    if (!first) return;
    const r = await api<{ messages: ChatMessage[]; hasOlder: boolean }>(`/chat/conversations/${activeId}/messages?before=${first.id}`);
    setMessages((m) => [...r.messages, ...m]);
    setHasOlder(r.hasOlder);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError('');
    try {
      const m = await api<ChatMessage>(`/chat/conversations/${activeId}/messages`, { method: 'POST', body: { body } });
      setDraft('');
      setMessages((all) => [...all, m]);
      lastId.current = m.id;
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 0);
      loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function start(userIds: string[], name?: string) {
    setError('');
    try {
      const r = await api<{ id: string }>('/chat/conversations', { method: 'POST', body: { userIds, name } });
      setMode('');
      setGroup({ name: '', people: [] });
      loadList();
      setActiveId(r.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addPerson(p: Person) {
    try {
      await api(`/chat/conversations/${activeId}/members`, { method: 'POST', body: { userIds: [p.id] } });
      setMode('');
      setNotice(`${p.name} was added to ${active?.name}.`);
      loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function leave() {
    if (!active || !window.confirm(`Leave ${active.name}? You will still see what was said before you left.`)) return;
    await api(`/chat/conversations/${active.id}/leave`, { method: 'POST' }).catch((e) => setError(e.message));
    loadList();
  }

  async function remove(m: ChatMessage) {
    if (!window.confirm('Delete this message for everyone?')) return;
    await api(`/chat/messages/${m.id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, body: null, removed: 'Deleted by the sender' } : x)));
  }

  async function report(m: ChatMessage) {
    const reason = window.prompt('Why are you reporting this message? HR moderators will review it within 1 working day.');
    if (!reason) return;
    try {
      await api('/reports', { method: 'POST', body: { target: 'MESSAGE', targetId: m.id, reason } });
      setNotice('Thank you. The message was reported to HR.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Chat" sub={<>Chats are company records. Keep them professional and keep client data, source code and passwords out of them (<Link href="/policies">POL-20</Link>).</>} />
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
      <div className={`chat ${activeId ? 'has-active' : ''}`}>
        <aside className="card chat-list">
          <div className="chat-new">
            <button type="button" className="small" onClick={() => setMode(mode === 'direct' ? '' : 'direct')}>New chat</button>
            <button type="button" className="secondary small" onClick={() => setMode(mode === 'group' ? '' : 'group')}>New group</button>
          </div>
          {mode === 'direct' && <PeoplePicker onPick={(p) => start([p.id])} />}
          {mode === 'group' && (
            <form onSubmit={(e) => { e.preventDefault(); start(group.people.map((p) => p.id), group.name); }}>
              <label>Group name<input required minLength={2} maxLength={80} value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} /></label>
              <div className="chips">{group.people.map((p) => <span className="chip" key={p.id}>{p.name} <button type="button" className="link" aria-label={`Remove ${p.name}`} onClick={() => setGroup({ ...group, people: group.people.filter((x) => x.id !== p.id) })}>×</button></span>)}</div>
              <PeoplePicker exclude={group.people.map((p) => p.id)} onPick={(p) => setGroup({ ...group, people: [...group.people, p] })} />
              <button type="submit" className="small" disabled={!group.people.length}>Create group</button>
            </form>
          )}
          <ul className="convos">
            {list?.map((c) => (
              <li key={c.id}>
                <button type="button" className={`convo${c.id === activeId ? ' active' : ''}`} onClick={() => { setActiveId(c.id); setMode(''); }}>
                  <span className={`avatar${c.kind === 'GROUP' ? ' group' : ''}`}>{initials(c.name)}</span>
                  <span className="convo-text">
                    <span className="convo-name">{c.name}{c.left && <span className="muted small"> (left)</span>}</span>
                    <span className="muted small">{c.preview ? `${c.preview.from}: ${c.preview.text}` : c.kind === 'GROUP' ? `${c.members.length} people` : 'No messages yet'}</span>
                  </span>
                  {c.unread > 0 && <span className="count">{c.unread}</span>}
                </button>
              </li>
            ))}
            {list && list.length === 0 && <li className="muted small">No chats yet. Start one with “New chat”.</li>}
          </ul>
        </aside>

        <section className="card chat-pane">
          {!active ? (
            <p className="muted">Choose a chat on the left, or start a new one.</p>
          ) : (
            <>
              <header className="chat-head">
                <button type="button" className="link back" onClick={() => setActiveId('')}>← Chats</button>
                <div>
                  <strong>{active.name}</strong>
                  <div className="muted small">{active.kind === 'GROUP' ? active.members.map((m) => m.name).join(', ') : active.members.find((m) => m.name === active.name)?.jobTitle}</div>
                </div>
                {active.kind === 'GROUP' && !active.left && (
                  <span className="chat-tools">
                    <button type="button" className="secondary small" onClick={() => setMode(mode === 'add' ? '' : 'add')}>Add people</button>{' '}
                    <button type="button" className="secondary small" onClick={leave}>Leave</button>
                  </span>
                )}
              </header>
              {mode === 'add' && <PeoplePicker exclude={active.members.map((m) => m.id)} onPick={addPerson} />}
              <div className="messages">
                {hasOlder && <button type="button" className="link small" onClick={older}>Show older messages</button>}
                {messages.map((m, i) => {
                  const showName = !m.mine && active.kind === 'GROUP' && messages[i - 1]?.sender.id !== m.sender.id;
                  return (
                    <div key={m.id} className={`msg${m.mine ? ' mine' : ''}`}>
                      {showName && <div className="muted small">{m.sender.name}</div>}
                      <div className={`bubble${m.removed ? ' removed' : ''}`}>{m.body ?? m.removed}</div>
                      <div className="msg-meta muted small">
                        {whenLabel(m.createdAt)}
                        {!m.removed && (m.mine
                          ? <button type="button" className="link" onClick={() => remove(m)}>Delete</button>
                          : <button type="button" className="link" onClick={() => report(m)}>Report</button>)}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              {active.left ? (
                <p className="muted small">You left this group.</p>
              ) : (
                <form className="composer" onSubmit={send}>
                  <textarea
                    rows={2}
                    maxLength={4000}
                    placeholder="Write a message. Enter sends, Shift+Enter adds a line."
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as unknown as FormEvent); } }}
                  />
                  <button type="submit" disabled={!draft.trim()}>Send</button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
