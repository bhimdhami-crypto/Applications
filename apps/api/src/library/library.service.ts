import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LibraryKind, Prisma } from '@prisma/client';
import { can } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { entityIds } from '../access/scope';
import { fullName } from '../approvals/people';
import { AuditService } from '../audit/audit.service';
import { detectFileKind, StorageService } from '../common/storage.service';
import { MailService } from '../mail/mail.service';
import { UploadedFileLike } from '../people/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto, LibraryQuery, NewVersionDto, UpdateItemDto } from './library.dto';

export const MAX_PDF = 20 * 1024 * 1024;

/** Staff who should confirm policies: active employments in the given companies */
const staffWhere = (legalEntityIds: string[]): Prisma.EmploymentWhereInput => ({ status: 'ACTIVE', legalEntityId: { in: legalEntityIds } });

/**
 * The Policy Centre carried over from the first build: the group's policies to read and confirm,
 * and HR forms to download. Group HR administrators publish; country HR sees who has read what
 * in their own companies and sends reminders.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private editor(auth: AuthContext) {
    return can(auth.access, 'policies.manage');
  }

  private async ownIds(auth: AuthContext) {
    return (await this.prisma.employment.findMany({ where: { userId: auth.userId, legalEntity: { groupId: auth.groupId } }, select: { id: true } })).map((e) => e.id);
  }

  /** Policies and forms, with whether the signed-in person has confirmed the current version */
  async list(auth: AuthContext, q: LibraryQuery) {
    const mine = await this.ownIds(auth);
    const items = await this.prisma.libraryItem.findMany({
      where: { groupId: auth.groupId, ...(q.kind ? { kind: q.kind } : {}), ...(this.editor(auth) ? {} : { active: true }) },
      orderBy: { code: 'asc' },
      include: { acknowledgements: { where: { employmentId: { in: mine } }, orderBy: { createdAt: 'desc' } } },
    });
    return {
      canEdit: this.editor(auth),
      canReport: entityIds(auth, 'people.read').length > 0,
      items: items.map((i) => {
        const current = i.acknowledgements.find((a) => a.version === i.version);
        return {
          id: i.id,
          kind: i.kind,
          code: i.code,
          title: i.title,
          category: i.category,
          summary: i.summary,
          owner: i.owner,
          version: i.version,
          fileName: i.fileName,
          mustRead: i.kind === LibraryKind.POLICY && i.mustRead,
          active: i.active,
          publishedAt: i.publishedAt,
          readAt: current?.createdAt ?? null,
          /** Read an earlier version, not this one */
          readEarlier: !current && i.acknowledgements.length > 0,
        };
      }),
    };
  }

  /** How many must-read policies the signed-in person has not confirmed yet */
  async pending(auth: AuthContext) {
    const mine = await this.ownIds(auth);
    if (!mine.length) return { count: 0 };
    const items = await this.prisma.libraryItem.findMany({
      where: { groupId: auth.groupId, kind: LibraryKind.POLICY, mustRead: true, active: true },
      select: { version: true, acknowledgements: { where: { employmentId: { in: mine } }, select: { version: true } } },
    });
    return { count: items.filter((i) => !i.acknowledgements.some((a) => a.version === i.version)).length };
  }

  private async find(auth: AuthContext, id: string) {
    const item = await this.prisma.libraryItem.findFirst({ where: { id, groupId: auth.groupId } });
    if (!item || (!item.active && !this.editor(auth))) throw new NotFoundException('Document not found');
    return item;
  }

  async file(auth: AuthContext, id: string) {
    const item = await this.find(auth, id);
    const data = await this.storage.get(item.fileKey);
    if (!data) throw new NotFoundException('The file is missing from storage');
    return { data, fileName: item.fileName };
  }

  async acknowledge(auth: AuthContext, id: string) {
    const mine = await this.ownIds(auth);
    if (!mine.length) throw new BadRequestException('Only employees confirm policies');
    const item = await this.find(auth, id);
    if (!item.active) throw new NotFoundException('Policy not found');
    if (item.kind !== LibraryKind.POLICY) throw new BadRequestException('Forms do not need confirming');
    await this.prisma.policyAcknowledgement.createMany({ data: mine.map((employmentId) => ({ itemId: id, version: item.version, employmentId })), skipDuplicates: true });
    const ack = await this.prisma.policyAcknowledgement.findFirstOrThrow({ where: { itemId: id, version: item.version, employmentId: { in: mine } }, orderBy: { createdAt: 'asc' } });
    await this.audit.record(auth, { action: 'policy.read.confirmed', targetType: 'library_item', targetId: id, detail: { code: item.code, version: item.version } });
    return { readAt: ack.createdAt, version: item.version };
  }

  private async storeFile(groupId: string, code: string, version: string, file?: UploadedFileLike) {
    if (!file) throw new BadRequestException('Attach the PDF');
    if (file.size > MAX_PDF) throw new BadRequestException('The PDF must be 20 MB or smaller');
    if (detectFileKind(file.buffer) !== 'pdf') throw new BadRequestException('Only PDF files can be published');
    const key = `library/${groupId}/${code}/v${version}-${Date.now()}.pdf`;
    await this.storage.put(key, file.buffer);
    return key;
  }

  async create(auth: AuthContext, dto: CreateItemDto, file?: UploadedFileLike) {
    if (await this.prisma.libraryItem.findUnique({ where: { groupId_code: { groupId: auth.groupId, code: dto.code } } })) throw new ConflictException(`${dto.code} already exists`);
    if ((dto.kind === LibraryKind.POLICY) !== dto.code.startsWith('POL-')) throw new BadRequestException('Policies use POL- codes and forms use HR-F codes');
    const fileKey = await this.storeFile(auth.groupId, dto.code, dto.version, file);
    const item = await this.prisma.libraryItem.create({
      data: { ...dto, groupId: auth.groupId, mustRead: dto.kind === LibraryKind.POLICY && (dto.mustRead ?? true), fileKey, fileName: `${dto.code} ${dto.title}.pdf`, updatedById: auth.userId },
    });
    await this.audit.record(auth, { action: 'library.created', targetType: 'library_item', targetId: item.id, detail: { code: item.code, version: item.version } });
    return item;
  }

  /** Publishes a new version. Unless told otherwise, everyone must confirm it again. */
  async newVersion(auth: AuthContext, id: string, dto: NewVersionDto, file?: UploadedFileLike) {
    const item = await this.find(auth, id);
    if (dto.version === item.version) throw new BadRequestException(`Version ${item.version} is already published; give the new one a higher number`);
    const fileKey = await this.storeFile(auth.groupId, item.code, dto.version, file);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.keepAcknowledgements) await tx.policyAcknowledgement.updateMany({ where: { itemId: id, version: item.version }, data: { version: dto.version } });
      const row = await tx.libraryItem.update({ where: { id }, data: { version: dto.version, fileKey, publishedAt: new Date(), updatedById: auth.userId } });
      await this.audit.record(auth, { action: 'library.version.published', targetType: 'library_item', targetId: id, detail: { code: item.code, from: item.version, to: dto.version, keptConfirmations: !!dto.keepAcknowledgements } }, tx);
      return row;
    });
    return updated;
  }

  async update(auth: AuthContext, id: string, dto: UpdateItemDto) {
    await this.find(auth, id);
    const updated = await this.prisma.libraryItem.update({ where: { id }, data: { ...dto, updatedById: auth.userId } });
    await this.audit.record(auth, { action: 'library.updated', targetType: 'library_item', targetId: id, detail: { ...dto } as Prisma.InputJsonValue });
    return updated;
  }

  /** Companies in the caller's people.read scope, or the one asked for (404 outside it) */
  private scope(auth: AuthContext, entityId?: string) {
    const allowed = entityIds(auth, 'people.read');
    if (entityId && !allowed.includes(entityId)) throw new NotFoundException('Company not found');
    return entityId ? [entityId] : allowed;
  }

  /** Who has confirmed a policy's current version, per company in the caller's scope, and who has not */
  async report(auth: AuthContext, id: string, entityId?: string) {
    const item = await this.find(auth, id);
    const ids = this.scope(auth, entityId);
    const [staff, read, entities] = await Promise.all([
      this.prisma.employment.groupBy({ by: ['legalEntityId'], where: staffWhere(ids), _count: { _all: true } }),
      this.prisma.employment.groupBy({ by: ['legalEntityId'], where: { ...staffWhere(ids), policyAcknowledgements: { some: { itemId: id, version: item.version } } }, _count: { _all: true } }),
      this.prisma.legalEntity.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }),
    ]);
    const readBy = new Map(read.map((r) => [r.legalEntityId, r._count._all]));
    const staffBy = new Map(staff.map((r) => [r.legalEntityId, r._count._all]));
    const perCompany = entities
      .map((e) => ({ entityId: e.id, code: e.code, name: e.name, staff: staffBy.get(e.id) ?? 0, read: readBy.get(e.id) ?? 0 }))
      .sort((a, b) => a.code.localeCompare(b.code));
    const notRead = await this.prisma.employment.findMany({
      where: { ...staffWhere(ids), policyAcknowledgements: { none: { itemId: id, version: item.version } } },
      select: { id: true, employeeNumber: true, userId: true, person: { select: { firstName: true, lastName: true } }, legalEntity: { select: { code: true } } },
      orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }],
      take: 100,
    });
    return {
      item: { id: item.id, code: item.code, title: item.title, version: item.version },
      perCompany,
      notRead: notRead.map((e) => ({ id: e.id, name: fullName(e.person), employeeNumber: e.employeeNumber, entityCode: e.legalEntity.code, hasLogin: !!e.userId })),
    };
  }

  /** Emails everyone with a portal account, in the caller's people.manage scope, who has not confirmed the current version */
  async remind(auth: AuthContext, id: string, entityId?: string) {
    const item = await this.find(auth, id);
    if (item.kind !== LibraryKind.POLICY || !item.active) throw new NotFoundException('Policy not found');
    const allowed = entityIds(auth, 'people.manage');
    if (entityId && !allowed.includes(entityId)) throw new NotFoundException('Company not found');
    const ids = entityId ? [entityId] : allowed;
    const people = await this.prisma.employment.findMany({
      where: { ...staffWhere(ids), user: { isActive: true }, policyAcknowledgements: { none: { itemId: id, version: item.version } } },
      select: { person: { select: { firstName: true } }, user: { select: { email: true } } },
    });
    const emails = new Map(people.map((p) => [p.user!.email, p.person.firstName]));
    for (const [to, firstName] of emails) {
      await this.mail.send({
        to,
        subject: `Please read ${item.code} ${item.title}`,
        text: `Hello ${firstName},\n\nPlease read ${item.code} ${item.title} (version ${item.version}) in the HR portal under Policies and forms, then confirm you have read it.`,
      });
    }
    await this.audit.record(auth, { action: 'policy.reminder.sent', targetType: 'library_item', targetId: id, legalEntityId: entityId ?? null, detail: { sent: emails.size } });
    return { sent: emails.size };
  }
}
