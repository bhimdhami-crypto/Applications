/** Closed sets stored as strings, since Prisma has no enums on SQL Server */

export const ROLES = ['ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const LEDGER_SOURCES = ['GL', 'AR', 'AP', 'ST'] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];
