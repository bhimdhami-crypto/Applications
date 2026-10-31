import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createFileStore, FileStore } from './file-store';

/**
 * Keeps uploaded files (photos, HR documents) on the local disk under STORAGE_DIR,
 * or in the database when STORAGE_DRIVER=database. Callers only deal in keys.
 */
@Injectable()
export class StorageService {
  private readonly store: FileStore;

  constructor(config: ConfigService, prisma: PrismaService) {
    this.store = createFileStore(prisma, { STORAGE_DRIVER: config.get('STORAGE_DRIVER'), STORAGE_DIR: config.get('STORAGE_DIR') });
  }

  put(key: string, data: Buffer | string) {
    return this.store.put(key, data);
  }

  get(key: string): Promise<Buffer | null> {
    return this.store.get(key);
  }

  remove(key: string) {
    return this.store.remove(key);
  }
}
