// MFI ERP migration tool. Reads Sage Evolution company databases (SELECT only) and loads the ERP database.
//   npm run etl -- profile MFI-DS             row counts of the tables we migrate
//   npm run etl -- stage MFI-DS [PostGL,...]  copy Evolution tables into stg_evo (all tables if none named)
//   npm run etl -- accounts MFI-DS            map stg_evo.Accounts into the ERP chart of accounts
import { readFileSync } from 'fs';
import * as path from 'path';
import sql from 'mssql';
import { EvoAccount, loadAccounts, mapAccounts } from './accounts';
import { connectErp, connectEvolution, readEvolution } from './connections';
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

async function main() {
  const [command, company, tables] = process.argv.slice(2);
  if (!command || !company || !COMPANIES.includes(company)) {
    console.error(`Usage: npm run etl -- <profile|stage|accounts> <${COMPANIES.join('|')}> [tables]`);
    process.exit(2);
  }
  if (command === 'profile') return profile(company);
  if (command === 'stage') return stage(company, tables?.split(','));
  if (command === 'accounts') return accounts(company);
  throw new Error(`Unknown command ${command}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
