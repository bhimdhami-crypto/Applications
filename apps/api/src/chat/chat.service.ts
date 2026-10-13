import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationKind, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AddMembersDto, MessagesQuery, SendMessageDto, StartChatDto } from './chat.dto';
import { USER_CARD, userCard } from './users';

const PAGE = 50;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** People to chat with: everyone with an active login */
  async people(actor: AuthUser, q?: string) {
    const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: actor.id },
        OR: [{ employee: null }, { employee: { deletedAt: null, status: 'ACTIVE' } }],
        AND: words.map((w) => ({
          OR: [
            { employee: { firstName: { contains: w, mode: 'insensitive' as const } } },
            { employee: { lastName: { contains: w, mode: 'insensitive' as const } } },
            { employee: { jobTitle: { contains: w, mode: 'insensitive' as const } } },
          ],
        })),
      },
      select: USER_CARD,
      take: 20,
      orderBy: { email: 'asc' },
    });
    return users.map(userCard).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async membership(actor: AuthUser, conversationId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      include: { conversation: true },
    });
    if (!member) throw new NotFoundException('Chat not found');
    return member;
  }

  async conversations(actor: AuthUser) {
    const rows = await this.prisma.conversationMember.findMany({
      where: { userId: actor.id },
      include: {
        conversation: {
          include: {
            members: { where: { leftAt: null }, select: { user: { select: USER_CARD } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: USER_CARD } } },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
    });
    const unread = await this.unreadCounts(actor.id);
    return rows.map(({ conversation: c, leftAt }) => {
      const people = c.members.map((m) => userCard(m.user));
      const others = people.filter((p) => p.id !== actor.id);
      const last = c.messages[0];
      return {
        id: c.id,
        kind: c.kind,
        name: c.kind === ConversationKind.GROUP ? c.name : others[0]?.name ?? 'Former colleague',
        members: people,
        left: !!leftAt,
        lastMessageAt: c.lastMessageAt,
        preview: last ? { from: last.senderId === actor.id ? 'You' : userCard(last.sender).name.split(' ')[0], text: last.removedAt ? 'Message removed' : last.body.slice(0, 120) } : null,
        unread: unread.get(c.id) ?? 0,
      };
    });
  }

  private async unreadCounts(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ conversationId: string; n: bigint }>>(Prisma.sql`
      SELECT m."conversationId", COUNT(*) AS n
      FROM "ConversationMember" cm
      JOIN "ChatMessage" m ON m."conversationId" = cm."conversationId"
      WHERE cm."userId" = ${userId} AND cm."leftAt" IS NULL
        AND m."createdAt" > cm."lastReadAt" AND m."senderId" <> ${userId} AND m."removedAt" IS NULL
      GROUP BY m."conversationId"`);
    return new Map(rows.map((r) => [r.conversationId, Number(r.n)]));
  }

  async unread(actor: AuthUser) {
    const counts = await this.unreadCounts(actor.id);
    return { count: [...counts.values()].reduce((s, n) => s + n, 0) };
  }

  private async activeUsers(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    if (users.length !== new Set(ids).size) throw new BadRequestException('Some of those people cannot be added');
    return users.map((u) => u.id);
  }

  /** Opens the direct chat with one person (creating it once), or starts a named group */
  async start(actor: AuthUser, dto: StartChatDto) {
    const ids = [...new Set(dto.userIds.filter((id) => id !== actor.id))];
    if (ids.length === 0) throw new BadRequestException('Choose at least one other person');
    await this.activeUsers(ids);
    if (ids.length === 1 && !dto.name) {
      const directKey = [actor.id, ids[0]].sort().join(':');
      const existing = await this.prisma.conversation.findUnique({ where: { directKey } });
      if (existing) return { id: existing.id };
      try {
        const c = await this.prisma.conversation.create({
          data: { kind: ConversationKind.DIRECT, directKey, createdById: actor.id, members: { create: [{ userId: actor.id }, { userId: ids[0] }] } },
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
      data: { kind: ConversationKind.GROUP, name: dto.name, createdById: actor.id, members: { create: [actor.id, ...ids].map((userId) => ({ userId })) } },
    });
    return { id: c.id };
  }

  /** Newest page of messages, or older ones (before) or newer ones (after). Reading marks the chat read. */
  async messages(actor: AuthUser, conversationId: string, q: MessagesQuery) {
    const member = await this.membership(actor, conversationId);
    const cursor = q.after ?? q.before;
    const pivot = cursor ? await this.prisma.chatMessage.findFirst({ where: { id: cursor, conversationId } }) : null;
    if (cursor && !pivot) throw new NotFoundException('Message not found');
    const where: Prisma.ChatMessageWhereInput = {
      conversationId,
      // A member who left keeps what was said before they left
      ...(member.leftAt ? { createdAt: { lte: member.leftAt } } : {}),
    };
    let rows;
    if (q.after) {
      rows = await this.prisma.chatMessage.findMany({ where: { ...where, AND: [{ createdAt: { gt: pivot!.createdAt } }] }, orderBy: { createdAt: 'asc' }, take: PAGE, include: { sender: { select: USER_CARD } } });
    } else {
      rows = (await this.prisma.chatMessage.findMany({
        where: { ...where, ...(pivot ? { AND: [{ createdAt: { lt: pivot.createdAt } }] } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        include: { sender: { select: USER_CARD } },
      })).reverse();
    }
    if (!member.leftAt && !q.before) {
      await this.prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: new Date() } });
    }
    return {
      messages: rows.map((m) => ({
        id: m.id,
        sender: userCard(m.sender),
        mine: m.senderId === actor.id,
        body: m.removedAt ? null : m.body,
        removed: m.removedAt ? (m.removedById === m.senderId ? 'Deleted by the sender' : 'Removed by a moderator') : null,
        createdAt: m.createdAt,
      })),
      hasOlder: !q.after && rows.length === PAGE,
    };
  }

  async send(actor: AuthUser, conversationId: string, dto: SendMessageDto) {
    const member = await this.membership(actor, conversationId);
    if (member.leftAt) throw new ForbiddenException('You left this group');
    if (member.conversation.kind === ConversationKind.DIRECT) {
      const other = await this.prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: actor.id } }, select: { user: { select: { isActive: true } } } });
      if (!other?.user.isActive) throw new BadRequestException('This person no longer has a portal login');
    }
    const now = new Date();
    const [msg] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({ data: { conversationId, senderId: actor.id, body: dto.body, createdAt: now }, include: { sender: { select: USER_CARD } } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
      this.prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: now } }),
    ]);
    return { id: msg.id, sender: userCard(msg.sender), mine: true, body: msg.body, removed: null, createdAt: msg.createdAt };
  }

  async addMembers(actor: AuthUser, conversationId: string, dto: AddMembersDto) {
    const member = await this.membership(actor, conversationId);
    if (member.conversation.kind !== ConversationKind.GROUP) throw new BadRequestException('People can only be added to groups');
    if (member.leftAt) throw new ForbiddenException('You left this group');
    const ids = await this.activeUsers([...new Set(dto.userIds)]);
    for (const userId of ids) {
      await this.prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId },
        update: { leftAt: null, joinedAt: new Date() },
      });
    }
    return { added: ids.length };
  }

  async leave(actor: AuthUser, conversationId: string) {
    const member = await this.membership(actor, conversationId);
    if (member.conversation.kind !== ConversationKind.GROUP) throw new BadRequestException('You can only leave groups');
    await this.prisma.conversationMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
    return { left: true };
  }

  /** The sender hides their own message. It stays in the records (POL-20 3.10). */
  async deleteMessage(actor: AuthUser, id: string) {
    const { count } = await this.prisma.chatMessage.updateMany({ where: { id, senderId: actor.id, removedAt: null }, data: { removedAt: new Date(), removedById: actor.id } });
    if (count === 0) throw new NotFoundException('Message not found');
    return { removed: true };
  }
}
