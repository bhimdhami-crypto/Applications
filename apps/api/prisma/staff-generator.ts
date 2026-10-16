/**
 * Synthetic workforce generator. Every person is fictional: names are drawn at random from
 * common-name pools, emails use the reserved .test and example.net domains, identity numbers
 * start with SPECIMEN and bank accounts with TEST.
 *
 * Reproducible: the same seed and limits always give the same people, jobs and pay. Each
 * country gets an independently drawn headcount between `min` and `max` (500 to 1,000 by default).
 * Pay figures are illustrative demo values, not market data or statutory minimums.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { COUNTRIES, currencyDecimals } from '@gpp/shared';
import { randomUUID } from 'crypto';
import { encryptField, last4 } from '../src/common/field-crypto';
import { DEMO_DEPARTMENTS } from './demo-org';
import { latin, local, NAME_POOLS, NamePart } from './demo-names';

export const STAFF_SEED = 20261016;
export const DEFAULT_STAFF = { min: 500, max: 1000 };
/** Hire, leave and pay dates are generated up to this day, so the data does not drift with the clock */
export const REFERENCE_DATE = new Date('2026-10-01T00:00:00Z');

export interface StaffOptions {
  min: number;
  max: number;
  seed?: number;
}

// ───────── Deterministic random numbers ─────────

/** mulberry32: small, fast and good enough for demo data */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)];
  const chance = (p: number) => next() < p;
  const weighted = <T>(items: readonly (readonly [T, number])[]) => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [v, w] of items) if ((r -= w) < 0) return v;
    return items[items.length - 1][0];
  };
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
  return { next, int, pick, chance, weighted, digits };
}
type Rng = ReturnType<typeof rng>;

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Headcount per country, before any database work: the plan the generator will follow */
export function plannedCounts(opts: StaffOptions = DEFAULT_STAFF): Record<string, number> {
  const seed = opts.seed ?? STAFF_SEED;
  return Object.fromEntries(COUNTRIES.map((c) => [c.code, rng(seed ^ hash(c.code)).int(opts.min, opts.max)]));
}

// ───────── Reference tables for the demo ─────────

export const JOB_GRADES = [
  { code: 'G1', name: 'Associate', level: 1 },
  { code: 'G2', name: 'Professional', level: 2 },
  { code: 'G3', name: 'Senior professional', level: 3 },
  { code: 'G4', name: 'Lead specialist', level: 4 },
  { code: 'G5', name: 'Manager', level: 5 },
  { code: 'G6', name: 'Head of function', level: 6 },
  { code: 'G7', name: 'Executive', level: 7 },
];

/** Titles for grades G1 to G4, then the team manager title (G5) */
const TITLES: Record<string, [string, string, string, string, string]> = {
  ENG: ['Graduate Software Engineer', 'Software Engineer', 'Senior Software Engineer', 'Principal Engineer', 'Engineering Manager'],
  DAI: ['Junior Data Analyst', 'Data Scientist', 'Senior Data Scientist', 'Principal ML Engineer', 'Data Science Manager'],
  PRD: ['Associate Product Analyst', 'Product Designer', 'Senior Product Manager', 'Principal Product Manager', 'Group Product Manager'],
  ITS: ['IT Support Technician', 'Systems Administrator', 'Senior Security Engineer', 'Lead Security Architect', 'IT Manager'],
  SAL: ['Sales Development Representative', 'Account Executive', 'Senior Account Executive', 'Key Account Director', 'Sales Manager'],
  MKT: ['Marketing Assistant', 'Marketing Specialist', 'Senior Marketing Specialist', 'Brand Lead', 'Marketing Manager'],
  CSU: ['Customer Support Associate', 'Customer Success Manager', 'Senior Customer Success Manager', 'Customer Success Lead', 'Customer Success Team Manager'],
  FIN: ['Accounts Assistant', 'Accountant', 'Senior Accountant', 'Financial Controller', 'Finance Manager'],
  HRM: ['HR Assistant', 'HR Officer', 'Senior HR Business Partner', 'HR Lead', 'HR Manager'],
  LEG: ['Legal Assistant', 'Legal Counsel', 'Senior Legal Counsel', 'Compliance Lead', 'Legal Manager'],
  OPS: ['Operations Assistant', 'Operations Analyst', 'Senior Operations Analyst', 'Operations Lead', 'Operations Manager'],
};

