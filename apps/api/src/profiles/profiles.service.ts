import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { detectFileKind, FILE_TYPES, MIME_BY_EXT } from '../storage/file-types';
import { StorageService } from '../storage/storage.service';
import { canEditPersonal, isHrEditor, profileAccess, ProfileAccess } from './profile-access';
import { ReplaceNextOfKinDto, UpdatePersonalDto, UploadDocumentDto } from './profiles.dto';

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const WORK_FIELDS = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  department: true,
  grade: true,
  employmentType: true,
  workLocation: true,
  city: true,
  workEmail: true,
  hireDate: true,
  exitDate: true,
  status: true,
  companyId: true,
  managerId: true,
  photoKey: true,
  company: { select: { name: true, countryCode: true, currency: true } },
  manager: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
  user: { select: { email: true, role: true, isActive: true } },
} satisfies Prisma.EmployeeSelect;

const PERSONAL_FIELDS = {
  ...WORK_FIELDS,
  mobilePhone: true,
  personalEmail: true,
  gender: true,
  dateOfBirth: true,
  maritalStatus: true,
  dependants: true,
  nationalIdNumber: true,
  taxId: true,
  socialSecurityNo: true,
  highestQualification: true,
  institution: true,
  qualificationYear: true,
  exitReason: true,
  monthlyBasic: true,
  monthlyAllowances: true,
  nextOfKin: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EmployeeSelect;

/** Staff profiles: personal details, next of kin, profile photo and HR documents. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Loads the employee and works out what the actor may see, or throws 404/403. */
  async access(actor: AuthUser, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, userId: true, managerId: true, photoKey: true, employeeNo: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const mine = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    return { employee, access: profileAccess(actor, employee, mine?.id ?? null) };
  }

  async get(actor: AuthUser, id: string) {
    const { access } = await this.access(actor, id);
    const select = access === 'MANAGER' ? WORK_FIELDS : PERSONAL_FIELDS;
    const profile = await this.prisma.employee.findUniqueOrThrow({ where: { id }, select });
    const { photoKey, ...rest } = profile;
    return {
      ...rest,
      hasPhoto: !!photoKey,
      access,
      can: {
        editPersonal: canEditPersonal(actor, access),
        editJob: isHrEditor(actor),
        viewDocuments: access !== 'MANAGER',
        uploadDocuments: canEditPersonal(actor, access),
        verifyDocuments: isHrEditor(actor),
      },
    };
  }

  async updatePersonal(actor: AuthUser, id: string, dto: UpdatePersonalDto) {
    await this.requireEdit(actor, id);
    await this.prisma.employee.update({ where: { id }, data: dto });
    await this.audit.record(actor.id, 'employee.personal_update', 'Employee', id, { fields: Object.keys(dto) });
    return this.get(actor, id);
  }

  async replaceNextOfKin(actor: AuthUser, id: string, dto: ReplaceNextOfKinDto) {
    await this.requireEdit(actor, id);
    await this.prisma.$transaction([
      this.prisma.nextOfKin.deleteMany({ where: { employeeId: id } }),
      this.prisma.nextOfKin.createMany({
        data: dto.contacts.map((c) => ({
          employeeId: id,
          name: c.name,
          relationship: c.relationship,
          phone: c.phone,
          email: c.email,
          isEmergencyContact: c.isEmergencyContact ?? true,
          isBeneficiary: c.isBeneficiary ?? false,
        })),
      }),
    ]);
    await this.audit.record(actor.id, 'employee.next_of_kin_update', 'Employee', id, { count: dto.contacts.length });
    return this.prisma.nextOfKin.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'asc' } });
  }

  async photo(actor: AuthUser, id: string) {
    const { employee } = await this.access(actor, id);
    if (!employee.photoKey) throw new NotFoundException('No profile photo');
    const data = await this.storage.get(employee.photoKey);
    if (!data) throw new NotFoundException('No profile photo');
    const ext = employee.photoKey.split('.').pop() ?? '';
    return { data, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
  }

  async setPhoto(actor: AuthUser, id: string, file?: UploadedFileLike) {
    const { employee } = await this.requireEdit(actor, id);
    if (!file) throw new BadRequestException('Choose a photo to upload');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('The photo must be 5 MB or smaller');
    const kind = detectFileKind(file.buffer);
    if (kind !== 'png' && kind !== 'jpeg' && kind !== 'webp') throw new BadRequestException('The photo must be a PNG, JPEG or WebP image');
    const key = `photos/${employee.employeeNo}-${randomUUID()}.${FILE_TYPES[kind].ext}`;
    await this.storage.put(key, file.buffer);
    await this.prisma.employee.update({ where: { id }, data: { photoKey: key } });
    if (employee.photoKey) await this.storage.remove(employee.photoKey);
    await this.audit.record(actor.id, 'employee.photo_update', 'Employee', id);
    return { hasPhoto: true };
  }

  async listDocuments(actor: AuthUser, id: string) {
    const { access } = await this.access(actor, id);
    if (access === 'MANAGER') throw new ForbiddenException('Managers cannot see personal documents');
    return this.prisma.employeeDocument.findMany({
      where: { employeeId: id, ...(access === 'SELF' ? { hrOnly: false } : {}) },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, type: true, fileName: true, mimeType: true, sizeBytes: true, issuedDate: true, expiryDate: true,
        status: true, hrOnly: true, createdAt: true, verifiedAt: true, storageKey: true,
      },
    }).then((docs) => docs.map(({ storageKey, ...d }) => ({ ...d, hasFile: !!storageKey })));
  }

  async uploadDocument(actor: AuthUser, id: string, dto: UploadDocumentDto, file?: UploadedFileLike) {
    await this.requireEdit(actor, id);
    if (!file) throw new BadRequestException('Choose a file to upload');
    const kind = detectFileKind(file.buffer);
    if (!kind || kind === 'mp4') throw new BadRequestException('Upload a PDF, PNG, JPEG or WebP file');
    const hr = isHrEditor(actor);
    const key = `documents/${id}/${randomUUID()}.${FILE_TYPES[kind].ext}`;
    await this.storage.put(key, file.buffer);
    const doc = await this.prisma.employeeDocument.create({
      data: {
        employeeId: id,
        type: dto.type,
        fileName: safeFileName(file.originalname, FILE_TYPES[kind].ext),
        storageKey: key,
        mimeType: FILE_TYPES[kind].mime,
        sizeBytes: file.size,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        // HR uploads are verified on arrival; an employee's own upload waits for HR
        status: hr ? DocumentStatus.VERIFIED : DocumentStatus.PENDING,
        hrOnly: hr && dto.hrOnly === 'true',
        uploadedById: actor.id,
        ...(hr ? { verifiedById: actor.id, verifiedAt: new Date() } : {}),
      },
    });
    await this.audit.record(actor.id, 'document.upload', 'EmployeeDocument', doc.id, { employeeId: id, type: dto.type });
    const { storageKey, ...rest } = doc;
    return { ...rest, hasFile: !!storageKey };
  }

  async documentFile(actor: AuthUser, docId: string) {
    const doc = await this.findDocument(actor, docId);
    if (!doc.storageKey) throw new NotFoundException('Only a paper copy of this document is on file');
    const data = await this.storage.get(doc.storageKey);
    if (!data) throw new NotFoundException('The file is missing from storage');
    await this.audit.record(actor.id, 'document.download', 'EmployeeDocument', doc.id);
    return { data, mime: doc.mimeType ?? 'application/octet-stream', fileName: doc.fileName };
  }

  /** A document's file for a caller that has already checked access (e.g. Finance reading IOU receipts) */
  async documentFileChecked(actorId: string, docId: string) {
    const doc = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!doc?.storageKey) throw new NotFoundException('No file is on record');
    const data = await this.storage.get(doc.storageKey);
    if (!data) throw new NotFoundException('The file is missing from storage');
    await this.audit.record(actorId, 'document.download', 'EmployeeDocument', doc.id);
    return { data, mime: doc.mimeType ?? 'application/octet-stream', fileName: doc.fileName };
  }

  async setDocumentStatus(actor: AuthUser, docId: string, status: DocumentStatus) {
    const doc = await this.findDocument(actor, docId);
    const updated = await this.prisma.employeeDocument.update({
      where: { id: doc.id },
      data: { status, verifiedById: actor.id, verifiedAt: new Date() },
    });
    await this.audit.record(actor.id, 'document.status', 'EmployeeDocument', doc.id, { status });
    const { storageKey, ...rest } = updated;
    return { ...rest, hasFile: !!storageKey };
  }

  async deleteDocument(actor: AuthUser, docId: string) {
    const doc = await this.findDocument(actor, docId);
    await this.prisma.employeeDocument.delete({ where: { id: doc.id } });
    if (doc.storageKey) await this.storage.remove(doc.storageKey);
    await this.audit.record(actor.id, 'document.delete', 'EmployeeDocument', doc.id, { employeeId: doc.employeeId, type: doc.type });
    return { id: doc.id, deleted: true };
  }

  private async findDocument(actor: AuthUser, docId: string) {
    const doc = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Document not found');
    const { access } = await this.access(actor, doc.employeeId);
    // Hide HR-only documents from the employee as if they did not exist
    if (access === 'MANAGER' || (access === 'SELF' && doc.hrOnly)) throw new NotFoundException('Document not found');
    return doc;
  }

  private async requireEdit(actor: AuthUser, id: string): Promise<{ employee: { employeeNo: string; photoKey: string | null }; access: ProfileAccess }> {
    const result = await this.access(actor, id);
    if (!canEditPersonal(actor, result.access)) throw new ForbiddenException('You cannot change this employee’s details');
    return result;
  }
}

function safeFileName(original: string, ext: string) {
  const base = original.replace(/\.[^.]*$/, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'document';
  return `${base}.${ext}`;
}
