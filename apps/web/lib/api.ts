// Small fetch wrapper for the HR API. The sign-in token lives in sessionStorage,
// so closing the browser tab signs the user out.
export const API_URL = '/api';
const TOKEN_KEY = 'mindspace.token';

export type Role = 'ADMIN' | 'HR' | 'PAYROLL' | 'MANAGER' | 'EMPLOYEE' | 'FINANCE';

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
    hasPhoto?: boolean;
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
  /** BENEFIT: received in kind (meal card, gym, voucher), taxed but not paid in cash */
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER' | 'BENEFIT';
  amount: string;
  /** The loan, advance or IOU a deduction repays */
  ref?: string;
  /** An after-tax deduction the employee agreed to, not a statutory one */
  voluntary?: boolean;
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
  FINANCE: 'Finance',
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

// ---------- advances, loans, IOUs and benefits ----------

export type RequestStatus = 'PENDING' | 'APPROVED' | 'CLOSED' | 'DECLINED' | 'CANCELLED';
export type LoanKind = 'ADVANCE' | 'LOAN' | 'IOU';
export type LoanProduct = 'PERSONAL' | 'EDUCATION' | 'EMERGENCY' | 'HOUSING' | 'VEHICLE';

export interface Decision {
  stage: string;
  byName: string;
  at: string;
  approved: boolean;
  note: string | null;
}

export interface Loan {
  id: string;
  kind: LoanKind;
  product: LoanProduct | null;
  title: string;
  amount: string;
  currency: string;
  months: number;
  interestRate: number;
  instalment: string;
  firstMonthLabel: string | null;
  purpose: string;
  status: RequestStatus;
  stage: string | null;
  stageLabel: string | null;
  createdAt: string;
  settleBy: string | null;
  settledAt: string | null;
  guarantor: string | null;
  costCentre: string | null;
  neededOn: string | null;
  spent: string | null;
  cashReturned: string | null;
  settlementSubmittedAt: string | null;
  stages: string[];
  decisions: Decision[];
  outstanding: string;
  repaid: string;
  repayments: Array<{ id: string; label: string; amount: string; interest: string; source: string; note: string | null }>;
  upcoming: Array<{ label: string; payment: string; balance: string }>;
  canCancel: boolean;
  canSettle: boolean;
}

export interface LoanOptions {
  rulesVersion: string;
  currency: string;
  hasPayroll: boolean;
  gross: string | null;
  net: string | null;
  commitments: string;
  maxAdvance: string | null;
  maxLoan: string | null;
  maxHousingLoan: string | null;
  maxMonths: number;
  iouSettleDays: number;
  loanBlock: string | null;
  firstMonthLabel: string;
  products: Array<{ product: LoanProduct; label: string; yearlyRate: number; note: string }>;
}

export interface LoanQuote {
  currency: string;
  instalment: string;
  months: number;
  yearlyRate: number;
  totalInterest: string;
  firstMonthLabel: string;
  lastMonthLabel: string;
  takeHome: string | null;
  takeHomeFloor: string | null;
  stageLabels: string[];
  problems: string[];
}

export interface ApprovalItem {
  entity: 'loan' | 'enrolment' | 'voucher';
  id: string;
  title: string;
  employee: { id: string; name: string; employeeNo: string; company: string };
  amount: string | null;
  currency: string;
  details: string[];
  stage: string;
  stageLabel: string;
  stages: string[];
  decisions: Decision[];
  receipt?: boolean;
  createdAt: string;
}

export type BenefitKind = 'MEAL' | 'GYM';

export interface BenefitPlan {
  id: string;
  companyId: string;
  kind: BenefitKind;
  kindLabel: string;
  name: string;
  provider: string | null;
  description: string | null;
  companyShare: string;
  employeeShare: string;
  paidAsCash: boolean;
  workLocations: Employee['workLocation'][];
  active: boolean;
  currency: string;
  eligible?: boolean;
}