const DEPT_WEIGHTS: Record<string, number> = { ENG: 22, DAI: 10, PRD: 7, ITS: 6, SAL: 12, MKT: 6, CSU: 12, FIN: 7, HRM: 5, LEG: 3, OPS: 10 };
const SSC_WEIGHTS: Record<string, number> = { FIN: 35, HRM: 25, ITS: 20, OPS: 20 };

/** Share of a country's people in each company; the rest go to the first company */
const ENTITY_SHARE: Record<string, number> = { KE02: 0.15, IN02: 0.3, NL02: 0 };

/** Illustrative monthly base pay for grade G2, in the local currency, and the rounding step */
const PAY: Record<string, { g2: number; step: number }> = {
  KE: { g2: 150_000, step: 500 },
  UG: { g2: 3_500_000, step: 10_000 },
  TZ: { g2: 2_800_000, step: 10_000 },
  EG: { g2: 30_000, step: 100 },
  FR: { g2: 3_800, step: 50 },
  IN: { g2: 90_000, step: 500 },
  CN: { g2: 18_000, step: 100 },
  AU: { g2: 8_500, step: 50 },
  NL: { g2: 4_200, step: 50 },
  JP: { g2: 400_000, step: 1_000 },
  KR: { g2: 4_200_000, step: 10_000 },
  ZA: { g2: 40_000, step: 100 },
  NG: { g2: 650_000, step: 5_000 },
  MX: { g2: 35_000, step: 100 },
  NZ: { g2: 7_500, step: 50 },
};
const GRADE_FACTOR = [0, 0.7, 1, 1.4, 1.9, 2.4, 3.4, 5];

const DEGREES: Record<string, string[]> = {
  TECH: ['BSc Computer Science', 'BEng Software Engineering', 'MSc Data Science', 'BSc Information Technology', 'MSc Artificial Intelligence', 'BSc Mathematics'],
  COMM: ['BCom Marketing', 'BA Communication', 'BBA Business Administration', 'MBA', 'BA Economics'],
  CORP: ['BCom Accounting', 'BA Human Resource Management', 'LLB Law', 'MBA', 'BSc Finance', 'BA Economics'],
};
const RELATIONSHIPS = ['Spouse', 'Mother', 'Father', 'Sister', 'Brother', 'Partner', 'Son', 'Daughter', 'Cousin'];
const EXIT_REASONS = ['Resignation - career move', 'Resignation - relocation', 'Resignation - further studies', 'End of contract', 'Retirement', 'Redundancy', 'Mutual agreement'];

// ───────── Helpers ─────────

const DAY = 86_400_000;
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
const between = (r: Rng, from: Date, to: Date) => (to <= from ? day(from) : day(new Date(from.getTime() + Math.floor(r.next() * (to.getTime() - from.getTime())))));
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

interface DeptCtx {
  id: string;
  code: string;
  name: string;
  bu: string;
  businessUnitId: string | null;
  costCentreId: string | null;
}

interface Hire {
  personId: string;
  employmentId: string;
  dept: DeptCtx;
  level: number;
  managerId: string | null;
  firstName: string;
  lastName: string;
  gender: 'Female' | 'Male';
}

interface Batch {
  people: Prisma.PersonCreateManyInput[];
  employments: Prisma.EmploymentCreateManyInput[];
  assignments: Prisma.AssignmentCreateManyInput[];
  compensation: Prisma.CompensationCreateManyInput[];
  contacts: Prisma.PersonContactCreateManyInput[];
  identifiers: Prisma.PersonIdentifierCreateManyInput[];
  bankAccounts: Prisma.BankAccountCreateManyInput[];
  documents: Prisma.EmployeeDocumentCreateManyInput[];
  hires: Hire[];
}

