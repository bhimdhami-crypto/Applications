// Small fetch wrapper for the HR API. The sign-in token lives in sessionStorage,
// so closing the browser tab signs the user out.
export const API_URL = '/api';
const TOKEN_KEY = 'mindspace.token';

export type Role = 'ADMIN' | 'HR' | 'PAYROLL' | 'MANAGER' | 'EMPLOYEE';

export interface Company {
  id: string;
  code: string;
  name: string;
  country: string;
  countryCode: string;
  currency: string;
  payrollRules: { version: string; verified: boolean } | null;
}

export interface Me {
  id: string;
  email: string;
  role: Role;
  employee: null | {
    id: string;
    employeeNo: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    department: string;
    workLocation: string;
    hireDate: string;
    company: { name: string; currency: string; countryCode: string };
  };
}

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  grade?: string | null;
  city?: string | null;
  workEmail?: string | null;
  workLocation: 'ON_SITE' | 'HYBRID' | 'FULLY_REMOTE';
  hireDate: string;
  exitDate: string | null;
  status: 'ACTIVE' | 'TERMINATED';
  companyId: string;
  managerId: string | null;
  monthlyBasic?: string;
  monthlyAllowances?: string;
  company: { name: string; countryCode: string; currency: string };
  user: { email: string; role: Role; isActive: boolean } | null;
}

export interface PayLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  amount: string;
}

export interface Payslip {
  id: string;
  runId: string;
  currency: string;
  gross: string;
  deductions: string;
  net: string;
  employerCost: string;
  lines: PayLine[];
  annualLeaveLeft?: number | null;
  employee?: { employeeNo: string; firstName: string; lastName: string; jobTitle: string };
  run?: { periodYear: number; periodMonth: number; company?: { name: string } };
}

export interface PayrollRun {
  id: string;
  companyId: string;
  periodYear: number;
  periodMonth: number;
  status: 'DRAFT' | 'APPROVED' | 'FINALIZED';
  rulesPack: string;
  rulesVersion: string;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCost: string;
  approvedAt: string | null;
  finalizedAt: string | null;
  company: { name: string; currency: string; countryCode: string };
  _count?: { payslips: number };
  payslips?: Payslip[];
  rulesVerified?: boolean;
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

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      // For uploads the browser sets the multipart boundary itself
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the website could not reach the API server (stopped, restarting or unreachable).
    throw new ApiError(res.status, 'The portal server is not responding. Check that "npm run dev:api" is running, then try again.');
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** Fetches a file (photo, document) with the sign-in token, which a plain <img> or link cannot send. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.message ?? 'Could not load the file');
  }
  return res.blob();
}

export async function downloadFile(path: string, fileName: string) {
  const url = URL.createObjectURL(await apiBlob(path));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NextOfKin {
  id?: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string | null;
  isEmergencyContact: boolean;
  isBeneficiary: boolean;
}

export interface Profile {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  grade: string | null;
  employmentType: 'PERMANENT' | 'FIXED_TERM' | 'INTERN';
  workLocation: Employee['workLocation'];
  city: string | null;
  workEmail: string | null;
  hireDate: string;
  exitDate: string | null;
  status: Employee['status'];
  hasPhoto: boolean;
  company: { name: string; countryCode: string; currency: string };
  manager: { id: string; firstName: string; lastName: string; jobTitle: string } | null;
  user: { email: string; role: Role; isActive: boolean } | null;
  access: 'FULL' | 'SELF' | 'MANAGER';
  can: { editPersonal: boolean; editJob: boolean; viewDocuments: boolean; uploadDocuments: boolean; verifyDocuments: boolean };
  // Not sent to managers
  mobilePhone?: string | null;
  personalEmail?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  maritalStatus?: string | null;
  dependants?: number;
  nationalIdNumber?: string | null;
  taxId?: string | null;
  socialSecurityNo?: string | null;
  highestQualification?: string | null;
  institution?: string | null;
  qualificationYear?: number | null;
  exitReason?: string | null;
  monthlyBasic?: string;
  monthlyAllowances?: string;
  nextOfKin?: NextOfKin[];
}

export type DocumentStatus = 'PENDING' | 'VERIFIED' | 'CLEARED' | 'EXPIRED' | 'REJECTED';

export interface HrDocument {
  id: string;
  type: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  issuedDate: string | null;
  expiryDate: string | null;
  status: DocumentStatus;
  hrOnly: boolean;
  hasFile: boolean;
  createdAt: string;
}

export const EMPLOYMENT_TYPE_LABEL: Record<Profile['employmentType'], string> = {
  PERMANENT: 'Permanent',
  FIXED_TERM: 'Fixed-term contract',
  INTERN: 'Intern',
};

export const formatDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodName = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

export function money(amount: string | number | undefined, currency: string) {
  if (amount === undefined) return '';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(amount));
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  HR: 'HR',
  PAYROLL: 'Payroll',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

export const LOCATION_LABEL: Record<Employee['workLocation'], string> = {
  ON_SITE: 'On site',
  HYBRID: 'Hybrid',
  FULLY_REMOTE: 'Fully remote',
};

/** Plain amount for tables whose header already names the currency. */
export function amount(value: string | number | undefined) {
  if (value === undefined) return '';
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

export type LeaveType = 'ANNUAL' | 'SICK' | 'FLOATING' | 'FAMILY_CARE' | 'COMPASSIONATE' | 'STUDY' | 'MATERNITY' | 'PATERNITY' | 'UNPAID';
export type LeaveStatus = 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'DECLINED' | 'CANCELLED';

export interface LeaveTypeInfo {
  type: LeaveType;
  label: string;
  hrApproval: boolean;
  backdated: boolean;
  yearly: boolean;
  note: string;
}

export interface LeaveBalance {
  type: LeaveType;
  label: string;
  entitlement: number | null;
  carriedOver: number;
  adjustment: number;
  approved: number;
  pending: number;
  left: number | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  handoverTo: string | null;
  contactWhileAway: string | null;
  documentId: string | null;
  status: LeaveStatus;
  managerNote: string | null;
  hrNote: string | null;
  createdAt: string;
  canCancel?: boolean;
  employee?: { id: string; firstName: string; lastName: string; employeeNo: string; company: { countryCode: string; name: string } };
  waitingDays?: number;
  overdue?: boolean;
}

export interface Holiday {
  id?: string;
  date: string;
  name: string;
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING_MANAGER: 'Waiting for manager',
  PENDING_HR: 'Waiting for HR',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};

export const COUNTRY_NAME: Record<string, string> = {
  KE: 'Kenya', UG: 'Uganda', TZ: 'Tanzania', ZA: 'South Africa', EG: 'Egypt', NG: 'Nigeria', MX: 'Mexico', NZ: 'New Zealand',
};

/** Short date range, e.g. "2 to 6 Nov 2026" */
export function dateRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  const s = new Date(start);
  const e = new Date(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', timeZone: 'UTC', ...(sameMonth ? {} : { month: 'short' }), ...(sameYear ? {} : { year: 'numeric' }) };
  return `${s.toLocaleDateString('en-GB', opts)} to ${formatDate(end)}`;
}
