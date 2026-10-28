// Prepares the demo database during a Vercel build (see "vercel-build" in package.json):
// on an empty database it seeds the companies and test accounts, then imports the sample staff.
// Safe to run on every build: the seed runs once and the import skips people already there.
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { createFileStore } from '../src/storage/file-store';
import { importSample } from './import-sample';
import { seed } from './seed';

const SAMPLE_DIR = path.join(__dirname, '../../../sample-data');

async function main() {
  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count()) === 0) {
      const accounts = await seed(prisma);
      console.log(`Seeded ${accounts.length} test accounts`);
    } else {
      console.log('Test accounts already seeded');
    }
    await importSample(prisma);
    if (process.env.STORAGE_DRIVER === 'database') await restoreSampleFiles(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Puts back any sample file the database refers to but does not hold, for example when the data was
 * loaded before STORAGE_DRIVER=database was set and the files went to a build machine's disk.
 */
async function restoreSampleFiles(prisma: PrismaClient) {
  const store = createFileStore(prisma);
  const stored = new Set((await prisma.storedFile.findMany({ select: { key: true } })).map((f) => f.key));
  const files: Array<[string, Buffer | string]> = [];

  const catalogue: Array<{ code: string; version: string; file: string }> = JSON.parse(
    await fs.readFile(path.join(SAMPLE_DIR, 'library/catalogue.json'), 'utf8'),
  );
  const libraryFile = new Map(catalogue.map((c) => [`library/${c.code}/v${c.version}.pdf`, c.file]));
  for (const item of await prisma.libraryItem.findMany({ select: { fileKey: true } })) {
    const file = libraryFile.get(item.fileKey);
    if (file && !stored.has(item.fileKey)) files.push([item.fileKey, await fs.readFile(path.join(SAMPLE_DIR, 'library', file))]);
  }

  // Scanned specimen files and real photos for eight people, by employee number
  const personalDir = path.join(SAMPLE_DIR, 'personal_files');
  const personal = new Map<string, string>();
  for (const folder of await fs.readdir(personalDir).catch(() => [] as string[])) personal.set(folder.split('_')[0], path.join(personalDir, folder));

  const photos: Record<string, string> = JSON.parse(gunzipSync(await fs.readFile(path.join(SAMPLE_DIR, 'profile_photos.json.gz'))).toString('utf8'));
  for (const e of await prisma.employee.findMany({ where: { photoKey: { not: null } }, select: { employeeNo: true, photoKey: true } })) {
    const key = e.photoKey!;
    if (stored.has(key)) continue;
    if (key.endsWith('.svg') && photos[e.employeeNo]) files.push([key, photos[e.employeeNo]]);
    else if (key.endsWith('.png') && personal.has(e.employeeNo)) files.push([key, await fs.readFile(path.join(personal.get(e.employeeNo)!, 'profile_photo.png'))]);
  }

  const docs = await prisma.employeeDocument.findMany({
    where: { storageKey: { not: null } },
    select: { storageKey: true, fileName: true, employee: { select: { employeeNo: true } } },
  });
  for (const d of docs) {
    const dir = personal.get(d.employee.employeeNo);
    if (!stored.has(d.storageKey!) && dir && d.fileName) files.push([d.storageKey!, await fs.readFile(path.join(dir, d.fileName))]);
  }

  await store.putMany(files);
  console.log(`Sample files restored to the database: ${files.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
