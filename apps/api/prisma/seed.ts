// Seeds reference data, the demo organisation and the test accounts. Safe to run more than once.
import { PrismaClient, Role, ScopeType } from '@prisma/client';
import { BRAND, COUNTRIES, CURRENCIES, GROUP_REPORTING_CURRENCY, LANGUAGES } from '@gpp/shared';
import * as bcrypt from 'bcryptjs';
import { DEMO_BUSINESS_UNITS, DEMO_DEPARTMENTS, DEMO_ENTITIES, DEMO_FEATURES, DEMO_USERS, NO_PAYROLL, SHARED_SERVICE_DEPARTMENTS } from './demo-org';
import { DEFAULT_STAFF, generateStaff, StaffOptions } from './staff-generator';

export const DEMO_GROUP_CODE = 'MINDSPACE';

export interface SeedOptions {
  password?: string;
  quiet?: boolean;
  /** Synthetic staff per country; false skips them. Defaults to 500 to 1,000 per country. */
  staff?: StaffOptions | false;
}

export async function seed(prisma: PrismaClient, opts: SeedOptions = {}) {
  const password = opts.password ?? process.env.SEED_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) throw new Error('Set SEED_PASSWORD before seeding a production-mode database');
  const passwordHash = await bcrypt.hash(password ?? 'Demo#Mindspace2026', 10);

  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, create: c, update: {} });
  }
  for (const l of LANGUAGES) {
    await prisma.language.upsert({ where: { code: l.code }, create: l, update: {} });
  }
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, currencyCode: c.currency, languages: c.languages, timeZone: c.timeZone, weekendDays: c.weekendDays, region: c.region },
      update: {},
    });
  }

  const group = await prisma.group.upsert({
    where: { code: DEMO_GROUP_CODE },
    create: { code: DEMO_GROUP_CODE, name: BRAND.demoGroupName, reportingCurrency: GROUP_REPORTING_CURRENCY },
    update: { name: BRAND.demoGroupName },
  });

  const entityIds = new Map<string, string>();
  for (const e of DEMO_ENTITIES) {
    const country = COUNTRIES.find((c) => c.code === e.countryCode)!;
    const entity = await prisma.legalEntity.upsert({
      where: { groupId_code: { groupId: group.id, code: e.code } },
      create: {
        groupId: group.id,
        code: e.code,
        name: e.name,
        countryCode: e.countryCode,
        functionalCurrency: country.currency,
        timeZone: country.timeZone,
        weekendDays: country.weekendDays,
        defaultLanguage: country.languages[0],
        // Demo fiscal years: July in Australia and New Zealand (April), April in India and Japan, March in South Africa, January elsewhere
        fiscalYearStartMonth: ({ AU: 7, IN: 4, JP: 4, NZ: 4, ZA: 3 } as Record<string, number>)[e.countryCode] ?? 1,
        isSharedServiceCentre: e.isSharedServiceCentre ?? false,
      },
      update: { name: e.name },
    });
    entityIds.set(e.code, entity.id);

    const buIds = new Map<string, string>();
    for (const bu of DEMO_BUSINESS_UNITS) {
      const row = await prisma.businessUnit.upsert({
        where: { legalEntityId_code: { legalEntityId: entity.id, code: bu.code } },
        create: { legalEntityId: entity.id, ...bu },
        update: {},
      });
      buIds.set(bu.code, row.id);
    }
    const branchIds: string[] = [];
    for (const [i, city] of e.cities.entries()) {
      const code = `${e.code}-B${String(i + 1).padStart(2, '0')}`;
      const row = await prisma.branch.upsert({
        where: { legalEntityId_code: { legalEntityId: entity.id, code } },
        create: { legalEntityId: entity.id, code, name: `${city} ${i === 0 ? 'head office' : 'office'}`, city },
        update: {},
      });
      branchIds.push(row.id);
    }
    const depts = e.isSharedServiceCentre ? DEMO_DEPARTMENTS.filter((d) => SHARED_SERVICE_DEPARTMENTS.includes(d.code)) : DEMO_DEPARTMENTS;
    for (const d of depts) {
      const dept = await prisma.department.upsert({
        where: { legalEntityId_code: { legalEntityId: entity.id, code: d.code } },
        create: { legalEntityId: entity.id, code: d.code, name: d.name, businessUnitId: buIds.get(d.bu), branchId: branchIds[0] },
        update: {},
      });
      const ccCode = `${e.code}-${d.code}`;
      await prisma.costCentre.upsert({
        where: { legalEntityId_code: { legalEntityId: entity.id, code: ccCode } },
        create: { legalEntityId: entity.id, code: ccCode, name: `${d.name} (${e.code})`, departmentId: dept.id, glCode: `6100-${ccCode}` },
        update: {},
      });
    }
    for (const module of DEMO_FEATURES) {
      const enabled = !(module === 'payroll' && NO_PAYROLL.includes(e.code));
      await prisma.entityFeature.upsert({
        where: { legalEntityId_module: { legalEntityId: entity.id, module } },
        create: { legalEntityId: entity.id, module, enabled },
        update: {},
      });
    }
  }

  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { groupId: group.id, email: u.email, displayName: u.displayName, passwordHash },
      update: {},
    });
    const existing = await prisma.roleAssignment.count({ where: { userId: user.id } });
    if (existing) continue;
    for (const r of u.roles) {
      await prisma.roleAssignment.create({
        data: {
          userId: user.id,
          role: r.role as Role,
          scopeType: r.scopeType as ScopeType,
          countryCode: r.countryCode ?? null,
          legalEntityId: r.entityCode ? entityIds.get(r.entityCode)! : null,
        },
      });
    }
  }

  const log = opts.quiet ? () => undefined : (m: string) => console.log(m);
  log(`Seeded ${COUNTRIES.length} countries, ${DEMO_ENTITIES.length} companies and ${DEMO_USERS.length} test accounts in ${group.name}.`);
  if (opts.staff !== false) {
    log('Generating synthetic staff (companies that already have staff are skipped):');
    await generateStaff(prisma, group.id, opts.staff ?? DEFAULT_STAFF, log);
  }
  return group;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
