import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mapAccounts } from './accounts';
import { ColumnInfo, quoteName, stageable, typeDeclaration } from './columns';
import { assertReadOnly } from './connections';
import { stagingTableDdl } from './stage';

const col = (COLUMN_NAME: string, DATA_TYPE: string, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH: null,
  NUMERIC_PRECISION: null,
  NUMERIC_SCALE: null,
  DATETIME_PRECISION: null,
  ...extra,
});

describe('assertReadOnly', () => {
  it.each(['SELECT * FROM PostGL', '  with x as (select 1 a) select a from x', '-- note\nSELECT 1'])('allows %j', (q) => {
    expect(() => assertReadOnly(q)).not.toThrow();
  });

  it.each([
    'UPDATE Client SET Name = 1',
    'EXEC sp_ManageInvoice',
    'SELECT * INTO #copy FROM PostGL',
    'SELECT 1; DELETE FROM PostGL',
    '/* SELECT */ DROP TABLE PostGL',
  ])('refuses %j', (q) => {
    expect(() => assertReadOnly(q)).toThrow();
  });
});

describe('staging columns', () => {
  it('recreates source types faithfully', () => {
    expect(typeDeclaration(col('Debit', 'float'))).toBe('float');
    expect(typeDeclaration(col('Amt', 'numeric', { NUMERIC_PRECISION: 19, NUMERIC_SCALE: 4 }))).toBe('numeric(19,4)');
    expect(typeDeclaration(col('Description', 'varchar', { CHARACTER_MAXIMUM_LENGTH: 100 }))).toBe('varchar(100)');
    expect(typeDeclaration(col('Notes', 'nvarchar', { CHARACTER_MAXIMUM_LENGTH: -1 }))).toBe('nvarchar(MAX)');
    expect(typeDeclaration(col('Memo', 'ntext'))).toBe('nvarchar(MAX)');
  });

  it('drops rowversion columns, which cannot be inserted', () => {
    expect(stageable([col('AutoIdx', 'bigint'), col('_rowversion', 'timestamp')]).map((c) => c.COLUMN_NAME)).toEqual(['AutoIdx']);
  });

  it('builds staging DDL with company and extract time', () => {
    const ddl = stagingTableDdl('_btblInvoiceLines', [col('idInvoiceLines', 'bigint')]);
    expect(ddl).toContain('CREATE TABLE [stg_evo].[_btblInvoiceLines]');
    expect(ddl).toContain('[idInvoiceLines] bigint NULL');
    expect(ddl).toContain('[_company] nvarchar(20) NOT NULL');
  });

  it('quotes names with closing brackets', () => {
    expect(quoteName('a]b')).toBe('[a]]b]');
  });
});

describe('mapAccounts', () => {
  const rows = [
    { AccountLink: 1, Master_Sub_Account: '1000', Account: '1000', Description: 'Bank', iAccountType: 2, SubAccOfLink: 0, ActiveAccount: true },
    { AccountLink: 2, Master_Sub_Account: '1000>001', Account: '1000', Description: ' Bank USD ', iAccountType: 2, SubAccOfLink: 1, ActiveAccount: false },
    { AccountLink: 3, Master_Sub_Account: '4000', Account: '4000', Description: 'Sales', iAccountType: 9, SubAccOfLink: 0, ActiveAccount: true },
  ];

  it('maps type numbers through the confirmed table and keeps the Evolution link', () => {
    const { mapped, unknown } = mapAccounts(rows, { '2': 'ASSET', '9': 'INCOME' });
    expect(unknown.size).toBe(0);
    expect(mapped[1]).toEqual({
      sourceLinkId: 2,
      code: '1000>001',
      description: 'Bank USD',
      type: 'ASSET',
      parentSourceLinkId: 1,
      isActive: false,
    });
    expect(mapped[0].parentSourceLinkId).toBeNull();
  });

  it('never guesses: unmapped type numbers are reported with examples', () => {
    const { mapped, unknown } = mapAccounts(rows, { '2': 'ASSET' });
    expect(mapped).toHaveLength(2);
    expect(unknown.get(9)).toEqual(['4000 Sales']);
  });

  it('rejects a type map value that is not an account type', () => {
    const { unknown } = mapAccounts(rows, { '2': 'BANK', '9': 'INCOME' });
    expect([...unknown.keys()]).toEqual([2]);
  });
});

describe('account-types.json', () => {
  it('maps every MFI-DS iAccountType to a known type', () => {
    const typeMap = JSON.parse(readFileSync(path.join(__dirname, '..', 'account-types.json'), 'utf8'));
    const seen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 17, 19, 22, 23, 24, 25, 26, 27, 29, 30, 32, 35, 36];
    const rows = seen.map((n) => ({ AccountLink: n, Master_Sub_Account: `T${n}`, Account: null, Description: 'x', iAccountType: n, SubAccOfLink: null, ActiveAccount: true }));
    const { mapped, unknown } = mapAccounts(rows, typeMap);
    expect(unknown.size).toBe(0);
    expect(mapped).toHaveLength(seen.length);
  });
});
