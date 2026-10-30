// Reference data for a fresh MFI ERP database: currencies, the three companies, fiscal periods, VAT codes,
// starting approval rules and an admin.
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

/**
 * Starting approval routes, one set per company, until MFI's own SOPs are entered (POST /approval-rules).
 * Every voucher must match a rule, so journals and reversals are covered at any amount.
 */
/**
 * Starting approval matrix, set from common internal-control practice until MFI's written SOP replaces it
 * (Bhim, 30 Oct 2026). Bands are KES, minimum inclusive, maximum exclusive. The author never approves, and
 * no one approves two stages of the same voucher, so the top band needs two different directors.
 */
const FM = { name: 'Finance manager review', approverRole: 'FINANCE_MANAGER' };
const DIRECTOR = { name: 'Director approval', approverRole: 'DIRECTOR' };
const SECOND_DIRECTOR = { name: 'Second director approval', approverRole: 'DIRECTOR' };
const SOP = 'Assumed matrix Oct 2026, pending MFI SOP';
const APPROVAL_RULES = [
  { documentType: 'JOURNAL', name: 'Journals under KES 500,000', sopReference: SOP, minAmount: 0, maxAmount: 500_000, stages: [FM] },
  { documentType: 'JOURNAL', name: 'Journals from KES 500,000 to under 5,000,000', sopReference: SOP, minAmount: 500_000, maxAmount: 5_000_000, stages: [FM, DIRECTOR] },
  { documentType: 'JOURNAL', name: 'Journals of KES 5,000,000 and over', sopReference: SOP, minAmount: 5_000_000, maxAmount: null, stages: [FM, DIRECTOR, SECOND_DIRECTOR] },
  // Undoing posted entries is a sensitive change for audit, so every reversal needs a director whatever its size.
  { documentType: 'REVERSAL', name: 'Reversals, any amount', sopReference: SOP, minAmount: 0, maxAmount: null, stages: [FM, DIRECTOR] },
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
    if (!(await prisma.approvalRule.count({ where: { companyId: company.id } }))) {
      for (const { stages, ...rule } of APPROVAL_RULES) {
        await prisma.approvalRule.create({
          data: {
            ...rule,
            companyId: company.id,
            stages: { create: stages.map((st, i) => ({ ...st, stageNo: i + 1 })) },
          },
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
