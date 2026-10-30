import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileStore } from './file-store';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, recogniseFile, safeFileName } from './file-types';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * The document archive: every supporting file (invoice scan, contract, statement) is stored once,
 * fingerprinted with SHA-256, and linked to the voucher it supports, so nothing is filed on paper.
 */
@Injectable()
export class ArchiveService {
  private readonly store: FileStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.store = new FileStore(config.get('ARCHIVE_DIR', 'archive'));
  }

  /** Checks every file first, so a batch dropped together is stored all or nothing */
  async attach(companyId: number, companyCode: string, entityId: number, user: AuthUser, files: UploadedFile[], description?: string) {
    if (!files?.length) throw new BadRequestException('Choose or drop at least one file');
    const checked = files.map((f) => {
      if (f.size > MAX_FILE_BYTES) throw new BadRequestException(`${f.originalname} is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      const contentType = recogniseFile(f.originalname, f.buffer);
      if (!contentType) {
        throw new BadRequestException(`${f.originalname} is not an accepted file (${ACCEPTED_EXTENSIONS.join(', ')}), or its content does not match its name`);
      }
      return { file: f, contentType, sha256: createHash('sha256').update(f.buffer).digest('hex') };
    });

    const month = new Date().toISOString().slice(0, 7).replace('-', '/');
    const written: string[] = [];
    try {
      const rows = [];
      for (const c of checked) {
        const storageKey = `${companyCode}/${month}/${randomUUID()}-${safeFileName(c.file.originalname)}`;
        await this.store.put(storageKey, c.file.buffer);
        written.push(storageKey);
        rows.push({
          companyId,
          entityType: 'VOUCHER',
          entityId,
          fileName: c.file.originalname.slice(0, 260),
          contentType: c.contentType,
          size: c.file.size,
          sha256: c.sha256,
          storageKey,
          description: description?.slice(0, 400),
          uploadedById: user.id,
        });
      }
      await this.prisma.attachment.createMany({ data: rows });
      await this.audit.record(user.id, 'archive.attached', 'Voucher', entityId, { files: rows.map((r) => r.fileName) });
      return this.forVoucher(entityId);
    } catch (e) {
      await Promise.all(written.map((k) => this.store.remove(k)));
      throw e;
    }
  }

  forVoucher(voucherId: number) {
    return this.prisma.attachment.findMany({
      where: { entityType: 'VOUCHER', entityId: voucherId },
      orderBy: { uploadedAt: 'asc' },
      select: { id: true, fileName: true, contentType: true, size: true, sha256: true, description: true, uploadedAt: true },
    });
  }

  async download(companyCode: string, id: number) {
    const company = await this.companies.byCode(companyCode);
    const row = await this.prisma.attachment.findFirst({ where: { id, companyId: company.id } });
    if (!row) throw new NotFoundException('No such file');
    const data = await this.store.get(row.storageKey);
    if (!data) throw new NotFoundException('The archived file is missing from storage');
    if (createHash('sha256').update(data).digest('hex') !== row.sha256) {
      throw new NotFoundException('The archived file has been altered since it was stored');
    }
    return { row, data };
  }

  /** Only the caller (VouchersService) decides when a file may be removed: never once its voucher is posted */
  async remove(id: number, user: AuthUser) {
    const row = await this.prisma.attachment.findUniqueOrThrow({ where: { id } });
    await this.prisma.attachment.delete({ where: { id } });
    await this.store.remove(row.storageKey);
    await this.audit.record(user.id, 'archive.removed', 'Voucher', row.entityId, { file: row.fileName, sha256: row.sha256 });
  }

  /** Finds archived files by file name, description, voucher number or reference */
  async search(companyCode: string, q: string | undefined, from?: string, to?: string) {
    const company = await this.companies.byCode(companyCode);
    const text = q?.trim();
    const vouchers = text
      ? await this.prisma.voucher.findMany({
          where: { companyId: company.id, OR: [{ voucherNo: { contains: text } }, { reference: { contains: text } }, { description: { contains: text } }] },
          select: { id: true },
          take: 500,
        })
      : [];
    const hits = await this.prisma.attachment.findMany({
      where: {
        companyId: company.id,
        uploadedAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined },
        ...(text
          ? {
              OR: [
                { fileName: { contains: text } },
                { description: { contains: text } },
                { entityType: 'VOUCHER', entityId: { in: vouchers.map((v) => v.id) } },
              ],
            }
          : {}),
      },
      orderBy: { uploadedAt: 'desc' },
      take: 200,
      select: { id: true, entityType: true, entityId: true, fileName: true, contentType: true, size: true, description: true, uploadedAt: true },
    });
    // Each hit names its voucher, so the archive screen can open it
    const ids = [...new Set(hits.filter((h) => h.entityType === 'VOUCHER').map((h) => h.entityId))];
    const numbers = new Map(
      (await this.prisma.voucher.findMany({ where: { id: { in: ids } }, select: { id: true, voucherNo: true } })).map((v) => [v.id, v.voucherNo]),
    );
    return hits.map((h) => ({ ...h, voucherNo: h.entityType === 'VOUCHER' ? (numbers.get(h.entityId) ?? null) : null }));
  }
}
