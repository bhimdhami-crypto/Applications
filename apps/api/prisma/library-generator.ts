import { LibraryKind, PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { rng } from './staff-generator';

interface CatalogueEntry {
  kind: 'POLICY' | 'FORM';
  code: string;
  title: string;
  category: string;
  owner: string;
  summary: string | null;
  version: string;
  file: string;
}

const LIBRARY_DIR = path.resolve(__dirname, '../../../sample-data/library');
const LIBRARY_SEED = 20261020;
/** Policies the demo history shows as widely confirmed, so the read report has something to show */
const WIDELY_READ = ['POL-01', 'POL-08', 'POL-09'];

/**
 * The first build's 22 group policies and 20 HR forms (drafts, version 0.1). Added once per group;
 * HR's later changes are kept. Also confirms a few policies for part of the staff.
 */
export async function generateLibrary(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? 'storage');
  const catalogue: CatalogueEntry[] = JSON.parse(await fs.readFile(path.join(LIBRARY_DIR, 'catalogue.json'), 'utf8'));
  let added = 0;
  for (const c of catalogue) {
    const existing = await prisma.libraryItem.findUnique({ where: { groupId_code: { groupId, code: c.code } } });
    const fileKey = existing?.fileKey ?? `library/${groupId}/${c.code}/v${c.version}.pdf`;
    // The file is copied again when storage was wiped, so the database never points at nothing
    const target = path.join(storageRoot, fileKey);
    try {
      await fs.access(target);
    } catch {
      if (existing && existing.version !== c.version) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(LIBRARY_DIR, c.file), target);
    }
    if (existing) continue;
    await prisma.libraryItem.create({
      data: {
        groupId,
        kind: c.kind as LibraryKind,
        code: c.code,
        title: c.title,
        category: c.category,
        owner: c.owner,
        summary: c.summary,
        version: c.version,
        fileKey,
        fileName: `${c.code} ${c.title}.pdf`,
        mustRead: c.kind === 'POLICY',
        publishedAt: new Date('2026-01-05T08:00:00Z'),
      },
    });
    added++;
  }
  const items = await prisma.libraryItem.findMany({ where: { groupId, code: { in: WIDELY_READ } }, select: { id: true, code: true, version: true } });
  if (await prisma.policyAcknowledgement.count({ where: { itemId: { in: items.map((i) => i.id) } } })) {
    log(`  Policies and forms: ${added} added, read confirmations already present.`);
    return;
  }
  const staff = await prisma.employment.findMany({ where: { legalEntity: { groupId }, status: 'ACTIVE', user: null }, select: { id: true, hireDate: true }, orderBy: { employeeNumber: 'asc' } });
  const r = rng(LIBRARY_SEED);
  let confirmations = 0;
  for (const item of items) {
    const share = item.code === 'POL-01' ? 0.8 : 0.55;
    const rows = staff
      .filter(() => r.next() < share)
      .map((s) => {
        const from = Math.max(s.hireDate.getTime(), Date.parse('2026-01-05T00:00:00Z'));
        return { itemId: item.id, version: item.version, employmentId: s.id, createdAt: new Date(from + r.int(1, 60) * 86_400_000) };
      });
    await prisma.policyAcknowledgement.createMany({ data: rows, skipDuplicates: true });
    confirmations += rows.length;
  }
  log(`  Policies and forms: ${added} added, ${confirmations} fictional read confirmations.`);
}
