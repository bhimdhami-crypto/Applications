/** Leave types and statuses, shared so the portal and the API use the same names */
export const LEAVE_TYPE_KEYS = ['ANNUAL', 'SICK', 'FLOATING', 'FAMILY_CARE', 'COMPASSIONATE', 'STUDY', 'MATERNITY', 'PATERNITY', 'UNPAID'] as const;
export type LeaveTypeKey = (typeof LEAVE_TYPE_KEYS)[number];

export const LEAVE_TYPE_LABELS: Record<LeaveTypeKey, string> = {
  ANNUAL: 'Annual leave',
  SICK: 'Sick leave',
  FLOATING: 'Floating holiday',
  FAMILY_CARE: 'Family care',
  COMPASSIONATE: 'Compassionate leave',
  STUDY: 'Study leave',
  MATERNITY: 'Maternity or primary caregiver',
  PATERNITY: 'Paternity or partner',
  UNPAID: 'Unpaid leave',
};

export const LEAVE_STATUS_KEYS = ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'DECLINED', 'CANCELLED'] as const;
export type LeaveStatusKey = (typeof LEAVE_STATUS_KEYS)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatusKey, string> = {
  PENDING_MANAGER: 'Waiting for manager',
  PENDING_HR: 'Waiting for HR',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};
