// Imports the fictional sample workforce (12,408 people, 2016-2026) with profile photos,
// next of kin and the HR document register. Run after the seed:  npm run db:import-sample
// Safe to run again: people already imported are skipped.
import { DocumentStatus, EmploymentStatus, EmploymentType, Prisma, PrismaClient, WorkLocation } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { parseCsv } from './csv';

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../sample-data');
const CHUNK = 2000;

const WORK_LOCATION: Record<string, WorkLocation> = { 'On-site': 'ON_SITE', Hybrid: 'HYBRID', 'Fully remote': 'FULLY_REMOTE' };
const EMPLOYMENT_TYPE: Record<string, EmploymentType> = { Permanent: 'PERMANENT', 'Fixed-term contract': 'FIXED_TERM', Intern: 'INTERN' };
const DOC_STATUS: Record<string, DocumentStatus> = { Verified: 'VERIFIED', Cleared: 'CLEARED', 'Pending verification': 'PENDING', Expired: 'EXPIRED' };
// Scanned specimen files exist for eight people; attach them to the matching register entries
const PERSONAL_FILES: Record<string, string> = {
  'id_document_SPECIMEN.pdf': 'National ID or passport',
  'education_certificate_SPECIMEN.pdf': 'Highest education certificate',
  'employee_profile.pdf': 'Employee profile summary',
};

const date = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);
const chunks = <T>(arr: T[], n = CHUNK) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function readGzCsv(dir: string, name: string) {
  return parseCsv(gunzipSync(await fs.readFile(path.join(dir, name))).toString('utf8'));
}

