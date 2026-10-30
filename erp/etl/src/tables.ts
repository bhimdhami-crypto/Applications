/**
 * The Sage Evolution tables staged into the ERP database. Each company database (MFI-DS, MFI-MDS, MFI-TS)
 * has the same schema. `key` is an increasing identity column used to copy large tables in chunks.
 */
export interface SourceTable {
  name: string;
  key?: string;
  /** Large posting tables are copied in chunks of this many rows */
  chunk?: number;
}

export const SOURCE_TABLES: SourceTable[] = [
  // Masters
  { name: 'Accounts', key: 'AccountLink' },
  { name: 'Client', key: 'DCLink' },
  { name: 'Vendor', key: 'DCLink' },
  { name: 'StkItem', key: 'StockLink' },
  { name: 'GrpTbl', key: 'idGrpTbl' },
  { name: 'WhseMst', key: 'WhseLink' },
  { name: 'WhseStk' },
  { name: 'Project', key: 'ProjectLink' },
  { name: 'TrCodes', key: 'idTrCodes' },
  { name: 'Currency', key: 'CurrencyLink' },
  { name: '_etblTaxCountry', key: 'idTaxCountry' },
  // Documents
  { name: 'InvNum', key: 'AutoIndex', chunk: 20000 },
  { name: '_btblInvoiceLines', key: 'idInvoiceLines', chunk: 20000 },
  // Ledgers
  { name: 'PostGL', key: 'AutoIdx', chunk: 50000 },
  { name: 'PostAR', key: 'AutoIdx', chunk: 50000 },
  { name: 'PostAP', key: 'AutoIdx', chunk: 50000 },
  { name: 'PostST', key: 'AutoIdx', chunk: 50000 },
];

export const STAGING_SCHEMA = 'stg_evo';