export interface Enrolment {
  id: string;
  kind: BenefitKind;
  kindLabel: string;
  plan: { id: string; name: string; provider: string | null; companyShare: string; employeeShare: string; paidAsCash: boolean };
  startLabel: string;
  endLabel: string | null;
  dietaryNeeds: string | null;
  branch: string | null;
  emergencyContact: string | null;
  status: RequestStatus;
  stageLabel: string | null;
  stages: string[];
  decisions: Decision[];
  canEnd: boolean;
  endsAtLabel: string | null;
  employee?: { id: string; name: string; employeeNo: string };
}

export type VoucherOccasion = 'BIRTHDAY' | 'LONG_SERVICE' | 'FESTIVE' | 'RECOGNITION' | 'WEDDING' | 'NEW_BABY' | 'OTHER';

export interface Voucher {
  id: string;
  occasion: VoucherOccasion;
  occasionLabel: string;
  value: string;
  currency: string;
  partner: string | null;
  reason: string | null;
  status: RequestStatus;
  stageLabel: string | null;
  taxMonthLabel: string | null;
  decisions: Decision[];
  createdAt: string;
  nominee?: string;
  employeeId?: string;
  canCancel?: boolean;
}

export const OCCASION_LABEL: Record<VoucherOccasion, string> = {
  BIRTHDAY: 'Birthday',
  LONG_SERVICE: 'Long service',
  FESTIVE: 'Festive season',
  RECOGNITION: 'Recognition',
  WEDDING: 'Wedding',
  NEW_BABY: 'New baby',
  OTHER: 'Other',
};

/** Status wording for loans, advances and IOUs */
export function loanStatus(l: Pick<Loan, 'kind' | 'status' | 'stageLabel' | 'settledAt' | 'outstanding'>) {
  if (l.status === 'PENDING') return `Waiting for ${l.stageLabel}`;
  if (l.status === 'APPROVED' && l.stageLabel) return 'Settlement waiting for Finance';
  if (l.status === 'APPROVED' && l.kind === 'IOU' && !l.settledAt) return 'Issued, to settle';
  if (l.status === 'APPROVED') return 'Repaying';
  if (l.status === 'CLOSED') return l.kind === 'IOU' ? 'Settled' : 'Repaid';
  return l.status === 'DECLINED' ? 'Declined' : 'Cancelled';
}

/** Status wording for benefit enrolments and vouchers */
export function benefitStatus(r: { status: RequestStatus; stageLabel: string | null; endLabel?: string | null }, issued = 'Active') {
  if (r.status === 'PENDING') return `Waiting for ${r.stageLabel}`;
  if (r.status === 'APPROVED') return r.endLabel ? `Ends ${r.endLabel}` : issued;
  if (r.status === 'CLOSED') return r.endLabel ? `Ended ${r.endLabel}` : 'Ended';
  return r.status === 'DECLINED' ? 'Declined' : 'Cancelled';
}

const STAGE_NAME: Record<string, string> = { MANAGER: 'Manager', HR: 'HR', PAYROLL: 'Payroll', FINANCE: 'Finance', COUNTRY_HEAD: 'Country Head' };

/** "Manager: Amina Hassan approved 22 Sep" lines for the approval trail */
export const trail = (decisions: Decision[]) =>
  decisions.map((d) => `${STAGE_NAME[d.stage] ?? d.stage}: ${d.byName} ${d.approved ? 'approved' : 'declined'} ${formatDate(d.at)}${d.note ? ` (${d.note})` : ''}`);

// ---------- Policies and forms, chat, community page, activity tracker ----------

export interface LibraryItem {
  id: string;
  kind: 'POLICY' | 'FORM';
  code: string;
  title: string;
  category: string;
  summary: string | null;
  owner: string | null;
  version: string;
  fileName: string;
  mustRead: boolean;
  active: boolean;
  publishedAt: string;
  readAt: string | null;
  readEarlier: boolean;
}

export interface Person {
  id: string;
  name: string;
  jobTitle: string;
  country: string | null;
}

