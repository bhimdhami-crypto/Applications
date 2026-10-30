// MFI ERP migration tool. Reads Sage Evolution company databases (SELECT only) and loads the ERP database.
//   npm run etl -- profile MFI-DS             row counts of the tables we migrate
//   npm run etl -- stage MFI-DS [PostGL,...]  copy Evolution tables into stg_evo (all tables if none named)
//   npm run etl -- accounts MFI-DS            map stg_evo.Accounts into the ERP chart of accounts
//   npm run etl -- parties MFI-DS             load stg_evo.Client and Vendor as customers and suppliers, and mark the control accounts
import { readFileSync } from 'fs';
import * as path from 'path';
import sql from 'mssql';
import { EvoAccount, loadAccounts, mapAccounts } from './accounts';
import { connectErp, connectEvolution, readEvolution } from './connections';
import { EvoParty, loadParties, mapParties } from './parties';
import { stageTable } from './stage';
import { SOURCE_TABLES } from './tables';

// Settings live in erp/api/.env, shared with the API
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', 'api', '.env'));
} catch {
  // No file: settings come from the environment
}

const COMPANIES = (process.env.EVO_DATABASES ?? 'MFI-DS,MFI-MDS,MFI-TS').split(',').map((s) => s.trim());

async function profile(company: string) {
  const evo = await connectEvolution(company);
  try {
    for (const t of SOURCE_TABLES) {
      // Row counts from the catalogue: instant, and no scan of the big posting tables
      const [row] = await readEvolution<{ n: number | null }>(
        evo,
        `SELECT CAST(SUM(p.rows) AS bigint) AS n FROM sys.partitions p
         JOIN sys.objects o ON o.object_id = p.object_id
         WHERE o.name = @t AND o.type = 'U' AND p.index_id IN (0, 1)`,
        { t: t.name },
      );
      const count = row?.n == null ? 'missing' : Number(row.n).toLocaleString();
      console.log(`${company.padEnd(8)} ${t.name.padEnd(20)} ${count}`);
    }
  } finally {
    await evo.close();
  }
}

async function stage(company: string, only?: string[]) {
  const tables = only ? SOURCE_TABLES.filter((t) => only.includes(t.name)) : SOURCE_TABLES;
  if (only && tables.length !== only.length) throw new Error(`Unknown table in ${only.join(', ')}`);
  const [evo, erp] = await Promise.all([connectEvolution(company), connectErp()]);
  try {
    for (const t of tables) await stageTable(evo, erp, company, t);
  } finally {
    await Promise.all([evo.close(), erp.close()]);
  }
}

async function accounts(company: string) {
  const typeMap = JSON.parse(readFileSync(path.join(__dirname, '..', 'account-types.json'), 'utf8'));
  const excluded: string[] = JSON.parse(readFileSync(path.join(__dirname, '..', 'excluded-accounts.json'), 'utf8'));
  const erp = await connectErp();
  try {
    const companyRow = (await erp.request().input('code', sql.NVarChar(20), company).query<{ id: number }>(
      'SELECT id FROM dbo.Company WHERE code = @code',
    )).recordset[0];
    if (!companyRow) throw new Error(`Company ${company} is not in the ERP database; run npm run db:seed first`);
    const rows = (await erp.request().input('code', sql.NVarChar(20), company).query<EvoAccount>(
      `SELECT AccountLink, Master_Sub_Account, Account, Description, iAccountType, SubAccOfLink, ActiveAccount
       FROM stg_evo.Accounts WHERE _company = @code`,
    )).recordset;
    if (!rows.length) throw new Error(`No staged accounts for ${company}; run: npm run etl -- stage ${company} Accounts`);

    const { mapped, unknown, skipped } = mapAccounts(rows, typeMap, excluded);
    if (unknown.size) {
      console.error('These iAccountType values are not in account-types.json yet. Map each to ASSET, LIABILITY, EQUITY, INCOME or EXPENSE:');
      for (const [type, examples] of unknown) console.error(`  ${type}: e.g. ${examples.join('; ')}`);
      process.exitCode = 1;
      return;
    }
    for (const r of skipped) console.log(`  not migrated (excluded-accounts.json): ${r.Master_Sub_Account} ${r.Description ?? ''}`);
    await loadAccounts(erp, companyRow.id, mapped);
    console.log(`${company}: ${mapped.length} accounts loaded into the chart of accounts`);
  } finally {
    await erp.close();
  }
}