export async function importSample(prisma: PrismaClient, log: (msg: string) => void = console.log, dataDir = DEFAULT_DATA_DIR) {
  const DATA_DIR = path.resolve(dataDir);
  await prisma.$connect();
  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? 'storage');
  const companies = await prisma.company.findMany();
  const companyByCountry = new Map(companies.map((c) => [c.country, c]));
  if (companies.length === 0) throw new Error('No companies found. Run "npm run db:seed" first.');

  const people = await readGzCsv(DATA_DIR, 'employees.csv.gz');
  const existing = new Set((await prisma.employee.findMany({ select: { employeeNo: true } })).map((e) => e.employeeNo));
  const fresh = people.filter((p) => !existing.has(p.employee_id));
  // A number already in use (imported earlier, or given to someone added in the portal) is never overwritten
  log(`Sample staff: ${people.length}, number already in use: ${people.length - fresh.length}, importing: ${fresh.length}`);

  const photos: Record<string, string> = JSON.parse(gunzipSync(await fs.readFile(path.join(DATA_DIR, 'profile_photos.json.gz'))).toString('utf8'));
  const rows: Prisma.EmployeeCreateManyInput[] = [];
  for (const p of fresh) {
    const company = companyByCountry.get(p.country);
    if (!company) throw new Error(`No company for country "${p.country}" (${p.employee_id})`);
    let photoKey: string | null = null;
    if (photos[p.employee_id]) {
      photoKey = `photos/${p.employee_id}.svg`;
      await writeFile(storageRoot, photoKey, photos[p.employee_id]);
    }
    rows.push({
      employeeNo: p.employee_id,
      firstName: p.first_name,
      lastName: p.last_name,
      gender: p.gender || null,
      dateOfBirth: date(p.date_of_birth),
      companyId: company.id,
      city: p.city || null,
      department: p.department,
      jobTitle: p.job_title,
      grade: p.grade || null,
      workLocation: WORK_LOCATION[p.work_location] ?? 'ON_SITE',
      employmentType: EMPLOYMENT_TYPE[p.employment_type] ?? 'PERMANENT',
      hireDate: date(p.hire_date)!,
      exitDate: date(p.exit_date),
      exitReason: p.exit_reason || null,
      status: p.status === 'Left' ? EmploymentStatus.TERMINATED : EmploymentStatus.ACTIVE,
      monthlyBasic: p.monthly_base_salary || '0',
      workEmail: p.email || null,
      photoKey,
      mobilePhone: p.mobile_phone || null,
      personalEmail: p.personal_email || null,
      nationalIdNumber: p.national_id_or_passport || null,
      taxId: p.tax_id || null,
      socialSecurityNo: p.social_security_no || null,
      maritalStatus: p.marital_status || null,
      dependants: Number(p.dependants) || 0,
      highestQualification: p.highest_qualification || null,
      institution: p.institution || null,
      qualificationYear: Number(p.qualification_year) || null,
    });
  }
  for (const batch of chunks(rows)) await prisma.employee.createMany({ data: batch, skipDuplicates: true });

  // Only touch people this run created, never the test accounts or anyone imported before
  const freshNos = new Set(fresh.map((p) => p.employee_id));
  const idByNo = new Map(
    (await prisma.employee.findMany({ where: { userId: null }, select: { id: true, employeeNo: true } }))
      .filter((e) => freshNos.has(e.employeeNo))
      .map((e) => [e.employeeNo, e.id]),
  );

  const kin: Prisma.NextOfKinCreateManyInput[] = fresh
    .filter((p) => idByNo.has(p.employee_id) && p.next_of_kin_name)
    .map((p) => ({
      employeeId: idByNo.get(p.employee_id)!,
      name: p.next_of_kin_name,
      relationship: p.next_of_kin_relationship,
      phone: p.next_of_kin_phone,
      isEmergencyContact: p.emergency_contact_same_as_next_of_kin === 'Yes',
      isBeneficiary: p.beneficiary_nominated === 'Yes',
    }));
  for (const batch of chunks(kin)) await prisma.nextOfKin.createMany({ data: batch });
  log(`Next of kin: ${kin.length}`);

  // Scanned specimen files for eight people, keyed by employee number
  const scans = new Map<string, { type: string; file: string; name: string }[]>();
  const personalDir = path.join(DATA_DIR, 'personal_files');
  for (const folder of await fs.readdir(personalDir).catch(() => [] as string[])) {
    const employeeNo = folder.split('_')[0];
    const files = await fs.readdir(path.join(personalDir, folder));
    for (const name of files) {
      const full = path.join(personalDir, folder, name);
      if (name === 'profile_photo.png' && idByNo.has(employeeNo)) {
        const key = `photos/${employeeNo}.png`;
        await writeFile(storageRoot, key, await fs.readFile(full));
        await prisma.employee.update({ where: { id: idByNo.get(employeeNo)! }, data: { photoKey: key } });
      } else if (PERSONAL_FILES[name]) {
        scans.set(employeeNo, [...(scans.get(employeeNo) ?? []), { type: PERSONAL_FILES[name], file: full, name }]);
      }
    }
  }

  const register = await readGzCsv(DATA_DIR, 'employee_documents_register.csv.gz');
  const docs: Prisma.EmployeeDocumentCreateManyInput[] = [];
  for (const d of register) {
    const employeeId = idByNo.get(d.employee_id);
    if (!employeeId || d.document_type === 'Profile photo') continue;
    docs.push({
      employeeId,
      type: d.document_type,
      fileName: path.basename(d.file_name),
      issuedDate: date(d.issued_date),
      expiryDate: date(d.expiry_date),
      status: DOC_STATUS[d.verification_status] ?? 'PENDING',
      hrOnly: d.access_level === 'HR only',
    });
  }
  for (const [employeeNo, files] of scans) {
    const employeeId = idByNo.get(employeeNo);
    if (!employeeId) continue;
    for (const f of files) {
      const key = `documents/${employeeId}/${f.name}`;
      const data = await fs.readFile(f.file);
      await writeFile(storageRoot, key, data);
      const scan = { storageKey: key, mimeType: 'application/pdf', sizeBytes: data.length, fileName: f.name };
      const entry = docs.find((d) => d.employeeId === employeeId && d.type === f.type);
      if (entry) Object.assign(entry, scan);
      else docs.push({ employeeId, type: f.type, status: 'VERIFIED', ...scan });
    }
  }
  for (const batch of chunks(docs, 5000)) await prisma.employeeDocument.createMany({ data: batch });
  log(`Documents on file: ${docs.length} (${docs.filter((d) => d.storageKey).length} with scanned files)`);
  return { imported: idByNo.size, nextOfKin: kin.length, documents: docs.length };
}

async function writeFile(root: string, key: string, data: string | Buffer) {
  const file = path.join(root, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  importSample(prisma, console.log, process.argv[2])
    .then((r) => console.log(`Done: ${r.imported} people imported.`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