export interface Conversation {
  id: string;
  kind: 'DIRECT' | 'GROUP';
  name: string;
  members: Person[];
  left: boolean;
  lastMessageAt: string;
  preview: { from: string; text: string } | null;
  unread: number;
}

export interface ChatMessage {
  id: string;
  sender: Person;
  mine: boolean;
  body: string | null;
  removed: string | null;
  createdAt: string;
}

export interface PostComment {
  id: string;
  author: Person;
  mine: boolean;
  body: string | null;
  removed: string | null;
  createdAt: string;
}

export interface Post extends PostComment {
  attachments: Array<{ index: number; mime: string; name: string; size: number }>;
  likes: number;
  liked: boolean;
  comments: PostComment[];
}

export interface ContentReport {
  id: string;
  target: 'MESSAGE' | 'POST' | 'COMMENT';
  targetId: string;
  status: 'OPEN' | 'REMOVED' | 'DISMISSED';
  reason: string;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reporter: Person;
  where: string;
  author: Person | null;
  body: string | null;
  removed: boolean;
}

export type WorkMode = 'OFFICE' | 'REMOTE' | 'FIELD';
export const MODE_LABEL: Record<WorkMode, string> = { OFFICE: 'In the office', REMOTE: 'Remote', FIELD: 'At a client or on site' };

export interface WorkSession {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  mode: WorkMode;
  minutes: number;
  autoClosed: boolean;
  edited: boolean;
  editReason: string | null;
}

export interface WorkLog {
  id: string;
  date: string;
  hours: number;
  project: string;
  description: string;
}

export interface ActivityWeek {
  today: string;
  timeZone: string;
  editableFrom: string;
  week: { start: string; end: string };
  open: WorkSession | null;
  days: Array<{ date: string; working: boolean; holiday: string | null; onLeave: boolean; sessions: WorkSession[]; logs: WorkLog[]; workedMinutes: number; loggedHours: number }>;
  totals: { workedMinutes: number; loggedHours: number; expectedHours: number };
}

