import type { Permission, Role, ScopeType } from '@gpp/shared';

export interface Me {
  user: { id: string; email: string; displayName: string; preferredLanguage: string | null; lastLoginAt: string | null };
  group: { id: string; code: string; name: string; reportingCurrency: string; defaultLanguage: string };
  roles: { id: string; role: Role; scopeType: ScopeType; countryCode: string | null; legalEntityId: string | null; label: string; scopeLabel: string }[];
  permissions: Partial<Record<Permission, { group: boolean; legalEntityIds: string[] }>>;
  entities: { id: string; code: string; name: string; countryCode: string; functionalCurrency: string; defaultLanguage: string; status: string; features: { module: string; enabled: boolean }[] }[];
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export type Status = 'ACTIVE' | 'INACTIVE';

export interface Country {
  code: string;
  name: string;
  currencyCode: string;
  languages: string[];
  timeZone: string;
  weekendDays: number[];
  region: string;
  isActive: boolean;
  entityCount?: number;
  currency?: Currency;
}

export interface Currency {
  code: string;
  name: string;
  decimals: number;
  symbol: string;
  isActive: boolean;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  status: Status;
}

export interface EntityDetail {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  country: Country;
  functionalCurrency: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  address: string | null;
  timeZone: string;
  weekendDays: number[];
  defaultLanguage: string;
  fiscalYearStartMonth: number;
  isSharedServiceCentre: boolean;
  status: Status;
  businessUnits: Unit[];
  branches: (Unit & { city: string; address: string | null })[];
  departments: (Unit & { businessUnit: { name: string } | null; branch: { name: string } | null })[];
  costCentres: (Unit & { glCode: string | null; department: { name: string } | null })[];
  features: { module: string; label: string; alwaysOn: boolean; enabled: boolean }[];
}

export interface EntitySummary {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  functionalCurrency: string;
  isSharedServiceCentre: boolean;
  status: Status;
  country: { name: string };
  _count: { businessUnits: number; branches: number; departments: number; costCentres: number };
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  invitePending: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  roles: Me['roles'];
}

export interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  legalEntityId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
  actor: { displayName: string; email: string } | null;
}

// ───── People ─────

export interface EmployeeRow {
  id: string;
  employeeNumber: string;
  name: string;
  localName: string | null;
  personId: string;
  status: 'ACTIVE' | 'TERMINATED';
  hireDate: string;
  endDate: string | null;
  workEmail: string | null;
  entity: { id: string; code: string; name: string; countryCode: string };
  jobTitle: string | null;
  grade: string | null;
  department: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  level?: number;
}

export interface Job {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  jobTitle: string;
  grade: { code: string; name: string } | null;
  businessUnit: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  branch: { id: string; name: string; city: string } | null;
  costCentre: { id: string; code: string; name: string } | null;
  manager: { id: string; employeeNumber: string; name: string } | null;
  fte: string;
}

export interface PersonContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
  isEmergencyContact: boolean;
  isBeneficiary: boolean;
}

export interface EmployeeProfile {
  id: string;
  employeeNumber: string;
  status: 'ACTIVE' | 'TERMINATED';
  employmentType: 'PERMANENT' | 'FIXED_TERM' | 'INTERN';
  workLocation: 'ON_SITE' | 'HYBRID' | 'FULLY_REMOTE';
  hireDate: string;
  probationEndDate: string | null;
  endDate: string | null;
  exitReason: string | null;
  workEmail: string | null;
  hasAccount: boolean;
  entity: { id: string; code: string; name: string; countryCode: string; functionalCurrency: string };
  person: { id: string; personNumber: string; firstName: string; lastName: string; localName: string | null; preferredName: string | null; hasPhoto: boolean };
  personal: null | {
    gender: string | null;
    dateOfBirth: string | null;
    nationality: string | null;
    maritalStatus: string | null;
    dependants: number;
    personalEmail: string | null;
    mobilePhone: string | null;
    highestQualification: string | null;
    institution: string | null;
    qualificationYear: number | null;
    contacts: PersonContact[];
  };
  job: Job | null;
  directReports: number;
  relation: 'HR' | 'SELF' | 'MANAGER';
  can: {
    viewPersonal: boolean;
    editPersonal: boolean;
    editNames: boolean;
    editJob: boolean;
    viewPay: boolean;
    editPay: boolean;
    revealSensitive: boolean;
    viewDocuments: boolean;
    uploadDocuments: boolean;
    verifyDocuments: boolean;
    requestBankChange: boolean;
    terminate: boolean;
  };
}

export interface PayInfo {
  compensation: { id: string; effectiveFrom: string; effectiveTo: string | null; currency: string; payFrequency: string; baseAmount: string; allowances: string; reason: string }[];
  bankAccounts: { id: string; bankName: string; branchCode: string | null; accountName: string; accountNumber: string; currency: string; effectiveFrom: string; effectiveTo: string | null }[];
  identifiers: { id: string; kind: string; countryCode: string; value: string; expiryDate: string | null }[];
}

