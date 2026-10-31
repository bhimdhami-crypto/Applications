import sql from 'mssql';

/** One row of INFORMATION_SCHEMA.COLUMNS, as read from the Evolution database */
export interface ColumnInfo {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  DATETIME_PRECISION: number | null;
}

/** rowversion values cannot be inserted, and spatial or xml types are not needed for migration */
const SKIPPED = new Set(['timestamp', 'rowversion', 'geography', 'geometry', 'hierarchyid', 'sql_variant', 'xml']);

export function stageable(columns: ColumnInfo[]) {
  return columns.filter((c) => !SKIPPED.has(c.DATA_TYPE.toLowerCase()));
}

function len(n: number | null) {
  return n === -1 || n === null ? 'MAX' : String(n);
}

/** The column's type as T-SQL, to recreate the table in the staging schema */
export function typeDeclaration(c: ColumnInfo): string {
  const t = c.DATA_TYPE.toLowerCase();
  switch (t) {
    case 'varchar':
    case 'nvarchar':
    case 'char':
    case 'nchar':
    case 'varbinary':
    case 'binary':
      return `${t}(${len(c.CHARACTER_MAXIMUM_LENGTH)})`;
    case 'decimal':
    case 'numeric':
      return `${t}(${c.NUMERIC_PRECISION},${c.NUMERIC_SCALE})`;
    case 'datetime2':
    case 'time':
    case 'datetimeoffset':
      return `${t}(${c.DATETIME_PRECISION ?? 7})`;
    case 'text':
      return 'varchar(MAX)';
    case 'ntext':
      return 'nvarchar(MAX)';
    case 'image':
      return 'varbinary(MAX)';
    default:
      return t;
  }
}

/** The matching mssql driver type, for bulk inserts */
export function driverType(c: ColumnInfo): sql.ISqlType | (() => sql.ISqlType) {
  const t = c.DATA_TYPE.toLowerCase();
  const max = c.CHARACTER_MAXIMUM_LENGTH === -1 || c.CHARACTER_MAXIMUM_LENGTH === null ? sql.MAX : c.CHARACTER_MAXIMUM_LENGTH;
  switch (t) {
    case 'bigint':
      return sql.BigInt;
    case 'int':
      return sql.Int;
    case 'smallint':
      return sql.SmallInt;
    case 'tinyint':
      return sql.TinyInt;
    case 'bit':
      return sql.Bit;
    case 'float':
      return sql.Float;
    case 'real':
      return sql.Real;
    case 'money':
      return sql.Money;
    case 'smallmoney':
      return sql.SmallMoney;
    case 'decimal':
    case 'numeric':
      return sql.Decimal(c.NUMERIC_PRECISION ?? 18, c.NUMERIC_SCALE ?? 0);
    case 'date':
      return sql.Date;
    case 'datetime':
      return sql.DateTime;
    case 'smalldatetime':
      return sql.SmallDateTime;
    case 'datetime2':
      return sql.DateTime2(c.DATETIME_PRECISION ?? 7);
    case 'datetimeoffset':
      return sql.DateTimeOffset;
    case 'time':
      return sql.Time(c.DATETIME_PRECISION ?? 7);
    case 'char':
      return sql.Char(max);
    case 'nchar':
      return sql.NChar(max);
    case 'varchar':
    case 'text':
      return sql.VarChar(t === 'text' ? sql.MAX : max);
    case 'nvarchar':
    case 'ntext':
      return sql.NVarChar(t === 'ntext' ? sql.MAX : max);
    case 'binary': // the driver's Binary type takes no length; VarBinary loads binary(n) columns fine
    case 'varbinary':
    case 'image':
      return sql.VarBinary(t === 'image' ? sql.MAX : max);
    case 'uniqueidentifier':
      return sql.UniqueIdentifier;
    default:
      throw new Error(`No staging mapping for SQL type ${c.DATA_TYPE} (column ${c.COLUMN_NAME})`);
  }
}

/** Brackets an identifier for T-SQL, so names like _btblInvoiceLines or reserved words are safe */
export function quoteName(name: string) {
  return `[${name.replace(/]/g, ']]')}]`;
}