async function parties(company: string) {
  const controls: Record<'AR' | 'AP', string[]> = JSON.parse(readFileSync(path.join(__dirname, '..', 'control-accounts.json'), 'utf8'));
  const erp = await connectErp();
  try {
    const companyRow = (await erp.request().input('code', sql.NVarChar(20), company).query<{ id: number; homeCurrency: string }>(
      'SELECT id, homeCurrency FROM dbo.Company WHERE code = @code',
    )).recordset[0];
    if (!companyRow) throw new Error(`Company ${company} is not in the ERP database; run npm run db:seed first`);

    // Currencies the ERP does not know are left empty rather than failing the load; they are listed below
    const select = (table: 'Client' | 'Vendor', extra: string) => `
SELECT p.DCLink, p.Account, p.Name, cur.CurrencyCode, ${extra}
FROM stg_evo.${table} p
LEFT JOIN stg_evo.Currency cur ON cur._company = p._company AND cur.CurrencyLink = p.iCurrencyID
WHERE p._company = @code`;
    for (const [kind, table, extra] of [
      ['CUSTOMER', 'Client', 'p.Credit_Limit, p.Tax_Number, p.EMail'],
      ['SUPPLIER', 'Vendor', 'CAST(NULL AS float) AS Credit_Limit, p.Tax_Number, CAST(NULL AS nvarchar(200)) AS EMail'],
    ] as const) {
      const rows = (await erp.request().input('code', sql.NVarChar(20), company).query<EvoParty>(select(table, extra))).recordset;
      if (!rows.length) {
        console.log(`${company}: no staged ${table} rows; run: npm run etl -- stage ${company} ${table},Currency`);
        continue;
      }
      const known = new Set((await erp.request().query<{ code: string }>('SELECT code FROM dbo.Currency')).recordset.map((c) => c.code));
      const { mapped, problems } = mapParties(rows, companyRow.homeCurrency);
      for (const p of mapped) {
        if (p.currencyCode && !known.has(p.currencyCode)) {
          console.log(`  ${p.code}: currency ${p.currencyCode} is not set up in the ERP, loaded without one`);
          p.currencyCode = null;
        }
      }
      for (const p of problems) console.log(`  not loaded: ${p}`);
      await loadParties(erp, companyRow.id, kind, mapped);
      console.log(`${company}: ${mapped.length} ${kind === 'CUSTOMER' ? 'customers' : 'suppliers'} loaded from ${table}`);
    }

    for (const [subledger, codes] of Object.entries(controls)) {
      for (const code of codes) {
        const res = await erp
          .request()
          .input('companyId', sql.Int, companyRow.id)
          .input('code', sql.NVarChar(50), code)
          .input('subledger', sql.NVarChar(2), subledger)
          .query('UPDATE dbo.GlAccount SET subledger = @subledger WHERE companyId = @companyId AND code = @code AND isPostable = 1');
        console.log(res.rowsAffected[0] ? `  ${code} marked as ${subledger} control account` : `  ${code} not found; mark the control account on the Chart of accounts page`);
      }
    }
  } finally {
    await erp.close();
  }
}

async function main() {
  const [command, company, tables] = process.argv.slice(2);
  if (!command || !company || !COMPANIES.includes(company)) {
    console.error(`Usage: npm run etl -- <profile|stage|accounts|parties> <${COMPANIES.join('|')}> [tables]`);
    process.exit(2);
  }
  if (command === 'profile') return profile(company);
  if (command === 'stage') return stage(company, tables?.split(','));
  if (command === 'accounts') return accounts(company);
  if (command === 'parties') return parties(company);
  throw new Error(`Unknown command ${command}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
