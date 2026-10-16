import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { can } from '@gpp/shared';
import { randomUUID } from 'crypto';
import { AuthContext } from '../access/auth-context';
import { AuditService } from '../audit/audit.service';
import { detectFileKind, FILE_TYPES, MIME_BY_EXT, StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleAccess } from './people-access.service';
import { DOCUMENT_TYPES, UploadDocumentDto } from './people.dto';

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const date = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

/** Profile photos and the HR document file for each employee */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PeopleAccess,
    private readonly storage: StorageService,
  ) {}

  async list(auth: AuthContext, employmentId: string) {
    const { rel } = await this.access.resolve(auth, employmentId);
    if (!rel.hr && !rel.self) throw new NotFoundException('Employee not found');
    // HR-only documents (background checks and the like) stay hidden from the employee, even one who works in HR
    const hrView = rel.hr && !rel.self;
    const docs = await this.prisma.employeeDocument.findMany({
      where: { employmentId, ...(hrView ? {} : { hrOnly: false }) },
      orderBy: [{ createdAt: 'desc' }, { type: 'asc' }],
    });
    return docs.map(({ storageKey, ...d }) => ({ ...d, hasFile: !!storageKey }));
  }

  async upload(auth: AuthContext, employmentId: string, dto: UploadDocumentDto, file?: UploadedFileLike) {
    const { subject, rel } = await this.access.resolve(auth, employmentId);
    this.access.require(auth, subject, rel, 'people.manage', { allowSelf: true });
    const hrOnly = dto.hrOnly === 'true';
    if (hrOnly && !can(auth.access, 'people.manage', subject.legalEntityId)) throw new ForbiddenException('Only HR can file hidden documents');
    if (!DOCUMENT_TYPES.includes(dto.type)) throw new BadRequestException('Choose a document type from the list');
    if (!file) throw new BadRequestException('Choose a file to upload');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Files must be 10 MB or smaller');
    const kind = detectFileKind(file.buffer);
    if (!kind) throw new BadRequestException('Upload a PDF, PNG, JPEG or WebP file');
    const key = `documents/${subject.legalEntityId}/${employmentId}/${randomUUID()}.${FILE_TYPES[kind].ext}`;
    await this.storage.put(key, file.buffer);
    const safeName = file.originalname.replace(/[^\p{L}\p{N} ._()-]+/gu, '_').slice(0, 120) || `document.${FILE_TYPES[kind].ext}`;
    const doc = await this.prisma.employeeDocument.create({
      data: {
        employmentId,
        legalEntityId: subject.legalEntityId,
        type: dto.type,
        fileName: safeName,
        storageKey: key,
        mimeType: FILE_TYPES[kind].mime,
        sizeBytes: file.size,
        issuedDate: dto.issuedDate ? date(dto.issuedDate) : null,
        expiryDate: dto.expiryDate ? date(dto.expiryDate) : null,
        hrOnly,
        uploadedById: auth.userId,
      },
    });
    await this.audit.record(auth, { action: 'people.document.uploaded', targetType: 'employee_document', targetId: doc.id, legalEntityId: subject.legalEntityId, detail: { type: dto.type, employmentId } });
    const { storageKey, ...rest } = doc;
    return { ...rest, hasFile: true };
  }

  /** Loads a document the caller may see: HR for the company, or the employee unless it is HR-only */
  private async load(auth: AuthContext, docId: string) {
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: docId, employment: { legalEntity: { groupId: auth.groupId } } } });
    if (!doc) throw new NotFoundException('Document not found');
    const { subject, rel } = await this.access.resolve(auth, doc.employmentId).catch(() => {
      throw new NotFoundException('Document not found');
    });
    if (doc.hrOnly ? !(rel.hr && !rel.self) : !(rel.hr || rel.self)) throw new NotFoundException('Document not found');
    return { doc, subject, rel };
  }

  async file(auth: AuthContext, docId: string) {
    const { doc } = await this.load(auth, docId);
    if (!doc.storageKey) throw new NotFoundException('Only the paper copy of this document is held');
    const data = await this.storage.get(doc.storageKey);
    if (!data) throw new NotFoundException('The file is missing from storage');
    await this.audit.record(auth, { action: 'people.document.downloaded', targetType: 'employee_document', targetId: doc.id, legalEntityId: doc.legalEntityId });
    return { data, mime: doc.mimeType ?? 'application/octet-stream', fileName: doc.fileName };
  }

  async setStatus(auth: AuthContext, docId: string, status: DocumentStatus) {
    const { doc, subject, rel } = await this.load(auth, docId);
    this.access.require(auth, subject, rel, 'people.manage');
    if (rel.self) throw new ForbiddenException('Someone else in HR must check your own documents');
    const verified = status === 'VERIFIED' || status === 'CLEARED';
    const updated = await this.prisma.employeeDocument.update({
      where: { id: doc.id },
      data: { status, verifiedById: verified ? auth.userId : null, verifiedAt: verified ? new Date() : null },
    });
    await this.audit.record(auth, { action: 'people.document.status', targetType: 'employee_document', targetId: doc.id, legalEntityId: doc.legalEntityId, detail: { from: doc.status, to: status } });
    const { storageKey, ...rest } = updated;
    return { ...rest, hasFile: !!storageKey };
  }

  async remove(auth: AuthContext, docId: string) {
    const { doc, subject, rel } = await this.load(auth, docId);
    this.access.require(auth, subject, rel, 'people.manage');
    await this.prisma.employeeDocument.delete({ where: { id: doc.id } });
    if (doc.storageKey) await this.storage.remove(doc.storageKey);
    await this.audit.record(auth, { action: 'people.document.deleted', targetType: 'employee_document', targetId: doc.id, legalEntityId: doc.legalEntityId, detail: { type: doc.type, fileName: doc.fileName } });
  }

  // ───── Photos ─────

  async photoFile(photoKey: string) {
    const data = await this.storage.get(photoKey);
    if (!data) return null;
    return { data, mime: MIME_BY_EXT[photoKey.split('.').pop() ?? ''] ?? 'application/octet-stream' };
  }

  async setPhoto(auth: AuthContext, employmentId: string, file?: UploadedFileLike) {
    const { subject, rel } = await this.access.resolve(auth, employmentId);
    this.access.require(auth, subject, rel, 'people.manage', { allowSelf: true });
    if (!file) throw new BadRequestException('Choose a photo to upload');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('The photo must be 5 MB or smaller');
    const kind = detectFileKind(file.buffer);
    if (kind !== 'png' && kind !== 'jpeg' && kind !== 'webp') throw new BadRequestException('The photo must be a PNG, JPEG or WebP image');
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: subject.personId }, select: { photoKey: true } });
    const key = `photos/${subject.personId}-${randomUUID()}.${FILE_TYPES[kind].ext}`;
    await this.storage.put(key, file.buffer);
    await this.prisma.person.update({ where: { id: subject.personId }, data: { photoKey: key } });
    if (person.photoKey) await this.storage.remove(person.photoKey);
    await this.audit.record(auth, { action: 'people.photo.updated', targetType: 'employment', targetId: employmentId, legalEntityId: subject.legalEntityId });
    return { hasPhoto: true };
  }

  async removePhoto(auth: AuthContext, employmentId: string) {
    const { subject, rel } = await this.access.resolve(auth, employmentId);
    this.access.require(auth, subject, rel, 'people.manage', { allowSelf: true });
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: subject.personId }, select: { photoKey: true } });
    if (!person.photoKey) return { hasPhoto: false };
    await this.prisma.person.update({ where: { id: subject.personId }, data: { photoKey: null } });
    await this.storage.remove(person.photoKey);
    await this.audit.record(auth, { action: 'people.photo.removed', targetType: 'employment', targetId: employmentId, legalEntityId: subject.legalEntityId });
    return { hasPhoto: false };
  }
}
