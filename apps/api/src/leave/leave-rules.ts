import { LeaveType } from '@prisma/client';
import { LEAVE_TYPE_LABELS } from '@gpp/shared';

/**
 * Leave entitlements from the Leave and Holidays Policy (POL-14) and the Parental and
 * Family Policy (POL-15), carried over from the first build. Where a country's law gives more,
 * the law applies; those overrides are below.
 *
 * UNVERIFIED DRAFT. None of these numbers has been checked against current law by HR or a
 * lawyer in any country. The portal shows this status next to every balance, and nothing here
 * may be presented as a certified calculation until HR signs the pack off.
 */
export const LEAVE_RULES_VERSION = 'LEAVE-2026.1-draft';

export const LEAVE_RULE_PACK = {
  version: LEAVE_RULES_VERSION,
  status: 'UNVERIFIED' as const,
  summary: 'Draft company leave rules carried over from the first build. Not checked against current law in any country.',
  /** Countries whose public holidays the portal can draft; the rest start empty for HR to enter */
  draftHolidayCountries: ['KE', 'UG', 'TZ', 'ZA', 'EG', 'NG', 'MX', 'NZ'],
};

/** Balances are tracked from this year. Earlier leave was managed outside the portal. */
export const TRACKING_FROM_YEAR = 2026;

export const ANNUAL_CARRY_OVER_MAX = 5;
export const SICK_FULL_PAY_DAYS = 30;
export const SICK_HALF_PAY_DAYS = 30;
/** A medical certificate is needed for sick leave longer than this many working days */
export const SICK_CERTIFICATE_AFTER_DAYS = 2;
/** Unpaid leave is limited to about 3 months per request */
export const UNPAID_MAX_DAYS = 65;

export interface LeaveTypeInfo {
  type: LeaveType;
  label: string;
  /** Needs HR approval after the manager */
  hrApproval: boolean;
  /** Can be requested for days that have already passed */
  backdated: boolean;
  /** Counts against a yearly allowance (false: limited per request or per event) */
  yearly: boolean;
  note: string;
}

export const LEAVE_TYPES: LeaveTypeInfo[] = [
  { type: LeaveType.ANNUAL, label: LEAVE_TYPE_LABELS.ANNUAL, hrApproval: false, backdated: false, yearly: true, note: '21 working days a year, rising by 1 day for every 2 years of service to 25. Up to 5 unused days carry over.' },
  { type: LeaveType.SICK, label: LEAVE_TYPE_LABELS.SICK, hrApproval: false, backdated: true, yearly: true, note: '30 days on full pay, then 30 on half pay. A medical certificate is needed after 2 days in a row.' },
  { type: LeaveType.FLOATING, label: LEAVE_TYPE_LABELS.FLOATING, hrApproval: false, backdated: false, yearly: true, note: '2 days a year for religious or cultural observances.' },
  { type: LeaveType.FAMILY_CARE, label: LEAVE_TYPE_LABELS.FAMILY_CARE, hrApproval: false, backdated: true, yearly: true, note: 'Up to 5 paid days a year to care for a sick child or dependant.' },
  { type: LeaveType.COMPASSIONATE, label: LEAVE_TYPE_LABELS.COMPASSIONATE, hrApproval: false, backdated: true, yearly: false, note: 'Up to 5 days for the death of a close family member.' },
  { type: LeaveType.STUDY, label: LEAVE_TYPE_LABELS.STUDY, hrApproval: true, backdated: false, yearly: true, note: 'Up to 10 days a year under the Education and Training Policy.' },
  { type: LeaveType.MATERNITY, label: LEAVE_TYPE_LABELS.MATERNITY, hrApproval: true, backdated: false, yearly: false, note: '16 weeks on full pay, or longer where the law gives more. Also for the primary caregiver in adoption or surrogacy.' },
  { type: LeaveType.PATERNITY, label: LEAVE_TYPE_LABELS.PATERNITY, hrApproval: true, backdated: false, yearly: false, note: '4 weeks on full pay, taken within 6 months of the birth or adoption.' },
  { type: LeaveType.UNPAID, label: LEAVE_TYPE_LABELS.UNPAID, hrApproval: true, backdated: false, yearly: false, note: 'Up to 3 months with HR approval. Pay is reduced for each working day away.' },
];

export const leaveTypeInfo = (type: LeaveType) => LEAVE_TYPES.find((t) => t.type === type)!;

/** Maternity in working days: policy is 16 weeks; South Africa and Egypt give 4 months, New Zealand 26 weeks. */
const MATERNITY_DAYS: Record<string, number> = { ZA: 87, EG: 87, NZ: 130 };

/** Most working days one request (or event) of this type may cover */
export function perRequestLimit(type: LeaveType, countryCode: string): number | null {
  switch (type) {
    case LeaveType.MATERNITY:
      return MATERNITY_DAYS[countryCode] ?? 80;
    case LeaveType.PATERNITY:
      return 20;
    case LeaveType.COMPASSIONATE:
      return 5;
    case LeaveType.UNPAID:
      return UNPAID_MAX_DAYS;
    default:
      return null;
  }
}

/** Whole years of service completed by a date */
export function yearsOfService(hireDate: Date, on: Date): number {
  let years = on.getUTCFullYear() - hireDate.getUTCFullYear();
  const anniversary = new Date(Date.UTC(on.getUTCFullYear(), hireDate.getUTCMonth(), hireDate.getUTCDate()));
  if (on < anniversary) years -= 1;
  return Math.max(0, years);
}

/**
 * Mexico's Federal Labour Law (2023 reform): 12 days in year 1, +2 a year to 20 in year 5,
 * then +2 for every further 5 years.
 */
export function mexicoAnnualDays(completedYears: number): number {
  const year = completedYears + 1;
  if (year <= 5) return 10 + 2 * year;
  return 20 + 2 * Math.ceil((year - 5) / 5);
}

export interface PersonForLeave {
  countryCode: string;
  hireDate: Date;
  dateOfBirth?: Date | null;
}

/** Full-year annual leave in working days, before pro-rating and carry-over */
export function annualDaysFor(p: PersonForLeave, year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const service = yearsOfService(p.hireDate, jan1);
  let days = Math.min(25, 21 + Math.floor(service / 2));
  if (p.countryCode === 'MX') days = Math.max(days, mexicoAnnualDays(service));
  if (p.countryCode === 'EG') {
    // Egyptian law: 30 days after 10 years' service or from age 50
    const age = p.dateOfBirth ? yearsOfService(p.dateOfBirth, jan1) : 0;
    if (service >= 10 || age >= 50) days = Math.max(days, 30);
  }
  return days;
}

/** Annual leave for the year, pro-rated by whole months for someone who joined during it */
export function annualEntitlement(p: PersonForLeave, year: number): number {
  const full = annualDaysFor(p, year);
  if (p.hireDate.getUTCFullYear() > year) return 0;
  if (p.hireDate.getUTCFullYear() < year) return full;
  const months = 12 - p.hireDate.getUTCMonth();
  return Math.round((full * months) / 12);
}

/** Yearly allowance for the other yearly types */
export function yearlyAllowance(type: LeaveType): number {
  switch (type) {
    case LeaveType.SICK:
      return SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS;
    case LeaveType.FLOATING:
      return 2;
    case LeaveType.FAMILY_CARE:
      return 5;
    case LeaveType.STUDY:
      return 10;
    default:
      return 0;
  }
}