export interface EmployeeDocument {
  id: string;
  type: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  issuedDate: string | null;
  expiryDate: string | null;
  status: 'PENDING' | 'VERIFIED' | 'CLEARED' | 'EXPIRED' | 'REJECTED';
  hrOnly: boolean;
  hasFile: boolean;
  createdAt: string;
  verifiedAt: string | null;
}

export interface ChangeRequest {
  id: string;
  kind: string;
  summary: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedById: string;
  employee: { id: string; employeeNumber: string; name: string; entity: { code: string; name: string } };
}

export interface Headcount {
  asOf: string;
  total: number;
  countries: { countryCode: string; active: number; left: number }[];
  companies: { id: string; code: string; name: string; countryCode: string; active: number; left: number; departments: { id: string; code: string; name: string; active: number }[] }[];
}

export type LeaveType = import('@gpp/shared').LeaveTypeKey;
export type LeaveStatus = import('@gpp/shared').LeaveStatusKey;

export interface LeaveRulePack {
  version: string;
  status: 'UNVERIFIED';
  summary: string;
  draftHolidayCountries: string[];
}

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
  rulesVersion: string;
  createdAt: string;
  canCancel: boolean;
  employee: { id: string; employeeNumber: string; name: string; entity: { code: string; name: string } };
  approver: { id: string; name: string } | null;
  waitingDays?: number;
  overdue?: boolean;
  step?: 'manager' | 'hr';
}

export interface Holiday {
  id: string;
  countryCode: string;
  date: string;
  name: string;
  source: 'DRAFT' | 'MANUAL';
}

export type LoanKind = 'ADVANCE' | 'LOAN' | 'IOU';
export type LoanProduct = 'PERSONAL' | 'EDUCATION' | 'EMERGENCY' | 'HOUSING' | 'VEHICLE';
export type RequestStatusKey = 'PENDING' | 'APPROVED' | 'CLOSED' | 'DECLINED' | 'CANCELLED';

export interface Decision {
  stage: string;
  byName: string;
  at: string;
  approved: boolean;
  note: string | null;
}

export interface RulePackInfo {
  version: string;
  status: 'UNVERIFIED';
  summary: string;
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
  status: RequestStatusKey;
  stage: string | null;
  stageLabel: string | null;
  rulesVersion: string;
  createdAt: string;
  settleBy: string | null;
  settledAt: string | null;
  guarantor: string | null;
  costCentre: string | null;
  neededOn: string | null;
  spent: string | null;
  cashReturned: string | null;
  stages: string[];
  decisions: Decision[];
  outstanding: string;
  repaid: string;
  repayments: { id: string; label: string; amount: string; interest: string; source: string; note: string | null }[];
  upcoming: { label: string; payment: string; balance: string }[];
  canCancel: boolean;
  canSettle: boolean;
  hasReceipt: boolean;
}

export interface LoanOptions {
  rulePack: RulePackInfo;
  payrollPack: { version: string; verified: boolean } | null;
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
  products: { product: LoanProduct; label: string; yearlyRate: number; note: string }[];
}

export interface LoanQuote {
  instalment: string;
  months: number;
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
  employee: { id: string; name: string; employeeNumber: string; entity: { code: string; name: string } };
  amount: string | null;
  currency: string;
  details: string[];
  stage: string;
  stageLabel: string;
  stages: string[];
  decisions: Decision[];
  receipt: boolean;
  rulesVersion: string | null;
  createdAt: string;
}

export type BenefitKind = 'MEAL' | 'GYM';
export type VoucherOccasion = 'BIRTHDAY' | 'LONG_SERVICE' | 'FESTIVE' | 'RECOGNITION' | 'WEDDING' | 'NEW_BABY' | 'OTHER';
export type WorkLocation = 'ON_SITE' | 'HYBRID' | 'FULLY_REMOTE';

export interface BenefitPlan {
  id: string;
  entityId: string;
  kind: BenefitKind;
  kindLabel: string;
  name: string;
  provider: string | null;
  description: string | null;
  companyShare: string;
  employeeShare: string;
  paidAsCash: boolean;
  workLocations: WorkLocation[];
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
  status: RequestStatusKey;
  stageLabel: string | null;
  stages: string[];
  decisions: Decision[];
  canEnd: boolean;
  endsAtLabel: string | null;
  employee?: { id: string; name: string; employeeNumber: string };
}

export interface Voucher {
  id: string;
  occasion: VoucherOccasion;
  occasionLabel: string;
  value: string;
  currency: string;
  partner: string | null;
  reason: string | null;
  status: RequestStatusKey;
  stageLabel: string | null;
  taxMonthLabel: string | null;
  decisions: Decision[];
  createdAt: string;
  nominee?: string;
  canCancel?: boolean;
  employee?: { id: string; name: string; employeeNumber: string };
}