const emptyBatch = (): Batch => ({ people: [], employments: [], assignments: [], compensation: [], contacts: [], identifiers: [], bankAccounts: [], documents: [], hires: [] });

// ───────── The generator ─────────

/**
 * Adds the synthetic workforce to every company that has no employees yet.
 * Returns the number of people created per country.
 */
export async function generateStaff(prisma: PrismaClient, groupId: string, opts: StaffOptions = DEFAULT_STAFF, log: (m: string) => void = () => undefined) {
  const seed = opts.seed ?? STAFF_SEED;
  const grades = new Map<number, string>();
  for (const g of JOB_GRADES) {
    const row = await prisma.jobGrade.upsert({ where: { groupId_code: { groupId, code: g.code } }, create: { groupId, ...g }, update: {} });
    grades.set(g.level, row.id);
  }

  const entities = await prisma.legalEntity.findMany({
    where: { groupId },
    include: { departments: { include: { costCentres: true } }, branches: { orderBy: { code: 'asc' } }, _count: { select: { employments: true } } },
    orderBy: { code: 'asc' },
  });
  const counts = plannedCounts(opts);
  const created: Record<string, number> = {};

  for (const country of COUNTRIES) {
    const inCountry = entities.filter((e) => e.countryCode === country.code);
    if (!inCountry.length || inCountry.some((e) => e._count.employments > 0)) continue;
    const pool = NAME_POOLS[country.code];
    const pay = PAY[country.code];
    if (!pool || !pay) throw new Error(`No demo name pool or pay table for ${country.code}`);
    const r = rng(seed ^ hash(`${country.code}:people`));
    const total = counts[country.code];
    const seq = { n: 0 };
    const batch = emptyBatch();

    let remaining = total;
    for (const [i, entity] of inCountry.entries()) {
      const share = ENTITY_SHARE[entity.code];
      const n = i === inCountry.length - 1 ? remaining : share !== undefined ? Math.round(total * share) : Math.round(total * (1 - inCountry.slice(1).reduce((s, e) => s + (ENTITY_SHARE[e.code] ?? 0), 0)));
      const take = Math.min(n, remaining);
      remaining -= take;
      if (take <= 0) continue;
      const depts: DeptCtx[] = entity.departments.map((d) => {
        const ref = DEMO_DEPARTMENTS.find((x) => x.code === d.code);
        return { id: d.id, code: d.code, name: d.name, bu: ref?.bu ?? 'CORP', businessUnitId: d.businessUnitId, costCentreId: d.costCentres[0]?.id ?? null };
      });
      buildEntity(r, batch, { entity, depts, branches: entity.branches.map((b) => b.id), countryCode: country.code, currency: country.currency, pool, pay, grades, seq, groupId, count: take });
    }
    if (country.code === 'KE') linkDemoAccounts(batch, inCountry);

    await linkUsers(prisma, batch);
    await insert(prisma, batch);
    created[country.code] = batch.people.length;
    log(`  ${country.code}: ${batch.people.length} people`);
  }
  return created;
}

interface EntityCtx {
  entity: { id: string; code: string; isSharedServiceCentre: boolean };
  depts: DeptCtx[];
  branches: string[];
  countryCode: string;
  currency: string;
  pool: (typeof NAME_POOLS)[string];
  pay: { g2: number; step: number };
  grades: Map<number, string>;
  seq: { n: number };
  groupId: string;
  count: number;
}