/** 7h 05m */
export function hoursAndMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** A time of day in a given time zone, e.g. 08:05 */
export function timeIn(iso: string | null, timeZone: string) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** "2 minutes ago", "yesterday 14:05" style labels for chat and posts */
export function whenLabel(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `yesterday ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Opens a PDF or image the API serves in a new tab */
export async function openFile(path: string) {
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await apiBlob(path));
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Turns a date and a time of day in a time zone into an ISO timestamp */
export function zonedIso(date: string, time: string, timeZone: string) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (shown - guess)).toISOString();
}

export interface TeamActivity {
  date: string;
  companyId: string | null;
  timeZone: string;
  summary: { people: number; in: number; out: number; onLeave: number };
  rows: Array<{
    id: string; name: string; employeeNo: string; jobTitle: string; hasLogin: boolean;
    status: 'IN' | 'OUT' | 'ON_LEAVE' | 'NOT_STARTED'; mode: WorkMode | null;
    firstIn: string | null; lastOut: string | null; workedMinutes: number; weekMinutes: number;
    flags: string[]; logs: WorkLog[];
  }>;
  truncated: boolean;
}

export interface ActivityReport {
  month: string;
  expectedHours: number;
  rows: Array<{ employeeNo: string; name: string; daysPresent: number; hoursWorked: number; hoursLogged: number; overExpected: number; forgotClockOut: number; edited: number }>;
}

// ---------------------------------------------------------------------------
// Workforce analytics, organisation, recruitment, performance and audit
// ---------------------------------------------------------------------------

export interface Count { label: string; value: number }

export interface EntitySummary {
  companyId: string;
  code: string;
  name: string;
  country: string;
  countryCode: string;
  currency: string;
  headcount: number;
  hires12m: number;
  exits12m: number;
  latestRun: { id: string; periodYear: number; periodMonth: number; status: PayrollRun['status']; totalNet: string; payslips: number } | null;
  lastPayroll: { periodYear: number; periodMonth: number; totalGross: string; totalNet: string; employerCost: string; payslips: number } | null;
}

export interface Workforce {
  asOf: string;
  totals: {
    headcount: number;
    hires12m: number;
    exits12m: number;
    attritionRate: number;
    avgTenureYears: number;
    avgAge: number;
    remoteShare: number;
    managers: number;
    onLeaveToday: number;
    documentsToVerify: number;
    documentsExpired: number;
    openPositions: number;
  };
  byCompany: EntitySummary[];
  byDepartment: Count[];
  byLocation: Count[];
  byContract: Count[];
  byGender: Count[];
  byGrade: Count[];
  tenure: Count[];
  age: Count[];
  exitReasons: Count[];
  monthly: { label: string; hires: number; exits: number }[];
}

export interface OrgNode {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  grade: string | null;
  workLocation: Employee['workLocation'];
  companyId: string;
  company: { code: string; countryCode: string; name: string };
  hasPhoto: boolean;
  reportCount: number;
}

export interface OrgEntity {
  id: string;
  code: string;
  name: string;
  country: string;
  countryCode: string;
  currency: string;
  headcount: number;
  departments: number;
  payrollRules: { version: string; verified: boolean } | null;
}

export type OpeningStatus = 'OPEN' | 'ON_HOLD' | 'FILLED' | 'CLOSED';
export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export const STAGES: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
export const STAGE_LABEL: Record<CandidateStage, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Not progressing',
  WITHDRAWN: 'Withdrew',
};

export interface JobOpening {
  id: string;
  reference: string;
  title: string;
  department: string;
  workLocation: Employee['workLocation'];
  employmentType: Profile['employmentType'];
  grade: string | null;
  city: string | null;
  positions: number;
  salaryMin: string | null;
  salaryMax: string | null;
  description: string | null;
  status: OpeningStatus;
  closesOn: string | null;
  createdAt: string;
  companyId: string;
  company: { name: string; countryCode: string; currency: string };
  hiringManagerId: string | null;
  hiringManager: { id: string; firstName: string; lastName: string; jobTitle: string } | null;
  pipeline?: Record<CandidateStage, number>;
  candidates?: number;
}

export interface Candidate {
  id: string;
  openingId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string;
  stage: CandidateStage;
  rating: number | null;
  notes: string | null;
  employeeId: string | null;
  employee: { id: string; employeeNo: string } | null;
  stageChangedAt: string;
  createdAt: string;
}

export interface ReviewPerson { id: string; employeeNo: string; firstName: string; lastName: string; jobTitle: string; department: string; hasPhoto: boolean }

export interface ReviewCycle {
  id: string;
  name: string;
  companyId: string;
  company: { name: string; countryCode: string };
  periodStart: string;
  periodEnd: string;
  selfDueOn: string;
  managerDueOn: string;
  status: 'OPEN' | 'CLOSED';
  progress: { total: number; selfReview: number; managerReview: number; completed: number };
  ratings: { rating: number; label: string; count: number }[];
}

export interface Review {
  id: string;
  cycleId: string;
  cycle: { id: string; name: string; status: 'OPEN' | 'CLOSED'; selfDueOn: string; managerDueOn: string; periodStart: string; periodEnd: string };
  employee: ReviewPerson;
  reviewer: ReviewPerson | null;
  status: 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'COMPLETED';
  selfRating: number | null;
  selfComments: string | null;
  managerRating: number | null;
  managerComments: string | null;
  selfSubmittedAt: string | null;
  completedAt: string | null;
}

export interface Goal {
  id: string;
  employeeId: string;
  cycleId: string | null;
  cycle: { name: string } | null;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  dueOn: string | null;
}

export const RATING_LABEL: Record<number, string> = {
  1: 'Below expectations',
  2: 'Partly meets expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Exceptional',
};

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
  createdAt: string;
  actor: { email: string; role: Role; name: string | null } | null;
}

/** Short money for tiles: KES 829.3M */
export function compactMoney(value: string | number | undefined, currency: string) {
  if (value === undefined) return '';
  return `${currency} ${new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}`;
}
