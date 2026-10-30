/** Closed sets stored as strings, since Prisma has no enums on SQL Server */

export const ROLES = ['ADMIN', 'DIRECTOR', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const LEDGER_SOURCES = ['GL', 'AR', 'AP', 'ST', 'IC'] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const VOUCHER_TYPES = ['JOURNAL', 'REVERSAL'] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/** DRAFT → SUBMITTED → (stage by stage) → POSTED; REJECTED goes back to the author to fix and resubmit */
export const VOUCHER_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'POSTED', 'CANCELLED'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/** Customers sit on the AR (Debtors Control) subledger, suppliers on AP (Creditors Control) */
export const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const SUBLEDGERS = ['AR', 'AP'] as const;
export type Subledger = (typeof SUBLEDGERS)[number];
