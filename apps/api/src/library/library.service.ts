import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LibraryKind, Prisma, Role } from '@prisma/client';
import { fullName } from '../approvals/people';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadedFileLike } from '../profiles/profiles.service';
import { detectFileKind } from '../storage/file-types';
import { StorageService } from '../storage/storage.service';
import { CreateItemDto, LibraryQuery, NewVersionDto, UpdateItemDto } from './library.dto';

const MAX_PDF = 20 * 1024 * 1024;
const isEditor = (u: AuthUser) => u.role === Role.HR || u.role === Role.ADMIN;

/** Staff still to confirm a policy: active, signed-in employees of the company */
const staffWhere = (companyId?: string): Prisma.EmployeeWhereInput => ({
  deletedAt: null,
  status: 'ACTIVE',
  ...(companyId ? { companyId } : {}),
});

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Policies and forms, with whether the signed-in employee has read the current version */
  async list(actor: AuthUser, q: LibraryQuery) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    const items = await this.prisma.libraryItem.findMany({
      where: { ...(q.kind ? { kind: q.kind } : {}), ...(isEditor(actor) ? {} : { active: true }) },
      orderBy: { code: 'asc' },
      include: me ? { acknowledgements: { where: { employeeId: me.id }, orderBy: { createdAt: 'desc' } } } : undefined,
    });
    return items.map((i) => {
      const acks = (i as typeof i & { acknowledgements?: Array<{ version: string; createdAt: Date }> }).acknowledgements ?? [];
      const current = acks.find((a) => a.version === i.version);
      return {
        id: i.id, kind: i.kind, code: i.code, title: i.title, category: i.category, summary: i.summary, owner: i.owner,
        version: i.version, fileName: i.fileName, mustRead: i.kind === LibraryKind.POLICY && i.mustRead, active: i.active,
        publishedAt: i.publishedAt,
        readAt: current?.createdAt ?? null,
        /** Read an earlier version, not this one */
        readEarlier: !current && acks.length > 0,
      };
    });
  }

  /** How many must-read policies the employee has not confirmed yet */
  async pending(actor: AuthUser) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!me) return { count: 0 };
    const items = await this.prisma.libraryItem.findMany({
      where: { kind: LibraryKind.POLICY, mustRead: true, active: true },
      select: { version: true, acknowledgements: { where: { employeeId: me.id }, select: { version: true } } },
    });
    return { count: items.filter((i) => !i.acknowledgements.some((a) => a.version === i.version)).length };
  }

  async file(actor: AuthUser, id: string) {
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item || (!item.active && !isEditor(actor))) throw new NotFoundException('Document not found');
    const data = await this.storage.get(item.fileKey);
    if (!data) throw new NotFoundException('The file is missing from storage');
    return { data, fileName: item.fileName };
  }

  async acknowledge(actor: AuthUser, id: string) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!me) throw new BadRequestException('Only employees confirm policies');
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item || !item.active) throw new NotFoundException('Policy not found');
    if (item.kind !== LibraryKind.POLICY) throw new BadRequestException('Forms do not need confirming');
    const ack = await this.prisma.policyAcknowledgement.upsert({
      where: { itemId_version_employeeId: { itemId: id, version: item.version, employeeId: me.id } },
      create: { itemId: id, version: item.version, employeeId: me.id },
      update: {},
    });
    return { readAt: ack.createdAt, version: item.version };
  }

  private async storeFile(code: string, version: string, file?: UploadedFileLike) {
    if (!file) throw new BadRequestException('Attach the PDF');
    if (file.size > MAX_PDF) throw new BadRequestException('The PDF must be 20 MB or smaller');
    if (detectFileKind(file.buffer) !== 'pdf') throw new BadRequestException('Only PDF files can be published');
    const key = `library/${code}/v${version}-${Date.now()}.pdf`;
    await this.storage.put(key, file.buffer);
    return key;
  }

  async create(actor: AuthUser, dto: CreateItemDto, file?: UploadedFileLike) {
    if (await this.prisma.libraryItem.findUnique({ where: { code: dto.code } })) throw new ConflictException(`${dto.code} already exists`);
    if ((dto.kind === LibraryKind.POLICY) !== dto.code.startsWith('POL-')) throw new BadRequestException('Policies use POL- codes and forms use HR-F codes');
    const fileKey = await this.storeFile(dto.code, dto.version, file);
    const item = await this.prisma.libraryItem.create({
      data: { ...dto, mustRead: dto.kind === LibraryKind.POLICY && (dto.mustRead ?? true), fileKey, fileName: `${dto.code} ${dto.title}.pdf`, updatedById: actor.id },
    });
    await this.audit.record(actor.id, 'library.create', 'LibraryItem', item.id, { code: item.code, version: item.version });
    return item;
  }

  /** Publishes a new version. Unless told otherwise, everyone must confirm it again. */
  async newVersion(actor: AuthUser, id: string, dto: NewVersionDto, file?: UploadedFileLike) {
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Document not found');
    if (dto.version === item.version) throw new BadRequestException(`Version ${item.version} is already published; give the new one a higher number`);
    const fileKey = await this.storeFile(item.code, dto.version, file);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.keepAcknowledgements) {
        await tx.policyAcknowledgement.updateMany({ where: { itemId: id, version: item.version }, data: { version: dto.version } });
      }
      return tx.libraryItem.update({ where: { id }, data: { version: dto.version, fileKey, publishedAt: new Date(), updatedById: actor.id } });
    });
    await this.audit.record(actor.id, 'library.version', 'LibraryItem', id, { code: item.code, from: item.version, to: dto.version, keptAcknowledgements: !!dto.keepAcknowledgements });
    return updated;
  }

  async update(actor: AuthUser, id: string, dto: UpdateItemDto) {
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Document not found');
    const updated = await this.prisma.libraryItem.update({ where: { id }, data: { ...dto, updatedById: actor.id } });
    await this.audit.record(actor.id, 'library.update', 'LibraryItem', id, { ...dto } as Prisma.InputJsonValue);
    return updated;
  }

  /** Who has confirmed a policy's current version, per company, and who has not */
  async report(id: string, companyId?: string) {
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Document not found');
    const [companies, read] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['companyId'], where: staffWhere(), _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['companyId'], where: { ...staffWhere(), acknowledgements: { some: { itemId: id, version: item.version } } }, _count: { _all: true } }),
    ]);
    const names = new Map((await this.prisma.company.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const readBy = new Map(read.map((r) => [r.companyId, r._count._all]));
    const perCompany = companies
      .map((c) => ({ companyId: c.companyId, company: names.get(c.companyId) ?? '', staff: c._count._all, read: readBy.get(c.companyId) ?? 0 }))
      .sort((a, b) => a.company.localeCompare(b.company));
    const notRead = await this.prisma.employee.findMany({
      where: { ...staffWhere(companyId), acknowledgements: { none: { itemId: id, version: item.version } } },
      select: { id: true, firstName: true, lastName: true, employeeNo: true, userId: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 100,
    });
    return {
      item: { id: item.id, code: item.code, title: item.title, version: item.version },
      perCompany,
      notRead: notRead.map((e) => ({ id: e.id, name: fullName(e), employeeNo: e.employeeNo, hasLogin: !!e.userId })),
    };
  }

  /** Emails everyone with a login who has not confirmed the current version */
  async remind(actor: AuthUser, id: string, companyId?: string) {
    const item = await this.prisma.libraryItem.findUnique({ where: { id } });
    if (!item || item.kind !== LibraryKind.POLICY) throw new NotFoundException('Policy not found');
    const people = await this.prisma.employee.findMany({
      where: { ...staffWhere(companyId), user: { isActive: true }, acknowledgements: { none: { itemId: id, version: item.version } } },
      select: { firstName: true, user: { select: { email: true } } },
    });
    for (const p of people) {
      await this.mail.send({
        to: p.user!.email,
        subject: `Please read ${item.code} ${item.title}`,
        text: `Hello ${p.firstName},\n\nPlease read ${item.code} ${item.title} (version ${item.version}) in the HR portal under Policies and forms, then confirm you have read it.`,
      });
    }
    await this.audit.record(actor.id, 'library.remind', 'LibraryItem', id, { companyId: companyId ?? null, sent: people.length });
    return { sent: people.length };
  }
}
