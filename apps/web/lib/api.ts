// Small fetch wrapper for the HR API. The sign-in token lives in sessionStorage,
// so closing the browser tab signs the user out.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
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
    company: { name: string; currency: string };
  };
}

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
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
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

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
