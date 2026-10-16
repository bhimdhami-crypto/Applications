import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationKind, Prisma } from '@prisma/client';
import { AuthContext } from '../access/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { AddMembersDto, MessagesQuery, SendMessageDto, StartChatDto } from './chat.dto';
import { userCard, userCardSelect } from './users';

const PAGE = 50;

/** Portal accounts that can chat: active, and either still employed or with no employee record (group office) */
const chattable = (groupId: string): Prisma.UserWhereInput => ({
  groupId,
  isActive: true,
  OR: [{ employment: { none: {} } }, { employment: { some: { status: 'ACTIVE' } } }],
});

/**
 * Direct and group chats between colleagues in the same group of companies, carried over from the
 * first build. Messages are company records: deleting hides a message but keeps it (POL-20 3.10).
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** People to chat with: everyone in the group with an active portal account */
  async people(auth: AuthContext, q?: string) {
    const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const users = await this.prisma.user.findMany({
      where: {
        ...chattable(auth.groupId),
        id: { not: auth.userId },
        AND: words.map((w) => ({
          OR: [
            { displayName: { contains: w, mode: 'insensitive' as const } },
            { employment: { some: { person: { firstName: { contains: w, mode: 'insensitive' as const } } } } },
            { employment: { some: { person: { lastName: { contains: w, mode: 'insensitive' as const } } } } },
            { employment: { some: { assignments: { some: { effectiveTo: null, jobTitle: { contains: w, mode: 'insensitive' as const } } } } } },
          ],
        })),
      },
      select: userCardSelect(),
      take: 20,
      orderBy: { displayName: 'asc' },
    });
    return users.map(userCard).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async membership(auth: AuthContext, conversationId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: auth.userId } },
      include: { conversation: true },
    });
    if (!member || member.conversation.groupId !== auth.groupId) throw new NotFoundException('Chat not found');
    return member;
  }

  async conversations(auth: AuthContext) {
    const rows = await this.prisma.conversationMember.findMany({
      where: { userId: auth.userId, conversation: { groupId: auth.groupId } },
      include: {
        conversation: {
          include: {
            members: { where: { leftAt: null }, select: { user: { select: userCardSelect() } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: userCardSelect() } } },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
    });
    const unread = await this.unreadCounts(auth.userId);
    return rows.map(({ conversation: c, leftAt }) => {
      const people = c.members.map((m) => userCard(m.user));
      const others = people.filter((p) => p.id !== auth.userId);
      const last = c.messages[0];
      return {
        id: c.id,
        kind: c.kind,
        name: c.kind === ConversationKind.GROUP ? c.name! : others[0]?.name ?? 'Former colleague',
        members: people,
        left: !!leftAt,
        lastMessageAt: c.lastMessageAt,
        preview: last ? { from: last.senderId === auth.userId ? 'You' : userCard(last.sender).name.split(' ')[0], text: last.removedAt ? 'Message removed' : last.body.slice(0, 120) } : null,
        unread: unread.get(c.id) ?? 0,
      };
    });
  }

  private async unreadCounts(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ conversation_id: string; n: bigint }>>(Prisma.sql`
      SELECT m.conversation_id, COUNT(*) AS n
      FROM conversation_member cm
      JOIN chat_message m ON m.conversation_id = cm.conversation_id
      WHERE cm.user_id = ${userId} AND cm.left_at IS NULL
        AND m.created_at > cm.last_read_at AND m.sender_id <> ${userId} AND m.removed_at IS NULL
      GROUP BY m.conversation_id`);
    return new Map(rows.map((r) => [r.conversation_id, Number(r.n)]));
  }

  async unread(auth: AuthContext) {
    const counts = await this.unreadCounts(auth.userId);
    return { count: [...counts.values()].reduce((s, n) => s + n, 0) };
  }

  private async activeUsers(auth: AuthContext, ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { ...chattable(auth.groupId), id: { in: ids } }, select: { id: true } });
    if (users.length !== new Set(ids).size) throw new BadRequestException('Some of those people cannot be added');
    return users.map((u) => u.id);
  }

  /** Opens the direct chat with one person (creating it once), or starts a named group */
  async start(auth: AuthContext, dto: StartChatDto) {
    const ids = [...new Set(dto.userIds.filter((id) => id !== auth.userId))];
    if (ids.length === 0) throw new BadRequestException('Choose at least one other person');
    await this.activeUsers(auth, ids);
    if (ids.length === 1 && !dto.name) {
      const directKey = [auth.userId, ids[0]].sort().join(':');
      const existing = await this.prisma.conversation.findUnique({ where: { directKey } });
      if (existing) return { id: existing.id };
      try {
        const c = await this.prisma.conversation.create({
          data: { groupId: auth.groupId, kind: ConversationKind.DIRECT, directKey, createdById: auth.userId, members: { create: [{ userId: auth.userId }, { userId: ids[0] }] } },
        });
        return { id: c.id };
      } catch (err) {
        // Both people opened the chat at the same moment
        if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') return { id: (await this.prisma.conversation.findUniqueOrThrow({ where: { directKey } })).id };
        throw err;
      }
    }
    if (!dto.name) throw new BadRequestException('Give the group a name');
    const c = await this.prisma.conversation.create({
      data: { groupId: auth.groupId, kind: ConversationKind.GROUP, name: dto.name, createdById: auth.userId, members: { create: [auth.userId, ...ids].map((userId) => ({ userId })) } },
    });
    return { id: c.id };
  }

  /** Newest page of messages, or older ones (before) or newer ones (after). Reading marks the chat read. */
  async messages(auth: AuthContext, conversationId: string, q: MessagesQuery) {
    const member = await this.membership(auth, conversationId);
    const cursor = q.after ?? q.before;
    const pivot = cursor ? await this.prisma.chatMessage.findFirst({ where: { id: cursor, conversationId } }) : null;
    if (cursor && !pivot) throw new NotFoundException('Message not found');
    const where: Prisma.ChatMessageWhereInput = {
      conversationId,
      // A member who left keeps what was said before they left
      ...(member.leftAt ? { createdAt: { lte: member.leftAt } } : {}),
    };
    const include = { sender: { select: userCardSelect() } };
    const rows = q.after
      ? await this.prisma.chatMessage.findMany({ where: { ...where, AND: [{ createdAt: { gt: pivot!.createdAt } }] }, orderBy: { createdAt: 'asc' }, take: PAGE, include })
      : (
          await this.prisma.chatMessage.findMany({
            where: { ...where, ...(pivot ? { AND: [{ createdAt: { lt: pivot.createdAt } }] } : {}) },
            orderBy: { createdAt: 'desc' },
            take: PAGE,
            include,
          })
        ).reverse();
    if (!member.leftAt && !q.before) {
      await this.prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: new Date() } });
    }
    return {
      messages: rows.map((m) => ({
        id: m.id,
        sender: userCard(m.sender),
        mine: m.senderId === auth.userId,
        body: m.removedAt ? null : m.body,
        removed: m.removedAt ? (m.removedById === m.senderId ? 'Deleted by the sender' : 'Removed by a moderator') : null,
        createdAt: m.createdAt,
      })),
      hasOlder: !q.after && rows.length === PAGE,
    };
  }

  async send(auth: AuthContext, conversationId: string, dto: SendMessageDto) {
    const member = await this.membership(auth, conversationId);
    if (member.leftAt) throw new ForbiddenException('You left this group');
    if (member.conversation.kind === ConversationKind.DIRECT) {
      const other = await this.prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: auth.userId } }, select: { userId: true } });
      const reachable = other && (await this.prisma.user.count({ where: { ...chattable(auth.groupId), id: other.userId } }));
      if (!reachable) throw new BadRequestException('This person no longer has a portal account');
    }
    const now = new Date();
    const [msg] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({ data: { conversationId, senderId: auth.userId, body: dto.body, createdAt: now }, include: { sender: { select: userCardSelect() } } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
      this.prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: now } }),
    ]);
    return { id: msg.id, sender: userCard(msg.sender), mine: true, body: msg.body, removed: null, createdAt: msg.createdAt };
  }

  async addMembers(auth: AuthContext, conversationId: string, dto: AddMembersDto) {
    const member = await this.membership(auth, conversationId);
    if (member.conversation.kind !== ConversationKind.GROUP) throw new BadRequestException('People can only be added to groups');
    if (member.leftAt) throw new ForbiddenException('You left this group');
    const ids = await this.activeUsers(auth, [...new Set(dto.userIds)]);
    for (const userId of ids) {
      await this.prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId },
        update: { leftAt: null, joinedAt: new Date() },
      });
    }
    return { added: ids.length };
  }

  async leave(auth: AuthContext, conversationId: string) {
    const member = await this.membership(auth, conversationId);
    if (member.conversation.kind !== ConversationKind.GROUP) throw new BadRequestException('You can only leave groups');
    await this.prisma.conversationMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
    return { left: true };
  }

  /** The sender hides their own message. It stays in the records (POL-20 3.10). */
  async deleteMessage(auth: AuthContext, id: string) {
    const { count } = await this.prisma.chatMessage.updateMany({ where: { id, senderId: auth.userId, removedAt: null }, data: { removedAt: new Date(), removedById: auth.userId } });
    if (count === 0) throw new NotFoundException('Message not found');
    return { removed: true };
  }
}
