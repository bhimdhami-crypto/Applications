// Reference data for a fresh MFI ERP database: currencies, the three companies, fiscal periods, VAT codes and an admin.
// The chart of accounts is not seeded: it comes from Sage Evolution through the ETL (erp/etl).
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const CURRENCIES = [
  { code: 'KES', name: 'Kenyan shilling', decimals: 2 },
  { code: 'USD', name: 'US dollar', decimals: 2 },
  { code: 'EUR', name: 'Euro', decimals: 2 },
  { code: 'GBP', name: 'Pound sterling', decimals: 2 },
  { code: 'AED', name: 'UAE dirham', decimals: 2 },
];

// Names are placeholders until confirmed; the codes match the Evolution databases
const COMPANIES = [
  { code: 'MFI-DS', name: 'MFI-DS' },
  { code: 'MFI-MDS', name: 'MFI-MDS' },
  { code: 'MFI-TS', name: 'MFI-TS' },
];

const TAX_CODES = [
  { code: 'VAT16', description: 'VAT standard rate 16%', rate: 16 },
  { code: 'VAT0', description: 'VAT zero-rated', rate: 0 },
  { code: 'EXEMPT', description: 'VAT exempt', rate: 0 },
];

/** Month the fiscal year starts (1 = January). The year label is the calendar year the fiscal year ends in. */
const START_MONTH = Number(process.env.FISCAL_YEAR_START_MONTH ?? 1);
const YEARS = (process.env.SEED_FISCAL_YEARS ?? '2026,2027').split(',').map(Number);

function periodsFor(fiscalYear: number) {
  const firstYear = START_MONTH === 1 ? fiscalYear : fiscalYear - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const month = START_MONTH - 1 + i; // zero-based, may run past 11 into the next year
    const startDate = new Date(Date.UTC(firstYear, month, 1));
    const endDate = new Date(Date.UTC(firstYear, month + 1, 0));
    return { year: fiscalYear, number: i + 1, startDate, endDate };
  });
}

export async function seed(prisma: PrismaClient) {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, create: c, update: {} });
  }

  for (const c of COMPANIES) {
    const company = await prisma.company.upsert({
      where: { code: c.code },
      create: { ...c, homeCurrency: 'KES' },
      update: {},
    });
    for (const year of YEARS) {
      for (const p of periodsFor(year)) {
        await prisma.fiscalPeriod.upsert({
          where: { companyId_year_number: { companyId: company.id, year: p.year, number: p.number } },
          create: { ...p, companyId: company.id },
          update: {},
        });
      }
    }
    for (const t of TAX_CODES) {
      await prisma.taxCode.upsert({
        where: { companyId_code: { companyId: company.id, code: t.code } },
        create: { ...t, companyId: company.id },
        update: {},
      });
    }
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@mfi-erp.test').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Administrator', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) },
    update: {},
  });

  if (process.env.NODE_ENV !== 'test') console.log(`Seeded ${CURRENCIES.length} currencies, ${COMPANIES.length} companies (fiscal years ${YEARS.join(', ')}), admin ${email}`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
