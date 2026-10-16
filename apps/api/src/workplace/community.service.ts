import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportStatus, ReportTarget } from '@prisma/client';
import { can, entitiesInScope, ROLE_PERMISSIONS, RoleAssignmentLike } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { detectFileKind, FILE_TYPES, StorageService } from '../common/storage.service';
import { MailService } from '../mail/mail.service';
import { UploadedFileLike } from '../people/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommentDto, CreatePostDto, ReportDto, ReviewDto } from './community.dto';
import { companyOf, userCard, userCardSelect, UserCardRow } from './users';

const PAGE = 20;
const MB = 1024 * 1024;
export const MAX_FILES = 4;
export const MAX_VIDEO = 50 * MB;
const MAX_FILE = 10 * MB;

/** Photos and PDFs, recognised by their first bytes, plus MP4 videos (an "ftyp" box at byte 4) */
const MEDIA = { ...FILE_TYPES, mp4: { mime: 'video/mp4', ext: 'mp4' } } as const;
type MediaKind = keyof typeof MEDIA;
function mediaKind(buf: Buffer): MediaKind | null {
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  return detectFileKind(buf);
}

interface Attachment {
  mime: string;
  ext: string;
  name: string;
  size: number;
}

const TABLE: Record<ReportTarget, string> = { POST: 'community_post', COMMENT: 'post_comment', MESSAGE: 'chat_message' };
const fileKey = (groupId: string, postId: string, index: number, ext: string) => `community/${groupId}/${postId}/${index}.${ext}`;
const removedLabel = (removedById: string | null, authorId: string, author = 'author') => (removedById === authorId ? `Deleted by the ${author}` : 'Removed by a moderator');

const postInclude = () =>
  ({
    author: { select: userCardSelect() },
    _count: { select: { likes: true } },
    comments: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: userCardSelect() } } },
  }) satisfies Prisma.CommunityPostInclude;
type PostRow = Prisma.CommunityPostGetPayload<{ include: ReturnType<typeof postInclude> }>;

/** Who moderates content: HR (people.manage) for the author's company; group-wide HR for authors with no employee record */
export function moderates(auth: AuthContext, legalEntityId: string | null) {
  if (legalEntityId) return can(auth.access, 'people.manage', legalEntityId);
  return !!auth.access.get('people.manage')?.group;
}

