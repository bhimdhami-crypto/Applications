'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Empty, ErrorAlert, Loading, PageHead } from '@/components/ui';
import { Initials, useBlobUrl, whenLabel } from '@/components/WorkplaceBits';
import { api, apiUpload, openFile } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { Post, PostComment } from '@/lib/types';

const MAX_FILES = 4;
const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,application/pdf';

function Media({ post, a }: { post: Post; a: Post['attachments'][number] }) {
  const path = `/community/posts/${post.id}/files/${a.index}`;
  const isMedia = a.mime.startsWith('image/') || a.mime === 'video/mp4';
  const url = useBlobUrl(isMedia ? path : null);
  if (a.mime.startsWith('image/')) return url ? <img src={url} alt={a.name} /> : <div className="media-wait" />;
  if (a.mime === 'video/mp4') return url ? <video src={url} controls preload="metadata" aria-label={a.name} /> : <div className="media-wait" />;
  return (
    <button type="button" className="btn secondary small" onClick={() => openFile(path, a.name)}>
      Open {a.name}
    </button>
  );
}

/** Team news, wins and events shared with colleagues in every country (POL-20) */
export default function CommunityPage() {
  const { t, lang } = usePrefs();
  const { can } = useSession();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openReports, setOpenReports] = useState(0);

  const load = useCallback(() => {
    api<{ posts: Post[]; hasMore: boolean }>('/community/posts')
      .then((r) => {
        setPosts(r.posts);
        setHasMore(r.hasMore);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (can('people.manage'))
      api<{ count: number }>('/community/reports/open')
        .then((r) => setOpenReports(r.count))
        .catch(() => undefined);
  }, [can]);

  async function guard(work: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const more = () =>
    guard(async () => {
      const r = await api<{ posts: Post[]; hasMore: boolean }>(`/community/posts?before=${posts!.at(-1)!.id}`);
      setPosts((p) => [...(p ?? []), ...r.posts]);
      setHasMore(r.hasMore);
    });

  const publish = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    guard(async () => {
      const data = new FormData();
      data.append('body', body);
      if (files.length) data.append('filesConfirmed', String(confirmed));
      for (const f of files) data.append('files', f);
      const post = await apiUpload<Post>('/community/posts', data);
      setPosts((p) => [post, ...(p ?? [])]);
      setBody('');
      setFiles([]);
      setConfirmed(false);
      form.reset();
    }).finally(() => setBusy(false));
  };

  const update = (id: string, change: (p: Post) => Post) => setPosts((all) => (all ?? []).map((p) => (p.id === id ? change(p) : p)));

  const like = (p: Post) =>
    guard(async () => {
      const r = await api<{ liked: boolean; likes: number }>(`/community/posts/${p.id}/like`, { method: p.liked ? 'DELETE' : 'POST' });
      update(p.id, (x) => ({ ...x, liked: r.liked, likes: r.likes }));
    });

  const comment = (e: FormEvent, p: Post) => {
    e.preventDefault();
    const text = (comments[p.id] ?? '').trim();
    if (!text) return;
    guard(async () => {
      const c = await api<PostComment>(`/community/posts/${p.id}/comments`, { method: 'POST', body: { body: text } });
      update(p.id, (x) => ({ ...x, comments: [...x.comments, c] }));
      setComments({ ...comments, [p.id]: '' });
    });
  };

  const removePost = (p: Post) => {
    if (!window.confirm(p.mine ? 'Delete your post?' : `Remove ${p.author.name}'s post? They will be emailed.`)) return;
    guard(async () => {
      await api(`/community/posts/${p.id}`, { method: 'DELETE' });
      if (p.mine) setPosts((all) => (all ?? []).filter((x) => x.id !== p.id));
      else update(p.id, (x) => ({ ...x, body: null, removed: 'Removed by a moderator', attachments: [] }));
    });
  };

  const removeComment = (p: Post, c: PostComment) => {
    if (!window.confirm(c.mine ? 'Delete your comment?' : `Remove ${c.author.name}'s comment? They will be emailed.`)) return;
    guard(async () => {
      await api(`/community/comments/${c.id}`, { method: 'DELETE' });
      update(p.id, (x) => ({ ...x, comments: x.comments.map((y) => (y.id === c.id ? { ...y, body: null, canRemove: false, removed: c.mine ? 'Deleted by the author' : 'Removed by a moderator' } : y)) }));
    });
  };

  const report = (target: 'POST' | 'COMMENT', targetId: string) => {
    const reason = window.prompt('Why are you reporting this? For a copyright claim, say who owns the work. HR reviews reports within 1 working day.');
    if (!reason) return;
    guard(async () => {
      await api('/community/reports', { method: 'POST', body: { target, targetId, reason } });
      setNotice('Thank you. It was reported to HR.');
    });
  };

  return (
    <>
      <PageHead
        title={t('nav.community')}
        sub={
          <>
            Share team news, wins, events and things you learned with colleagues in every country. Please follow the <Link href="/policies">community guidelines (POL-20)</Link>.
          </>
        }
        actions={
          can('people.manage') ? (
            <Link href="/community/moderation">
              {t('nav.moderation')}
              {openReports > 0 && ` (${openReports} waiting)`}
            </Link>
          ) : undefined
        }
      />
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error} />

      <div className="feed">
        <form className="card" onSubmit={publish}>
          <label className="field">
            <span>Share something</span>
            <textarea rows={3} maxLength={5000} required placeholder="What would you like to share?" value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="row">
            <label className="field">
              <span>Photos, a video or a PDF (up to {MAX_FILES})</span>
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
              <small>Photos and PDFs up to 10 MB, MP4 videos up to 50 MB.</small>
            </label>
            <div className="field" style={{ flex: '0 0 auto' }}>
              <button type="submit" className="btn" disabled={busy || !body.trim() || (files.length > 0 && !confirmed)}>
                {busy ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I made these files or have permission to share them, and anyone recognisable in them agreed to be shown.
            </label>
          )}
        </form>

        {!posts ? (
          <Loading />
        ) : posts.length === 0 ? (
          <Empty>No posts yet. Be the first to share something.</Empty>
        ) : (
          posts.map((p) => (
            <article className="card post" key={p.id} aria-label={`Post by ${p.author.name}`}>
              <header>
                <Initials name={p.author.name} />
                <div>
                  <strong>{p.author.name}</strong>
                  <div className="muted small">
                    {p.author.jobTitle}
                    {p.author.company ? ` · ${p.author.company}` : ''} · <time dateTime={p.createdAt}>{whenLabel(p.createdAt, lang)}</time>
                  </div>
                </div>
              </header>
              {p.removed ? (
                <p className="muted">{p.removed}</p>
              ) : (
                <>
                  <p className="post-body">{p.body}</p>
                  {p.attachments.length > 0 && (
                    <div className={`media n${Math.min(p.attachments.length, 4)}`}>
                      {p.attachments.map((a) => (
                        <Media key={a.index} post={p} a={a} />
                      ))}
                    </div>
                  )}
                  <div className="post-tools">
                    <button type="button" className={`linkish${p.liked ? ' on' : ''}`} aria-pressed={p.liked} onClick={() => like(p)}>
                      {p.liked ? '♥ Liked' : '♡ Like'}
                    </button>
                    <span className="muted small">
                      {p.likes} {p.likes === 1 ? 'like' : 'likes'} · {p.comments.filter((c) => !c.removed).length} comments
                    </span>
                    {p.canRemove && (
                      <button type="button" className="linkish muted" onClick={() => removePost(p)}>
                        {p.mine ? 'Delete' : 'Remove'}
                      </button>
                    )}
                    {!p.mine && (
                      <button type="button" className="linkish muted" onClick={() => report('POST', p.id)}>
                        Report
                      </button>
                    )}
                  </div>
                  <ul className="comments">
                    {p.comments.map((c) => (
                      <li className="comment" key={c.id}>
                        <Initials name={c.author.name} size={28} />
                        <div>
                          <strong>{c.author.name}</strong> <span className="muted small">{whenLabel(c.createdAt, lang)}</span>
                          <div className={c.removed ? 'muted small' : ''}>{c.body ?? c.removed}</div>
                          {!c.removed && (
                            <div className="post-tools">
                              {c.canRemove && (
                                <button type="button" className="linkish muted small" onClick={() => removeComment(p, c)}>
                                  {c.mine ? 'Delete' : 'Remove'}
                                </button>
                              )}
                              {!c.mine && (
                                <button type="button" className="linkish muted small" onClick={() => report('COMMENT', c.id)}>
                                  Report
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <form className="comment-form" onSubmit={(e) => comment(e, p)}>
                    <input maxLength={2000} aria-label="Write a comment" placeholder="Write a comment" value={comments[p.id] ?? ''} onChange={(e) => setComments({ ...comments, [p.id]: e.target.value })} />
                    <button type="submit" className="btn secondary small" disabled={!(comments[p.id] ?? '').trim()}>
                      Comment
                    </button>
                  </form>
                </>
              )}
            </article>
          ))
        )}
        {hasMore && (
          <button type="button" className="btn secondary" style={{ marginTop: '1rem' }} onClick={more}>
            Show older posts
          </button>
        )}
      </div>
    </>
  );
}
