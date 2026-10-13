import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportStatus, ReportTarget, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { USER_CARD, userCard } from '../chat/users';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadedFileLike } from '../profiles/profiles.service';
import { detectFileKind, FILE_TYPES } from '../storage/file-types';
import { StorageService } from '../storage/storage.service';
import { CommentDto, CreatePostDto, ReportDto, ReviewDto } from './community.dto';

const PAGE = 20;
const MB = 1024 * 1024;
/** Largest file of each kind; videos may be bigger than photos and PDFs */
const MAX_BYTES = { png: 10 * MB, jpeg: 10 * MB, webp: 10 * MB, pdf: 10 * MB, mp4: 50 * MB } as const;
export const MAX_FILES = 4;

interface Attachment {
  mime: string;
  name: string;
  size: number;
  ext: string;
}

export const isModerator = (u: AuthUser) => u.role === Role.HR || u.role === Role.ADMIN;
const fileKey = (postId: string, index: number, ext: string) => `community/${postId}/${index}.${ext}`;

const POST_INCLUDE = {
  author: { select: USER_CARD },
  _count: { select: { likes: true } },
  comments: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: USER_CARD } } },
} satisfies Prisma.CommunityPostInclude;

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private present(actor: AuthUser, p: Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>, liked: Set<string>) {
    const removed = !!p.removedAt;
    return {
      id: p.id,
      author: userCard(p.author),
      mine: p.authorId === actor.id,
      body: removed ? null : p.body,
      removed: removed ? (p.removedById === p.authorId ? 'Deleted by the author' : 'Removed by a moderator') : null,
      attachments: removed ? [] : (p.attachments as unknown as Attachment[]).map((a, i) => ({ index: i, mime: a.mime, name: a.name, size: a.size })),
      likes: p._count.likes,
      liked: liked.has(p.id),
      createdAt: p.createdAt,
      comments: p.comments.map((c) => ({
        id: c.id,
        author: userCard(c.author),
        mine: c.authorId === actor.id,
        body: c.removedAt ? null : c.body,
        removed: c.removedAt ? (c.removedById === c.authorId ? 'Deleted by the author' : 'Removed by a moderator') : null,
        createdAt: c.createdAt,
      })),
    };
  }

  async feed(actor: AuthUser, before?: string) {
    const pivot = before ? await this.prisma.communityPost.findUnique({ where: { id: before } }) : null;
    const posts = await this.prisma.communityPost.findMany({
      where: {
        ...(pivot ? { createdAt: { lt: pivot.createdAt } } : {}),
        // Posts removed by their author disappear; moderator removals stay as a marker
        NOT: { removedAt: { not: null }, removedById: { equals: this.prisma.communityPost.fields.authorId } },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE,
      include: POST_INCLUDE,
    });
    const liked = new Set(
      (await this.prisma.postLike.findMany({ where: { userId: actor.id, postId: { in: posts.map((p) => p.id) } }, select: { postId: true } })).map((l) => l.postId),
    );
    return { posts: posts.map((p) => this.present(actor, p, liked)), hasMore: posts.length === PAGE };
  }

  async create(actor: AuthUser, dto: CreatePostDto, files: UploadedFileLike[] = []) {
    if (files.length > MAX_FILES) throw new BadRequestException(`Attach at most ${MAX_FILES} files`);
    if (files.length && !dto.filesConfirmed) throw new BadRequestException('Confirm you created the files or have permission to share them');
    const checked = files.map((f) => {
      const kind = detectFileKind(f.buffer);
      if (!kind) throw new BadRequestException(`${f.originalname}: only photos (PNG, JPEG, WebP), MP4 videos and PDFs can be shared`);
      if (f.size > MAX_BYTES[kind]) throw new BadRequestException(`${f.originalname} is too large (${kind === 'mp4' ? 'videos up to 50 MB' : 'up to 10 MB'})`);
      return { file: f, kind };
    });
    const post = await this.prisma.communityPost.create({ data: { authorId: actor.id, body: dto.body } });
    const attachments: Attachment[] = [];
    for (const [i, { file, kind }] of checked.entries()) {
      const { mime, ext } = FILE_TYPES[kind];
      await this.storage.put(fileKey(post.id, i, ext), file.buffer);
      attachments.push({ mime, ext, name: file.originalname.slice(0, 120), size: file.size });
    }
    const saved = await this.prisma.communityPost.update({ where: { id: post.id }, data: { attachments: attachments as unknown as Prisma.InputJsonValue }, include: POST_INCLUDE });
    return this.present(actor, saved, new Set());
  }

  async file(postId: string, index: number) {
    const post = await this.prisma.communityPost.findUnique({ where: { id: postId } });
    const a = (post?.attachments as unknown as Attachment[] | undefined)?.[index];
    if (!post || post.removedAt || !a) throw new NotFoundException('File not found');
    const data = await this.storage.get(fileKey(postId, index, a.ext));
    if (!data) throw new NotFoundException('File not found');
    return { data, mime: a.mime, name: a.name };
  }

  async like(actor: AuthUser, postId: string, on: boolean) {
    const post = await this.prisma.communityPost.findUnique({ where: { id: postId } });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    if (on) await this.prisma.postLike.upsert({ where: { postId_userId: { postId, userId: actor.id } }, create: { postId, userId: actor.id }, update: {} });
    else await this.prisma.postLike.deleteMany({ where: { postId, userId: actor.id } });
    return { liked: on, likes: await this.prisma.postLike.count({ where: { postId } }) };
  }

  async comment(actor: AuthUser, postId: string, dto: CommentDto) {
    const post = await this.prisma.communityPost.findUnique({ where: { id: postId } });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    const c = await this.prisma.postComment.create({ data: { postId, authorId: actor.id, body: dto.body }, include: { author: { select: USER_CARD } } });
    return { id: c.id, author: userCard(c.author), mine: true, body: c.body, removed: null, createdAt: c.createdAt };
  }

  /** Authors delete their own posts and comments; moderators remove anyone's */
  async removePost(actor: AuthUser, id: string) {
    const post = await this.prisma.communityPost.findUnique({ where: { id } });
    if (!post || post.removedAt) throw new NotFoundException('Post not found');
    if (post.authorId !== actor.id && !isModerator(actor)) throw new ForbiddenException('You can only delete your own posts');
    await this.hide(actor, ReportTarget.POST, id);
    return { removed: true };
  }

  async removeComment(actor: AuthUser, id: string) {
    const c = await this.prisma.postComment.findUnique({ where: { id } });
    if (!c || c.removedAt) throw new NotFoundException('Comment not found');
    if (c.authorId !== actor.id && !isModerator(actor)) throw new ForbiddenException('You can only delete your own comments');
    await this.hide(actor, ReportTarget.COMMENT, id);
    return { removed: true };
  }

  /** Hides content but keeps it in the records (POL-20 3.10); closes open reports on it */
  private async hide(actor: AuthUser, target: ReportTarget, id: string, note?: string) {
    const data = { removedAt: new Date(), removedById: actor.id };
    if (target === ReportTarget.POST) await this.prisma.communityPost.update({ where: { id }, data });
    else if (target === ReportTarget.COMMENT) await this.prisma.postComment.update({ where: { id }, data });
    else await this.prisma.chatMessage.update({ where: { id }, data });
    await this.prisma.contentReport.updateMany({
      where: { target, targetId: id, status: ReportStatus.OPEN },
      data: { status: ReportStatus.REMOVED, reviewedById: actor.id, reviewedAt: new Date(), note },
    });
  }

  // ---------- reports and moderation (POL-20 3.7) ----------

  /** The content behind a report, if the reporter is allowed to see it */
  private async content(target: ReportTarget, id: string) {
    if (target === ReportTarget.POST) {
      const p = await this.prisma.communityPost.findUnique({ where: { id }, include: { author: { select: { ...USER_CARD, email: true } } } });
      return p && { authorId: p.authorId, author: p.author, body: p.body, removedAt: p.removedAt, where: 'Community post', conversationId: null };
    }
    if (target === ReportTarget.COMMENT) {
      const c = await this.prisma.postComment.findUnique({ where: { id }, include: { author: { select: { ...USER_CARD, email: true } } } });
      return c && { authorId: c.authorId, author: c.author, body: c.body, removedAt: c.removedAt, where: 'Comment on a community post', conversationId: null };
    }
    const m = await this.prisma.chatMessage.findUnique({ where: { id }, include: { sender: { select: { ...USER_CARD, email: true } }, conversation: { select: { kind: true, name: true } } } });
    return m && { authorId: m.senderId, author: m.sender, body: m.body, removedAt: m.removedAt, where: m.conversation.kind === 'GROUP' ? `Group chat "${m.conversation.name}"` : 'Direct chat', conversationId: m.conversationId };
  }

  async report(actor: AuthUser, dto: ReportDto) {
    const c = await this.content(dto.target, dto.targetId);
    if (!c || c.removedAt) throw new NotFoundException('Nothing to report');
    if (c.conversationId) {
      const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: c.conversationId, userId: actor.id } } });
      if (!member) throw new NotFoundException('Nothing to report');
    }
    if (c.authorId === actor.id) throw new BadRequestException('You cannot report your own message');
    await this.prisma.contentReport.upsert({
      where: { target_targetId_reporterId: { target: dto.target, targetId: dto.targetId, reporterId: actor.id } },
      create: { target: dto.target, targetId: dto.targetId, reporterId: actor.id, reason: dto.reason },
      update: { reason: dto.reason },
    });
    const moderators = await this.prisma.user.findMany({ where: { role: { in: [Role.HR, Role.ADMIN] }, isActive: true }, select: { email: true } });
    for (const m of moderators) {
      await this.mail.send({ to: m.email, subject: 'Content reported in the HR portal', text: `Someone reported a ${c.where.toLowerCase()}.\nReason: ${dto.reason}\n\nReview it under Moderation within 1 working day (POL-20).` });
    }
    return { reported: true };
  }

  async reports(status: ReportStatus = ReportStatus.OPEN) {
    const rows = await this.prisma.contentReport.findMany({
      where: { status },
      orderBy: { createdAt: status === ReportStatus.OPEN ? 'asc' : 'desc' },
      take: 100,
      include: { reporter: { select: USER_CARD } },
    });
    return Promise.all(rows.map(async (r) => {
      const c = await this.content(r.target, r.targetId);
      return {
        id: r.id, target: r.target, targetId: r.targetId, status: r.status, reason: r.reason, note: r.note,
        createdAt: r.createdAt, reviewedAt: r.reviewedAt,
        reporter: userCard(r.reporter),
        where: c?.where ?? 'Deleted',
        author: c ? userCard(c.author) : null,
        body: c?.body ?? null,
        removed: !!c?.removedAt,
      };
    }));
  }

  async review(actor: AuthUser, id: string, remove: boolean, dto: ReviewDto) {
    const r = await this.prisma.contentReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== ReportStatus.OPEN) throw new BadRequestException('This report was already reviewed');
    const c = await this.content(r.target, r.targetId);
    if (remove) {
      if (c && !c.removedAt) await this.hide(actor, r.target, r.targetId, dto.note);
      else await this.prisma.contentReport.update({ where: { id }, data: { status: ReportStatus.REMOVED, reviewedById: actor.id, reviewedAt: new Date(), note: dto.note } });
      if (c) {
        await this.mail.send({
          to: c.author.email,
          subject: 'Your post was removed from the HR portal',
          text: `A moderator removed your ${c.where.toLowerCase()} under POL-20 Community Page, Chat and Copyright Guidelines.${dto.note ? `\nModerator's note: ${dto.note}` : ''}\n\nContact HR if you have questions.`,
        });
      }
    } else {
      await this.prisma.contentReport.updateMany({
        where: { target: r.target, targetId: r.targetId, status: ReportStatus.OPEN },
        data: { status: ReportStatus.DISMISSED, reviewedById: actor.id, reviewedAt: new Date(), note: dto.note },
      });
    }
    await this.audit.record(actor.id, remove ? 'moderation.remove' : 'moderation.dismiss', 'ContentReport', id, { target: r.target, targetId: r.targetId });
    return { status: remove ? ReportStatus.REMOVED : ReportStatus.DISMISSED };
  }

  async openReports() {
    return { count: await this.prisma.contentReport.count({ where: { status: ReportStatus.OPEN } }) };
  }
}