function buildEntity(r: Rng, batch: Batch, ctx: EntityCtx) {
  const weights = ctx.entity.isSharedServiceCentre ? SSC_WEIGHTS : DEPT_WEIGHTS;
  const depts = ctx.depts.filter((d) => weights[d.code]);
  const ops = depts.find((d) => d.code === 'OPS') ?? depts[0];

  // Head of the company first, then each department's people in order: head, team managers, staff
  const md = addPerson(r, batch, ctx, ops, 7, null, ctx.entity.isSharedServiceCentre ? 'Centre Director' : 'Managing Director');
  const sizes = new Map<string, number>();
  for (let i = 1; i < ctx.count; i++) {
    const code = r.weighted(depts.map((d) => [d.code, weights[d.code]] as const));
    sizes.set(code, (sizes.get(code) ?? 0) + 1);
  }
  for (const d of depts) {
    const k = sizes.get(d.code) ?? 0;
    if (!k) continue;
    const head = addPerson(r, batch, ctx, d, 6, md.employmentId, `Head of ${d.name}`);
    const leads: Hire[] = [];
    const leadCount = Math.ceil((k - 1) / 9);
    for (let i = 0; i < leadCount && i < k - 1; i++) leads.push(addPerson(r, batch, ctx, d, 5, head.employmentId, TITLES[d.code][4]));
    for (let i = 0; i < k - 1 - leads.length; i++) {
      const level = r.weighted([[1, 20], [2, 40], [3, 28], [4, 12]] as const);
      const manager = leads.length ? leads[i % leads.length] : head;
      addPerson(r, batch, ctx, d, level, manager.employmentId, TITLES[d.code][level - 1], true);
    }
  }
}