/**
 * The community page carried over from the first build: posts with photos, videos and PDFs, likes
 * and comments for everyone in the group, and reports that HR reviews under POL-20.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private present(auth: AuthContext, p: PostRow, liked: Set<string>) {
    const removed = !!p.removedAt;
    return {
      id: p.id,
      author: userCard(p.author),
      mine: p.authorId === auth.userId,
      canRemove: p.authorId === auth.userId || moderates(auth, companyOf(p.author)),
      body: removed ? null : p.body,
      removed: removed ? removedLabel(p.removedById, p.authorId) : null,
      attachments: removed ? [] : (p.attachments as unknown as Attachment[]).map((a, i) => ({ index: i, mime: a.mime, name: a.name, size: a.size })),
      likes: p._count.likes,
      liked: liked.has(p.id),
      createdAt: p.createdAt,
      comments: p.comments.map((c) => ({
        id: c.id,
        author: userCard(c.author),
        mine: c.authorId === auth.userId,
        canRemove: !c.removedAt && (c.authorId === auth.userId || moderates(auth, companyOf(c.author))),
        body: c.removedAt ? null : c.body,
        removed: c.removedAt ? removedLabel(c.removedById, c.authorId) : null,
        createdAt: c.createdAt,
      })),
    };
  }

  async feed(auth: AuthContext, before?: string) {
    const pivot = before ? await this.prisma.communityPost.findFirst({ where: { id: before, groupId: auth.groupId } }) : null;
    const posts = await this.prisma.communityPost.findMany({
      where: {
        groupId: auth.groupId,
        ...(pivot ? { createdAt: { lt: pivot.createdAt } } : {}),
        // Posts removed by their author disappear; moderator removals stay as a marker
        NOT: { removedAt: { not: null }, removedById: { equals: this.prisma.communityPost.fields.authorId } },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE,
      include: postInclude(),
    });
    const liked = new Set(
      (await this.prisma.postLike.findMany({ where: { userId: auth.userId, postId: { in: posts.map((p) => p.id) } }, select: { postId: true } })).map((l) => l.postId),
    );
    return { posts: posts.map((p) => this.present(auth, p, liked)), hasMore: posts.length === PAGE };
  }

  async create(auth: AuthContext, dto: CreatePostDto, files: UploadedFileLike[] = []) {
    if (files.length > MAX_FILES) throw new BadRequestException(`Attach at most ${MAX_FILES} files`);
    if (files.length && !dto.filesConfirmed) throw new BadRequestException('Confirm you created the files or have permission to share them');
    const checked = files.map((f) => {
      const kind = mediaKind(f.buffer);
      if (!kind) throw new BadRequestException(`${f.originalname}: only photos (PNG, JPEG, WebP), MP4 videos and PDFs can be shared`);
      if (f.size > (kind === 'mp4' ? MAX_VIDEO : MAX_FILE)) throw new BadRequestException(`${f.originalname} is too large (${kind === 'mp4' ? 'videos up to 50 MB' : 'up to 10 MB'})`);
      return { file: f, kind };
    });
    const post = await this.prisma.communityPost.create({ data: { groupId: auth.groupId, authorId: auth.userId, body: dto.body } });
    const attachments: Attachment[] = [];
    for (const [i, { file, kind }] of checked.entries()) {
      const { mime, ext } = MEDIA[kind];
      await this.storage.put(fileKey(auth.groupId, post.id, i, ext), file.buffer);
      attachments.push({ mime, ext, name: file.originalname.slice(0, 120), size: file.size });
    }
    const saved = await this.prisma.communityPost.update({ where: { id: post.id }, data: { attachments: attachments as unknown as Prisma.InputJsonValue }, include: postInclude() });
    return this.present(auth, saved, new Set());
  }

  async file(auth: AuthContext, postId: string, index: number) {
    const post = await this.prisma.communityPost.findFirst({ where: { id: postId, groupId: auth.groupId } });
    const a = (post?.attachments as unknown as Attachment[] | undefined)?.[index];
    if (!post || post.removedAt || !a) throw new NotFoundException('File not found');
    const data = await this.storage.get(fileKey(auth.groupId, postId, index, a.ext));
    if (!data) throw new NotFoundException('File not found');
    return { data, mime: a.mime, name: a.name };
  }

  private async livePost(auth: AuthContext, id: string) {
    const post = await this.prisma.communityPost.findFirst({ where: { id, groupId: auth.groupId }, include: { author: { select: userCardSelect() } } });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    return post;
  }

  async like(auth: AuthContext, postId: string, on: boolean) {
    await this.livePost(auth, postId);
    if (on) await this.prisma.postLike.upsert({ where: { postId_userId: { postId, userId: auth.userId } }, create: { postId, userId: auth.userId }, update: {} });
    else await this.prisma.postLike.deleteMany({ where: { postId, userId: auth.userId } });
    return { liked: on, likes: await this.prisma.postLike.count({ where: { postId } }) };
  }

  async comment(auth: AuthContext, postId: string, dto: CommentDto) {
    await this.livePost(auth, postId);
    const c = await this.prisma.postComment.create({ data: { postId, authorId: auth.userId, body: dto.body }, include: { author: { select: userCardSelect() } } });
    return { id: c.id, author: userCard(c.author), mine: true, canRemove: true, body: c.body, removed: null, createdAt: c.createdAt };
  }

  /** Authors delete their own posts and comments; HR for the author's company removes anyone's */
  async removePost(auth: AuthContext, id: string) {
    const post = await this.livePost(auth, id);
    if (post.authorId !== auth.userId && !moderates(auth, companyOf(post.author))) throw new ForbiddenException('You can only delete your own posts');
    await this.hide(auth, ReportTarget.POST, id);
    if (post.authorId !== auth.userId) await this.removedNotice(auth, post.author, 'community post', ReportTarget.POST, id);
    return { removed: true };
  }

  async removeComment(auth: AuthContext, id: string) {
    const c = await this.prisma.postComment.findFirst({ where: { id, post: { groupId: auth.groupId } }, include: { author: { select: userCardSelect() } } });
    if (!c || c.removedAt) throw new NotFoundException('Comment not found');
    if (c.authorId !== auth.userId && !moderates(auth, companyOf(c.author))) throw new ForbiddenException('You can only delete your own comments');
    await this.hide(auth, ReportTarget.COMMENT, id);
    if (c.authorId !== auth.userId) await this.removedNotice(auth, c.author, 'comment on a community post', ReportTarget.COMMENT, id);
    return { removed: true };
  }

  /** Hides content but keeps it in the records (POL-20 3.10); closes open reports on it */
  private async hide(auth: AuthContext, target: ReportTarget, id: string, note?: string) {
    const data = { removedAt: new Date(), removedById: auth.userId };
    if (target === ReportTarget.POST) await this.prisma.communityPost.update({ where: { id }, data });
    else if (target === ReportTarget.COMMENT) await this.prisma.postComment.update({ where: { id }, data });
    else await this.prisma.chatMessage.update({ where: { id }, data });
    await this.prisma.contentReport.updateMany({
      where: { groupId: auth.groupId, target, targetId: id, status: ReportStatus.OPEN },
      data: { status: ReportStatus.REMOVED, reviewedById: auth.userId, reviewedAt: new Date(), note },
    });
  }

  private async removedNotice(auth: AuthContext, author: UserCardRow, what: string, target: ReportTarget, id: string, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: author.id }, select: { email: true, isActive: true } });
    if (user?.isActive) {
      await this.mail.send({
        to: user.email,
        subject: 'Your post was removed from the HR portal',
        text: `A moderator removed your ${what} under POL-20 Community Page, Chat and Copyright Guidelines.${note ? `\nModerator's note: ${note}` : ''}\n\nContact HR if you have questions.`,
      });
    }
    await this.audit.record(auth, { action: 'moderation.remove', targetType: TABLE[target], targetId: id, legalEntityId: companyOf(author), detail: { note: note ?? null } });
  }

  // ---------- reports and moderation (POL-20 3.7) ----------

  /** The content behind a report, within the caller's group */
  private async content(groupId: string, target: ReportTarget, id: string) {
    const author = { select: userCardSelect() };
    if (target === ReportTarget.POST) {
      const p = await this.prisma.communityPost.findFirst({ where: { id, groupId }, include: { author } });
      return p && { authorId: p.authorId, author: p.author, body: p.body, removedAt: p.removedAt, where: 'Community post', conversationId: null };
    }
    if (target === ReportTarget.COMMENT) {
      const c = await this.prisma.postComment.findFirst({ where: { id, post: { groupId } }, include: { author } });
      return c && { authorId: c.authorId, author: c.author, body: c.body, removedAt: c.removedAt, where: 'Comment on a community post', conversationId: null };
    }
    const m = await this.prisma.chatMessage.findFirst({ where: { id, conversation: { groupId } }, include: { sender: author, conversation: { select: { kind: true, name: true } } } });
    return m && { authorId: m.senderId, author: m.sender, body: m.body, removedAt: m.removedAt, where: m.conversation.kind === 'GROUP' ? `Group chat "${m.conversation.name}"` : 'Direct chat', conversationId: m.conversationId };
  }

  /** Active HR users whose people.manage covers the company (or the whole group, for authors with no company) */
  private async moderatorEmails(auth: AuthContext, legalEntityId: string | null) {
    const roles = (Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>).filter((r) => ROLE_PERMISSIONS[r].includes('people.manage'));
    const rows = await this.prisma.roleAssignment.findMany({
      where: { role: { in: roles }, user: { groupId: auth.groupId, isActive: true } },
      select: { role: true, scopeType: true, countryCode: true, legalEntityId: true, user: { select: { email: true } } },
    });
    const covers = (r: RoleAssignmentLike) => (legalEntityId ? entitiesInScope(r, auth.entities).includes(legalEntityId) : r.scopeType === 'GROUP');
    return [...new Set(rows.filter((r) => covers(r as RoleAssignmentLike)).map((r) => r.user.email))];
  }

  async report(auth: AuthContext, dto: ReportDto) {
    const c = await this.content(auth.groupId, dto.target, dto.targetId);
    if (!c || c.removedAt) throw new NotFoundException('Nothing to report');
    if (c.conversationId) {
      const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: c.conversationId, userId: auth.userId } } });
      if (!member) throw new NotFoundException('Nothing to report');
    }
    if (c.authorId === auth.userId) throw new BadRequestException('You cannot report your own message');
    const legalEntityId = companyOf(c.author);
    await this.prisma.contentReport.upsert({
      where: { target_targetId_reporterId: { target: dto.target, targetId: dto.targetId, reporterId: auth.userId } },
      create: { groupId: auth.groupId, target: dto.target, targetId: dto.targetId, legalEntityId, reporterId: auth.userId, reason: dto.reason },
      update: { reason: dto.reason },
    });
    for (const to of await this.moderatorEmails(auth, legalEntityId)) {
      await this.mail.send({ to, subject: 'Content reported in the HR portal', text: `Someone reported a ${c.where.toLowerCase()}.\nReason: ${dto.reason}\n\nReview it under Moderation within 1 working day (POL-20).` });
    }
    return { reported: true };
  }

  /** Reports on content by staff of the companies the caller moderates */
  private reportScope(auth: AuthContext): Prisma.ContentReportWhereInput {
    const ids = entityIds(auth, 'people.manage');
    const group = !!auth.access.get('people.manage')?.group;
    return { groupId: auth.groupId, OR: [{ legalEntityId: { in: ids } }, ...(group ? [{ legalEntityId: null }] : [])] };
  }

  async reports(auth: AuthContext, status: ReportStatus = ReportStatus.OPEN) {
    const rows = await this.prisma.contentReport.findMany({
      where: { ...this.reportScope(auth), status },
      orderBy: { createdAt: status === ReportStatus.OPEN ? 'asc' : 'desc' },
      take: 100,
      include: { reporter: { select: userCardSelect() } },
    });
    return Promise.all(
      rows.map(async (r) => {
        const c = await this.content(auth.groupId, r.target, r.targetId);
        return {
          id: r.id,
          target: r.target,
          targetId: r.targetId,
          status: r.status,
          reason: r.reason,
          note: r.note,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
          reporter: userCard(r.reporter),
          where: c?.where ?? 'Deleted',
          author: c ? userCard(c.author) : null,
          body: c?.body ?? null,
          removed: !!c?.removedAt,
        };
      }),
    );
  }

  async openReports(auth: AuthContext) {
    return { count: await this.prisma.contentReport.count({ where: { ...this.reportScope(auth), status: ReportStatus.OPEN } }) };
  }

  async review(auth: AuthContext, id: string, remove: boolean, dto: ReviewDto) {
    const r = await this.prisma.contentReport.findFirst({ where: { id, ...this.reportScope(auth) } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== ReportStatus.OPEN) throw new BadRequestException('This report was already reviewed');
    const c = await this.content(auth.groupId, r.target, r.targetId);
    if (remove) {
      if (c && !c.removedAt) {
        await this.hide(auth, r.target, r.targetId, dto.note);
        await this.removedNotice(auth, c.author, c.where.toLowerCase(), r.target, r.targetId, dto.note);
      } else {
        await this.prisma.contentReport.update({ where: { id }, data: { status: ReportStatus.REMOVED, reviewedById: auth.userId, reviewedAt: new Date(), note: dto.note } });
      }
    } else {
      await this.prisma.contentReport.updateMany({
        where: { groupId: auth.groupId, target: r.target, targetId: r.targetId, status: ReportStatus.OPEN },
        data: { status: ReportStatus.DISMISSED, reviewedById: auth.userId, reviewedAt: new Date(), note: dto.note },
      });
      await this.audit.record(auth, { action: 'moderation.dismiss', targetType: 'content_report', targetId: id, legalEntityId: r.legalEntityId, detail: { target: r.target, targetId: r.targetId } });
    }
    return { status: remove ? ReportStatus.REMOVED : ReportStatus.DISMISSED };
  }
}
