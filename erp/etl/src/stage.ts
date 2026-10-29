import sql from 'mssql';
import { ColumnInfo, driverType, quoteName, stageable, typeDeclaration } from './columns';
import { readEvolution } from './connections';
import { STAGING_SCHEMA, SourceTable } from './tables';

const COLUMNS_QUERY = `
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table
ORDER BY ORDINAL_POSITION`;

/** CREATE TABLE for the staging copy: the source columns plus which company and when it was extracted */
export function stagingTableDdl(table: string, columns: ColumnInfo[]) {
  const target = `${quoteName(STAGING_SCHEMA)}.${quoteName(table)}`;
  const cols = columns.map((c) => `  ${quoteName(c.COLUMN_NAME)} ${typeDeclaration(c)} NULL`);
  cols.push('  [_company] nvarchar(20) NOT NULL', '  [_extracted_at] datetime2(0) NOT NULL');
  return `IF OBJECT_ID(N'${STAGING_SCHEMA}.${table.replace(/'/g, "''")}', N'U') IS NULL
CREATE TABLE ${target} (
${cols.join(',\n')}
);`;
}

/**
 * Copies one Evolution table for one company into stg_evo, replacing that company's previous copy.
 * Large tables are read in key order, one chunk at a time, so memory stays flat and Evolution sees short reads.
 */
export async function stageTable(
  source: sql.ConnectionPool,
  target: sql.ConnectionPool,
  company: string,
  table: SourceTable,
  log: (message: string) => void = console.log,
) {
  const all = await readEvolution<ColumnInfo>(source, COLUMNS_QUERY, { table: table.name });
  if (!all.length) {
    log(`${company} ${table.name}: not found, skipped`);
    return 0;
  }
  const columns = stageable(all);
  const extractedAt = new Date();

  await target.request().query(`IF SCHEMA_ID('${STAGING_SCHEMA}') IS NULL EXEC('CREATE SCHEMA ${STAGING_SCHEMA}')`);
  await target.request().query(stagingTableDdl(table.name, columns));
  await target
    .request()
    .input('company', company)
    .query(`DELETE FROM ${quoteName(STAGING_SCHEMA)}.${quoteName(table.name)} WHERE [_company] = @company`);

  const select = columns.map((c) => quoteName(c.COLUMN_NAME)).join(', ');
  const from = `FROM dbo.${quoteName(table.name)}`;
  let copied = 0;
  let after: number | null = null;

  for (;;) {
    let rows: Record<string, unknown>[];
    if (table.key && table.chunk) {
      const key = quoteName(table.key);
      rows = await readEvolution(
        source,
        `SELECT TOP (${table.chunk}) ${select} ${from} WHERE ${key} > @after ORDER BY ${key}`,
        { after: after ?? -2147483648 },
      );
    } else {
      rows = await readEvolution(source, `SELECT ${select} ${from}`);
    }
    if (!rows.length) break;

    const bulk = new sql.Table(`${STAGING_SCHEMA}.${table.name}`);
    for (const c of columns) bulk.columns.add(c.COLUMN_NAME, driverType(c), { nullable: true });
    bulk.columns.add('_company', sql.NVarChar(20), { nullable: false });
    bulk.columns.add('_extracted_at', sql.DateTime2(0), { nullable: false });
    for (const r of rows) bulk.rows.add(...columns.map((c) => r[c.COLUMN_NAME] as never), company as never, extractedAt as never);
    await target.request().bulk(bulk);

    copied += rows.length;
    if (!(table.key && table.chunk)) break;
    after = Number(rows[rows.length - 1][table.key]);
    log(`${company} ${table.name}: ${copied} rows so far`);
  }
  log(`${company} ${table.name}: ${copied} rows staged`);
  return copied;
}