function addPerson(r: Rng, batch: Batch, ctx: EntityCtx, dept: DeptCtx, level: number, managerId: string | null, title: string, mayLeave = false): Hire {
  const { pool, countryCode: cc } = ctx;
  ctx.seq.n += 1;
  const n = ctx.seq.n;
  const employeeNumber = `MSA-${cc}-${String(n).padStart(6, '0')}`;
  const female = r.chance(0.48);
  const given: NamePart = r.pick(female ? pool.female : pool.male);
  const family: NamePart = r.pick(pool.last);
  const firstName = latin(given);
  const lastName = latin(family);
  const localName =
    local(given) && local(family) ? (pool.localOrder === 'family-first-joined' ? `${local(family)}${local(given)}` : `${local(given)} ${local(family)}`) : null;

  // Seniority shapes age and hire date: heads have been around longer
  const age = Math.min(64, 21 + level * 3 + r.int(0, 14));
  const dob = between(r, new Date(Date.UTC(2026 - age, 0, 1)), new Date(Date.UTC(2026 - age, 11, 28)));
  const earliest = new Date(Date.UTC(Math.max(2016, dob.getUTCFullYear() + 21), 0, 4));
  const hireDate = level >= 6 ? between(r, new Date('2016-01-04T00:00:00Z'), new Date('2019-12-31T00:00:00Z')) : between(r, earliest > new Date('2016-01-04') ? earliest : new Date('2016-01-04T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));
  const leaves = mayLeave && r.chance(0.12) && hireDate < addDays(REFERENCE_DATE, -120);
  const endDate = leaves ? between(r, addDays(hireDate, 90), addDays(REFERENCE_DATE, -1)) : null;
  const lastDay = endDate ?? REFERENCE_DATE;

  const foreign = r.chance(0.04);
  const nationality = foreign ? r.pick(COUNTRIES.filter((c) => c.code !== cc)).code : cc;
  const employmentType = level === 1 && r.chance(0.2) ? 'INTERN' : r.chance(0.11) ? 'FIXED_TERM' : 'PERMANENT';
  const personId = randomUUID();
  const employmentId = randomUUID();
  const fullName = `${firstName} ${lastName}`;

  batch.people.push({
    id: personId,
    groupId: ctx.groupId,
    personNumber: `P-${cc}-${String(n).padStart(6, '0')}`,
    firstName,
    lastName,
    localName,
    gender: female ? 'Female' : 'Male',
    dateOfBirth: dob,
    nationality,
    maritalStatus: age < 27 ? r.weighted([['Single', 85], ['Married', 15]] as const) : r.weighted([['Single', 30], ['Married', 60], ['Divorced', 7], ['Widowed', 3]] as const),
    dependants: age < 27 ? r.int(0, 1) : r.int(0, 4),
    personalEmail: `${slug(firstName)}.${slug(lastName)}.${cc.toLowerCase()}${n}@example.net`,
    mobilePhone: `${pool.phonePrefix}${r.digits(1)} ${r.digits(3)} ${r.digits(3)}`,
    highestQualification: r.pick(DEGREES[dept.bu] ?? DEGREES.CORP),
    institution: r.pick(pool.universities),
    qualificationYear: Math.min(hireDate.getUTCFullYear(), dob.getUTCFullYear() + r.int(21, 26)),
  });

  batch.employments.push({
    id: employmentId,
    personId,
    legalEntityId: ctx.entity.id,
    employeeNumber,
    workEmail: `${slug(firstName)}.${slug(lastName)}${n}@${cc.toLowerCase()}.mindspace.test`,
    employmentType,
    workLocation: r.weighted([['ON_SITE', 55], ['HYBRID', 35], ['FULLY_REMOTE', 10]] as const),
    hireDate,
    probationEndDate: addMonths(hireDate, 6),
    endDate,
    exitReason: endDate ? (employmentType === 'FIXED_TERM' ? 'End of contract' : r.pick(EXIT_REASONS)) : null,
    status: endDate ? 'TERMINATED' : 'ACTIVE',
  });

  // Job history: some staff were promoted from the grade below; pay follows the grade
  const branchId = ctx.branches.length > 1 && !r.chance(0.55) ? r.pick(ctx.branches.slice(1)) : ctx.branches[0];
  const promoted = level >= 2 && level <= 5 && r.chance(0.35) && hireDate < addDays(lastDay, -400);
  const startLevel = promoted ? level - 1 : level;
  const titles = TITLES[dept.code];
  const startTitle = promoted ? (startLevel <= 4 ? titles[startLevel - 1] : title) : title;
  const promotionDate = promoted ? between(r, addDays(hireDate, 365), addDays(lastDay, -30)) : null;
  const base = (lvl: number) => roundTo(ctx.pay.g2 * GRADE_FACTOR[lvl] * (0.85 + r.next() * 0.3), ctx.pay.step);
  const allowance = (b: number) => (r.chance(0.4) ? 0 : roundTo(b * (0.03 + r.next() * 0.12), ctx.pay.step));
  const job = { legalEntityId: ctx.entity.id, employmentId, businessUnitId: dept.businessUnitId, departmentId: dept.id, branchId, costCentreId: dept.costCentreId, managerId };

  const startPay = base(startLevel);
  batch.assignments.push({ ...job, effectiveFrom: hireDate, effectiveTo: promotionDate, reason: 'HIRE', jobTitle: startTitle, gradeId: ctx.grades.get(startLevel) });
  batch.compensation.push({ employmentId, legalEntityId: ctx.entity.id, effectiveFrom: hireDate, effectiveTo: promotionDate, currency: ctx.currency, baseAmount: money(startPay, ctx.currency), allowances: money(allowance(startPay), ctx.currency), reason: 'HIRE' });
  if (promotionDate) {
    const newPay = Math.max(base(level), roundTo(startPay * 1.12, ctx.pay.step));
    batch.assignments.push({ ...job, effectiveFrom: promotionDate, reason: 'PROMOTION', jobTitle: title, gradeId: ctx.grades.get(level) });
    batch.compensation.push({ employmentId, legalEntityId: ctx.entity.id, effectiveFrom: promotionDate, currency: ctx.currency, baseAmount: money(newPay, ctx.currency), allowances: money(allowance(newPay), ctx.currency), reason: 'PROMOTION' });
  } else if (!endDate && hireDate < new Date('2025-10-01T00:00:00Z')) {
    // Annual pay review on 1 April 2026 for people hired more than six months before it
    const last = batch.compensation[batch.compensation.length - 1];
    const reviewed = roundTo(startPay * (1.03 + r.next() * 0.05), ctx.pay.step);
    const reviewDate = new Date('2026-04-01T00:00:00Z');
    last.effectiveTo = reviewDate;
    batch.compensation.push({ employmentId, legalEntityId: ctx.entity.id, effectiveFrom: reviewDate, currency: ctx.currency, baseAmount: money(reviewed, ctx.currency), allowances: last.allowances, reason: 'ANNUAL_REVIEW' });
  }

  // Next of kin and beneficiaries
  const kin = r.chance(0.4) ? 2 : 1;
  for (let i = 0; i < kin; i++) {
    const kinFemale = r.chance(0.5);
    batch.contacts.push({
      personId,
      name: `${latin(r.pick(kinFemale ? pool.female : pool.male))} ${i === 0 && r.chance(0.6) ? lastName : latin(r.pick(pool.last))}`,
      relationship: r.pick(RELATIONSHIPS),
      phone: `${pool.phonePrefix}${r.digits(1)} ${r.digits(3)} ${r.digits(3)}`,
      isEmergencyContact: i === 0 || r.chance(0.5),
      isBeneficiary: i === 0 && r.chance(0.6),
    });
  }

  // Specimen identifiers, encrypted at rest like real ones would be
  const ids: [string, string, string, Date | null][] = foreign
    ? [
        ['PASSPORT', nationality, `SPECIMEN-${nationality}-PP-${r.digits(8)}`, between(r, new Date('2027-01-01T00:00:00Z'), new Date('2034-12-31T00:00:00Z'))],
        ['WORK_PERMIT', cc, `SPECIMEN-${cc}-WP-${r.digits(7)}`, between(r, new Date('2026-01-01T00:00:00Z'), new Date('2028-12-31T00:00:00Z'))],
      ]
    : [['NATIONAL_ID', cc, `SPECIMEN-${cc}-NID-${r.digits(8)}`, null]];
  ids.push(['TAX_ID', cc, `SPECIMEN-${cc}-TAX-${r.digits(7)}`, null], ['SOCIAL_SECURITY', cc, `SPECIMEN-${cc}-SS-${r.digits(7)}`, null]);
  for (const [kind, country, value, expiryDate] of ids) {
    batch.identifiers.push({ personId, kind, countryCode: country, valueEncrypted: encryptField(value), valueLast4: last4(value), expiryDate });
  }

  const account = `TEST${r.digits(10)}`;
  batch.bankAccounts.push({
    employmentId,
    legalEntityId: ctx.entity.id,
    bankName: `Test Bank ${COUNTRIES.find((c) => c.code === cc)!.name}`,
    branchCode: r.digits(3),
    accountName: fullName,
    accountNumberEncrypted: encryptField(account),
    accountNumberLast4: last4(account),
    currency: ctx.currency,
    effectiveFrom: hireDate,
  });

  // The HR document register. Paper copies only (no file), as in the first build's register.
  const doc = (type: string, status: 'PENDING' | 'VERIFIED' | 'CLEARED' | 'EXPIRED', extra: Partial<Prisma.EmployeeDocumentCreateManyInput> = {}) =>
    batch.documents.push({
      employmentId,
      legalEntityId: ctx.entity.id,
      type,
      fileName: `${employeeNumber}_${type.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`,
      status,
      issuedDate: hireDate,
      verifiedAt: status === 'VERIFIED' || status === 'CLEARED' ? addDays(hireDate, r.int(1, 20)) : null,
      ...extra,
    });
  doc('Offer letter', 'VERIFIED', { issuedDate: addDays(hireDate, -r.int(14, 45)) });
  doc('Employment contract', 'VERIFIED');
  doc('National ID or passport', r.chance(0.92) ? 'VERIFIED' : 'PENDING', { issuedDate: null });
  doc('Highest education certificate', r.chance(0.85) ? 'VERIFIED' : 'PENDING', { issuedDate: null });
  doc('Bank details confirmation', 'VERIFIED');
  doc('Background check report', 'CLEARED', { hrOnly: true });
  if (foreign) {
    const expiry = ids.find((i) => i[0] === 'WORK_PERMIT')![3]!;
    doc('Work permit', expiry < REFERENCE_DATE ? 'EXPIRED' : 'VERIFIED', { expiryDate: expiry });
  }
  if (endDate) doc('Exit clearance and certificate of service', r.chance(0.9) ? 'CLEARED' : 'PENDING', { issuedDate: endDate });

  const hire: Hire = { personId, employmentId, dept, level, managerId, firstName, lastName, gender: female ? 'Female' : 'Male' };
  batch.hires.push(hire);
  return hire;
}

/** Decimal string with the currency's minor units (none for UGX, JPY and KRW) */
function money(n: number, currency: string) {
  return new Prisma.Decimal(n).toFixed(currencyDecimals(currency));
}

// ───────── Demo accounts with an employee record ─────────

interface Link {
  email: string;
  entity: string;
  dept: string;
  levels: number[];
  firstName: string;
  lastName: string;
  gender: 'Female' | 'Male';
  /** Must report to the employee linked to this email */
  reportsTo?: string;
  required?: boolean;
}

/** Test accounts that are also employees, so self-service and team screens have data */
export const LINKED_ACCOUNTS: Link[] = [
  { email: 'manager@mindspace.test', entity: 'KE01', dept: 'ENG', levels: [5, 6], firstName: 'Amina', lastName: 'Mwangi', gender: 'Female', required: true },
  { email: 'employee@mindspace.test', entity: 'KE01', dept: 'ENG', levels: [1, 2, 3, 4], firstName: 'Kevin', lastName: 'Otieno', gender: 'Male', reportsTo: 'manager@mindspace.test', required: true },
  { email: 'hr.kenya@mindspace.test', entity: 'KE02', dept: 'HRM', levels: [6, 5, 4, 3, 2, 1], firstName: 'Wanjiru', lastName: 'Kamau', gender: 'Female' },
  { email: 'approver.kenya@mindspace.test', entity: 'KE02', dept: 'FIN', levels: [6, 5, 4, 3], firstName: 'Achieng', lastName: 'Odhiambo', gender: 'Female' },
  { email: 'payroll.kenya@mindspace.test', entity: 'KE02', dept: 'FIN', levels: [3, 2, 1, 4], firstName: 'Brian', lastName: 'Kiptoo', gender: 'Male' },
];

/** Picks generated people to stand in for the demo accounts and renames them to match */
function linkDemoAccounts(batch: Batch, entities: { id: string; code: string }[]) {
  const taken = new Map<string, Hire>();
  const activeIds = new Set(batch.employments.filter((e) => e.status === 'ACTIVE').map((e) => e.id));
  for (const link of LINKED_ACCOUNTS) {
    const entityId = entities.find((e) => e.code === link.entity)?.id;
    const boss = link.reportsTo ? taken.get(link.reportsTo) : undefined;
    let hire: Hire | undefined;
    // Prefer the named department; small demo sets may not have one, so fall back to any
    const tries = [...link.levels.map((level) => ({ level, anyDept: false })), ...link.levels.map((level) => ({ level, anyDept: !link.required }))];
    for (const { level, anyDept } of tries) {
      hire = batch.hires.find(
        (h) =>
          (anyDept || h.dept.code === link.dept) &&
          h.level === level &&
          activeIds.has(h.employmentId) &&
          batch.employments.find((e) => e.id === h.employmentId)!.legalEntityId === entityId &&
          (!boss || h.managerId === boss.employmentId) &&
          ![...taken.values()].includes(h),
      );
      if (hire) break;
    }
    if (!hire) {
      if (link.required) throw new Error(`Demo data has no ${link.dept} employee in ${link.entity} for ${link.email}; raise the staff minimum`);
      continue;
    }
    taken.set(link.email, hire);
    const person = batch.people.find((p) => p.id === hire!.personId)!;
    person.firstName = link.firstName;
    person.lastName = link.lastName;
    person.gender = link.gender;
    person.personalEmail = `${slug(link.firstName)}.${slug(link.lastName)}.personal@example.net`;
    const employment = batch.employments.find((e) => e.id === hire!.employmentId)!;
    employment.workEmail = link.email;
    const bank = batch.bankAccounts.find((b) => b.employmentId === hire!.employmentId)!;
    bank.accountName = `${link.firstName} ${link.lastName}`;
  }
}

/** Attaches portal accounts to the employees whose work email matches */
async function linkUsers(prisma: PrismaClient, batch: Batch) {
  const emails = LINKED_ACCOUNTS.map((l) => l.email);
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  for (const e of batch.employments) {
    const user = users.find((u) => u.email === e.workEmail);
    if (user) e.userId = user.id;
  }
}

async function insert(prisma: PrismaClient, b: Batch) {
  const chunks = <T>(rows: T[], n = 2000) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));
  // Managers are hired first in each company, but insert jobs in two passes so a manager row always exists
  await prisma.$transaction(
    async (tx) => {
      for (const c of chunks(b.people)) await tx.person.createMany({ data: c });
      for (const c of chunks(b.employments)) await tx.employment.createMany({ data: c });
      for (const c of chunks(b.assignments)) await tx.assignment.createMany({ data: c });
      for (const c of chunks(b.compensation)) await tx.compensation.createMany({ data: c });
      for (const c of chunks(b.contacts)) await tx.personContact.createMany({ data: c });
      for (const c of chunks(b.identifiers)) await tx.personIdentifier.createMany({ data: c });
      for (const c of chunks(b.bankAccounts)) await tx.bankAccount.createMany({ data: c });
      for (const c of chunks(b.documents)) await tx.employeeDocument.createMany({ data: c });
    },
    { timeout: 120_000 },
  );
}

