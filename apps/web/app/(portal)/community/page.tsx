'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, initials, openFile, Post, PostComment, whenLabel } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useBlobUrl } from '@/lib/use-blob-url';

const MAX_FILES = 4;
const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,application/pdf';

function Media({ post, a }: { post: Post; a: Post['attachments'][number] }) {
  const path = `/community/posts/${post.id}/files/${a.index}`;
  const isMedia = a.mime.startsWith('image/') || a.mime === 'video/mp4';
  const url = useBlobUrl(isMedia ? path : null);
  if (a.mime.startsWith('image/')) return url ? <img src={url} alt={a.name} /> : <div className="media-wait" />;
  if (a.mime === 'video/mp4') return url ? <video src={url} controls preload="metadata" /> : <div className="media-wait" />;
  return <button type="button" className="secondary small" onClick={() => openFile(path)}>Open {a.name}</button>;
}

function Comment({ c, canRemove, onRemove, onReport }: { c: PostComment; canRemove: boolean; onRemove: () => void; onReport: () => void }) {
  return (
    <li className="comment">
      <span className="avatar small">{initials(c.author.name)}</span>
      <div>
        <strong>{c.author.name}</strong> <span className="muted small">{whenLabel(c.createdAt)}</span>
        <div className={c.removed ? 'muted small' : ''}>{c.body ?? c.removed}</div>
        {!c.removed && (
          <div className="post-tools">
            {canRemove && <button type="button" className="link small" onClick={onRemove}>{c.mine ? 'Delete' : 'Remove'}</button>}
            {!c.mine && <button type="button" className="link small" onClick={onReport}>Report</button>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function CommunityPage() {
  const { can } = useSession();
  const moderator = can('HR');
  const [posts, setPosts] = useState<Post[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<{ posts: Post[]; hasMore: boolean }>('/community/posts').then((r) => {
      setPosts(r.posts);
      setHasMore(r.hasMore);
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function more() {
    const r = await api<{ posts: Post[]; hasMore: boolean }>(`/community/posts?before=${posts[posts.length - 1].id}`);
    setPosts((p) => [...p, ...r.posts]);
    setHasMore(r.hasMore);
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('body', body);
      if (files.length) form.append('filesConfirmed', String(confirmed));
      for (const f of files) form.append('files', f);
      const post = await api<Post>('/community/posts', { method: 'POST', body: form });
      setPosts((p) => [post, ...p]);
      setBody('');
      setFiles([]);
      setConfirmed(false);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const update = (id: string, change: (p: Post) => Post) => setPosts((all) => all.map((p) => (p.id === id ? change(p) : p)));

  async function like(p: Post) {
    const r = await api<{ liked: boolean; likes: number }>(`/community/posts/${p.id}/like`, { method: p.liked ? 'DELETE' : 'POST' }).catch((e) => setError(e.message));
    if (r) update(p.id, (x) => ({ ...x, liked: r.liked, likes: r.likes }));
  }

  async function comment(e: FormEvent, p: Post) {
    e.preventDefault();
    const text = (comments[p.id] ?? '').trim();
    if (!text) return;
    try {
      const c = await api<PostComment>(`/community/posts/${p.id}/comments`, { method: 'POST', body: { body: text } });
      update(p.id, (x) => ({ ...x, comments: [...x.comments, c] }));
      setComments({ ...comments, [p.id]: '' });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removePost(p: Post) {
    if (!window.confirm(p.mine ? 'Delete your post?' : `Remove ${p.author.name}'s post? They will be emailed.`)) return;
    try {
      await api(`/community/posts/${p.id}`, { method: 'DELETE' });
      if (p.mine) setPosts((all) => all.filter((x) => x.id !== p.id));
      else update(p.id, (x) => ({ ...x, body: null, removed: 'Removed by a moderator', attachments: [] }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeComment(p: Post, c: PostComment) {
    if (!window.confirm('Remove this comment?')) return;
    try {
      await api(`/community/comments/${c.id}`, { method: 'DELETE' });
      update(p.id, (x) => ({ ...x, comments: x.comments.map((y) => (y.id === c.id ? { ...y, body: null, removed: c.mine ? 'Deleted by the author' : 'Removed by a moderator' } : y)) }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function report(target: 'POST' | 'COMMENT', targetId: string) {
    const reason = window.prompt('Why are you reporting this? For a copyright claim, say who owns the work. HR reviews reports within 1 working day.');
    if (!reason) return;
    try {
      await api('/reports', { method: 'POST', body: { target, targetId, reason } });
      setNotice('Thank you. It was reported to HR.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Community</h1>
      <p className="muted">Share team news, wins, events and things you learned with colleagues in all eight countries. Please follow the <Link href="/policies">community guidelines (POL-20)</Link>.</p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <form className="card composer-post" onSubmit={publish}>
        <textarea rows={3} maxLength={5000} required placeholder="What would you like to share?" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="composer-row">
          <label className="file-pick">
            Photos, a video or a PDF (up to {MAX_FILES})
            <input
              type="file"
              multiple
              accept={ACCEPT}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > MAX_FILES) setError(`Choose at most ${MAX_FILES} files`);
                setFiles(list.slice(0, MAX_FILES));
              }}
            />
          </label>
          <button type="submit" disabled={busy || !body.trim() || (files.length > 0 && !confirmed)}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
        {files.length > 0 && (
          <label className="inline-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I made these files or have permission to share them, and anyone recognisable in them agreed to be shown.
          </label>
        )}
        <p className="muted small" style={{ margin: 0 }}>Photos and PDFs up to 10 MB, MP4 videos up to 50 MB.</p>
      </form>

      {posts.map((p) => (
        <article className="card post" key={p.id}>
          <header>
            <span className="avatar">{initials(p.author.name)}</span>
            <div>
              <strong>{p.author.name}</strong>
              <div className="muted small">{p.author.jobTitle}{p.author.country ? ` · ${p.author.country}` : ''} · {whenLabel(p.createdAt)}</div>
            </div>
          </header>
          {p.removed ? (
            <p className="muted">{p.removed}</p>
          ) : (
            <>
              <p className="post-body">{p.body}</p>
              {p.attachments.length > 0 && <div className={`media n${Math.min(p.attachments.length, 4)}`}>{p.attachments.map((a) => <Media key={a.index} post={p} a={a} />)}</div>}
              <div className="post-tools">
                <button type="button" className={`link${p.liked ? ' on' : ''}`} onClick={() => like(p)}>{p.liked ? '♥ Liked' : '♡ Like'}</button>
                <span className="muted small">{p.likes} {p.likes === 1 ? 'like' : 'likes'} · {p.comments.filter((c) => !c.removed).length} comments</span>
                {(p.mine || moderator) && <button type="button" className="link small" onClick={() => removePost(p)}>{p.mine ? 'Delete' : 'Remove'}</button>}
                {!p.mine && <button type="button" className="link small" onClick={() => report('POST', p.id)}>Report</button>}
              </div>
              <ul className="comments">
                {p.comments.map((c) => (
                  <Comment key={c.id} c={c} canRemove={c.mine || moderator} onRemove={() => removeComment(p, c)} onReport={() => report('COMMENT', c.id)} />
                ))}
              </ul>
              <form className="comment-form" onSubmit={(e) => comment(e, p)}>
                <input maxLength={2000} placeholder="Write a comment" value={comments[p.id] ?? ''} onChange={(e) => setComments({ ...comments, [p.id]: e.target.value })} />
                <button type="submit" className="secondary small" disabled={!(comments[p.id] ?? '').trim()}>Comment</button>
              </form>
            </>
          )}
        </article>
      ))}
      {hasMore && <button type="button" className="secondary" onClick={more}>Show older posts</button>}
      {posts.length === 0 && !error && <div className="card muted">No posts yet. Be the first to share something.</div>}
    </>
  );
}
