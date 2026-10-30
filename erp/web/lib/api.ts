// Small fetch wrapper for the ERP API. The sign-in token lives in sessionStorage,
// so closing the browser tab signs the user out.
const TOKEN_KEY = 'mfi-erp.token';

export type Role = 'ADMIN' | 'DIRECTOR' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'VIEWER';
export type VoucherStatus = 'DRAFT' | 'SUBMITTED' | 'REJECTED' | 'POSTED' | 'CANCELLED';

export interface User {
  id: number;
  email: string;
  /** Only the sign-in response carries the name */
  name?: string;
  role: Role;
}

export interface Company {
  id: number;
  code: string;
  name: string;
  homeCurrency: string;
}

export interface Account {
  id: number;
  code: string;
  description: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  isPostable: boolean;
  isActive: boolean;
  /** AR on Debtors Control, AP on Creditors Control */
  subledger: 'AR' | 'AP' | null;
}

export type PartyKind = 'CUSTOMER' | 'SUPPLIER';

export interface Party {
  id: number;
  kind: PartyKind;
  code: string;
  name: string;
  currencyCode: string | null;
  termsDays: number;
  creditLimit: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface VoucherLine {
  lineNo: number;
  accountId: number | null;
  debit: string;
  credit: string;
  currencyCode: string | null;
  exchangeRate: string | null;
  foreignAmount: string | null;
  description: string | null;
  partnerCompanyId: number | null;
  partnerAccountId: number | null;
  partyId: number | null;
  dueDate: string | null;
  account: { code: string; description: string } | null;
  party: { code: string; name: string; kind: PartyKind } | null;
  partnerCompany: { code: string } | null;
  partnerAccount: { code: string; description: string } | null;
}

export interface ApprovalAction {
  id: number;
  action: string;
  stageNo: number | null;
  comment: string | null;
  at: string;
  user: { name: string };
}

export interface Attachment {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  description: string | null;
  uploadedAt: string;
}

export interface VoucherSummary {
  id: number;
  voucherNo: string;
  documentType: string;
  status: VoucherStatus;
  txDate: string;
  description: string;
  reference: string | null;
  totalAmount: string;
  currentStage: number | null;
  createdBy: { name: string };
}

export interface Voucher extends VoucherSummary {
  createdById: number;
  lines: VoucherLine[];
  actions: ApprovalAction[];
  rule: { name: string; sopReference: string | null; stages: { stageNo: number; name: string; approverRole: Role }[] } | null;
  postedBatch: { auditNo: string } | null;
  attachments: Attachment[];
}

export interface PendingVoucher extends VoucherSummary {
  company: { code: string };
  stage?: string;
  sopReference?: string | null;
  submittedAt: string;
}

export interface ArchiveHit {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  description: string | null;
  uploadedAt: string;
  voucherNo: string | null;
}

export interface TrialBalance {
  currency: string;
  rows: { accountId: number; code: string; description: string; type: string; debit: string; credit: string; balance: string }[];
  totalDebit: string;
  totalCredit: string;
}

export type Buckets = Record<'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90', string>;

export interface GeneralLedgerRow {
  txDate: string;
  auditNo: string;
  voucherNo: string | null;
  reference: string | null;
  documentType: string;
  description: string | null;
  party: string | null;
  currencyCode: string;
  foreignAmount: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface GeneralLedger {
  currency: string;
  from: string;
  to: string;
  accounts: {
    accountId: number;
    code: string;
    description: string;
    type: string;
    opening: string;
    debit: string;
    credit: string;
    closing: string;
    rows: GeneralLedgerRow[];
  }[];
  totalDebit: string;
  totalCredit: string;
}

export interface AgedReport {
  currency: string;
  kind: PartyKind;
  asAt: string;
  controlAccounts: string[];
  rows: ({ partyId: number; code: string; name: string; termsDays: number; creditLimit: string | null; overLimit: boolean; balance: string } & Buckets)[];
  totals: Buckets;
  total: string;
  controlBalance: string;
  difference: string;
}

export interface Statement {
  currency: string;
  party: { id: number; kind: PartyKind; code: string; name: string; termsDays: number; email: string | null };
  from: string;
  to: string;
  opening: string;
  rows: { txDate: string; dueDate: string | null; auditNo: string; voucherNo: string | null; reference: string | null; description: string | null; debit: string; credit: string; balance: string }[];
  closing: string;
  ageing: Buckets;
  openItems: { txDate: string; dueDate: string; auditNo: string; reference: string | null; description: string | null; amount: string; open: string; daysOverdue: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
  else window.sessionStorage.removeItem(TOKEN_KEY);
}

async function send(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = getToken();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      // For uploads the browser sets the multipart boundary itself
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? msg);
    } catch {
      msg = 'The ERP server is not responding. Check that "npm run dev:api" is running, then try again.';
    }
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await send(path, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Downloads an archived file with the sign-in token and hands it to the browser */
export async function download(company: string, attachment: { id: number; fileName: string }) {
  const res = await send(`/companies/${company}/archive/${attachment.id}/download`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
