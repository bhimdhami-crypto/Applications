/** Feature modules a company can switch on or off without affecting other companies */
export const FEATURE_MODULES = [
  { key: 'people', label: 'Employee records', alwaysOn: true },
  { key: 'leave', label: 'Leave and absence', alwaysOn: false },
  { key: 'attendance', label: 'Time and attendance', alwaysOn: false },
  { key: 'payroll', label: 'Payroll', alwaysOn: false },
  { key: 'expenses', label: 'Expenses', alwaysOn: false },
  { key: 'loans', label: 'Salary advances and loans', alwaysOn: false },
  { key: 'recruitment', label: 'Recruitment', alwaysOn: false },
  { key: 'performance', label: 'Performance and goals', alwaysOn: false },
  { key: 'learning', label: 'Learning', alwaysOn: false },
  { key: 'assistant', label: 'AI HR assistant', alwaysOn: false },
  { key: 'integrations', label: 'Oracle and SAP integration', alwaysOn: false },
] as const;

export type FeatureModuleKey = (typeof FEATURE_MODULES)[number]['key'];