// ───────── Verification report ─────────

/** Headcount by country, company and department, straight from the database */
export async function staffReport(prisma: PrismaClient) {
  const entities = await prisma.legalEntity.findMany({ orderBy: [{ countryCode: 'asc' }, { code: 'asc' }], include: { country: true, departments: { orderBy: { code: 'asc' } } } });
  const byEntity = await prisma.employment.groupBy({ by: ['legalEntityId', 'status'], _count: { _all: true } });
  const current = { effectiveFrom: { lte: REFERENCE_DATE }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: REFERENCE_DATE } }], employment: { status: 'ACTIVE' as const } };
  const byDept = await prisma.assignment.groupBy({ by: ['departmentId'], where: current, _count: { _all: true } });
  const people = await prisma.person.count();
  const lines: string[] = [];
  const countOf = (id: string, status?: string) => byEntity.filter((r) => r.legalEntityId === id && (!status || r.status === status)).reduce((s, r) => s + r._count._all, 0);

  lines.push('| Country | People (all time) | Active | Left |', '|---|---:|---:|---:|');
  const countries = [...new Set(entities.map((e) => e.countryCode))];
  for (const cc of countries) {
    const ids = entities.filter((e) => e.countryCode === cc).map((e) => e.id);
    const all = ids.reduce((s, id) => s + countOf(id), 0);
    const active = ids.reduce((s, id) => s + countOf(id, 'ACTIVE'), 0);
    lines.push(`| ${entities.find((e) => e.countryCode === cc)!.country.name} (${cc}) | ${all} | ${active} | ${all - active} |`);
  }
  lines.push('', '| Company | Active | Active by department |', '|---|---:|---|');
  for (const e of entities) {
    const depts = e.departments
      .map((d) => [d.code, byDept.find((x) => x.departmentId === d.id)?._count._all ?? 0] as const)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => `${c} ${n}`)
      .join(', ');
    lines.push(`| ${e.code} ${e.name} | ${countOf(e.id, 'ACTIVE')} | ${depts || '—'} |`);
  }
  return { people, markdown: lines.join('\n') };
}
