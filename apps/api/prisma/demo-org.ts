/**
 * The demo organisation: Mindspace Artificial Intelligence Inc. across fifteen countries.
 * All names are fictional. Registration and tax numbers are left blank on purpose.
 */
export interface DemoEntity {
  code: string;
  name: string;
  countryCode: string;
  isSharedServiceCentre?: boolean;
  /** Branch cities */
  cities: string[];
}

export const DEMO_ENTITIES: DemoEntity[] = [
  { code: 'KE01', name: 'Mindspace Artificial Intelligence Kenya Ltd', countryCode: 'KE', cities: ['Nairobi', 'Mombasa', 'Kisumu'] },
  { code: 'KE02', name: 'Mindspace Artificial Intelligence Shared Services Africa Ltd', countryCode: 'KE', isSharedServiceCentre: true, cities: ['Nairobi'] },
  { code: 'UG01', name: 'Mindspace Artificial Intelligence Uganda Ltd', countryCode: 'UG', cities: ['Kampala', 'Entebbe', 'Jinja'] },
  { code: 'TZ01', name: 'Mindspace Artificial Intelligence Tanzania Ltd', countryCode: 'TZ', cities: ['Dar es Salaam', 'Arusha', 'Dodoma'] },
  { code: 'EG01', name: 'Mindspace Artificial Intelligence Egypt S.A.E.', countryCode: 'EG', cities: ['Cairo', 'Alexandria', 'Giza'] },
  { code: 'FR01', name: 'Mindspace Artificial Intelligence France SAS', countryCode: 'FR', cities: ['Paris', 'Lyon'] },
  { code: 'IN01', name: 'Mindspace Artificial Intelligence India Pvt Ltd', countryCode: 'IN', cities: ['Bengaluru', 'Mumbai'] },
  { code: 'IN02', name: 'Mindspace Artificial Intelligence Global Delivery Centre India Pvt Ltd', countryCode: 'IN', isSharedServiceCentre: true, cities: ['Pune', 'Hyderabad'] },
  { code: 'CN01', name: 'Mindspace Artificial Intelligence China Co., Ltd.', countryCode: 'CN', cities: ['Shanghai', 'Shenzhen'] },
  { code: 'AU01', name: 'Mindspace Artificial Intelligence Australia Pty Ltd', countryCode: 'AU', cities: ['Sydney', 'Melbourne'] },
  { code: 'NL01', name: 'Mindspace Artificial Intelligence Netherlands B.V.', countryCode: 'NL', cities: ['Amsterdam', 'Rotterdam'] },
  { code: 'NL02', name: 'Mindspace Artificial Intelligence Europe Holding B.V.', countryCode: 'NL', cities: ['Amsterdam'] },
  { code: 'JP01', name: 'Mindspace Artificial Intelligence Japan K.K.', countryCode: 'JP', cities: ['Tokyo', 'Osaka'] },
  { code: 'KR01', name: 'Mindspace Artificial Intelligence Korea Ltd.', countryCode: 'KR', cities: ['Seoul', 'Busan'] },
  // Countries carried over from the first Mindspace build
  { code: 'ZA01', name: 'Mindspace Artificial Intelligence South Africa (Pty) Ltd', countryCode: 'ZA', cities: ['Johannesburg', 'Cape Town', 'Durban'] },
  { code: 'NG01', name: 'Mindspace Artificial Intelligence Nigeria Ltd', countryCode: 'NG', cities: ['Lagos', 'Abuja', 'Port Harcourt'] },
  { code: 'MX01', name: 'Mindspace Artificial Intelligence Mexico S. de R.L. de C.V.', countryCode: 'MX', cities: ['Mexico City', 'Guadalajara', 'Monterrey'] },
  { code: 'NZ01', name: 'Mindspace Artificial Intelligence New Zealand Limited', countryCode: 'NZ', cities: ['Auckland', 'Wellington', 'Christchurch'] },
];

export const DEMO_BUSINESS_UNITS = [
  { code: 'TECH', name: 'Technology' },
  { code: 'COMM', name: 'Commercial' },
  { code: 'CORP', name: 'Corporate Services' },
];

export const DEMO_DEPARTMENTS: { code: string; name: string; bu: string }[] = [
  { code: 'ENG', name: 'Engineering', bu: 'TECH' },
  { code: 'DAI', name: 'Data and AI', bu: 'TECH' },
  { code: 'PRD', name: 'Product', bu: 'TECH' },
  { code: 'ITS', name: 'IT and Security', bu: 'TECH' },
  { code: 'SAL', name: 'Sales', bu: 'COMM' },
  { code: 'MKT', name: 'Marketing', bu: 'COMM' },
  { code: 'CSU', name: 'Customer Success', bu: 'COMM' },
  { code: 'FIN', name: 'Finance', bu: 'CORP' },
  { code: 'HRM', name: 'People and HR', bu: 'CORP' },
  { code: 'LEG', name: 'Legal and Compliance', bu: 'CORP' },
  { code: 'OPS', name: 'Operations', bu: 'CORP' },
];

/** Shared service centres run back-office functions only */
export const SHARED_SERVICE_DEPARTMENTS = ['FIN', 'HRM', 'ITS', 'OPS'];

/** Feature modules switched on for every demo company; payroll is on except where noted */
export const DEMO_FEATURES = ['leave', 'attendance', 'payroll', 'expenses', 'loans', 'performance', 'learning', 'assistant'];
export const NO_PAYROLL = ['NL02'];

export interface DemoUser {
  email: string;
  displayName: string;
  roles: { role: string; scopeType: 'GROUP' | 'COUNTRY' | 'LEGAL_ENTITY'; countryCode?: string; entityCode?: string }[];
}

/** Test accounts. Every address uses the reserved .test domain, so mail can only reach the local inbox. */
export const DEMO_USERS: DemoUser[] = [
  { email: 'admin@mindspace.test', displayName: 'Grace Admin', roles: [{ role: 'GROUP_ADMIN', scopeType: 'GROUP' }] },
  { email: 'hr.global@mindspace.test', displayName: 'Henri Global-HR', roles: [{ role: 'HR_ADMIN', scopeType: 'GROUP' }] },
  { email: 'hr.kenya@mindspace.test', displayName: 'Wanjiru Kenya-HR', roles: [{ role: 'HR_ADMIN', scopeType: 'COUNTRY', countryCode: 'KE' }] },
  { email: 'hr.france@mindspace.test', displayName: 'Camille France-HR', roles: [{ role: 'HR', scopeType: 'COUNTRY', countryCode: 'FR' }] },
  { email: 'hr.india@mindspace.test', displayName: 'Priya India-HR', roles: [{ role: 'HR', scopeType: 'LEGAL_ENTITY', entityCode: 'IN01' }] },
  { email: 'payroll.kenya@mindspace.test', displayName: 'Brian Kenya-Payroll', roles: [{ role: 'PAYROLL_OPERATOR', scopeType: 'COUNTRY', countryCode: 'KE' }] },
  { email: 'approver.kenya@mindspace.test', displayName: 'Achieng Kenya-Approver', roles: [{ role: 'PAYROLL_APPROVER', scopeType: 'COUNTRY', countryCode: 'KE' }] },
  { email: 'finance@mindspace.test', displayName: 'Farid Group-Finance', roles: [{ role: 'FINANCE', scopeType: 'GROUP' }] },
  { email: 'treasury@mindspace.test', displayName: 'Tomoko Treasury', roles: [{ role: 'TREASURY', scopeType: 'GROUP' }] },
  { email: 'auditor@mindspace.test', displayName: 'Anouk Auditor', roles: [{ role: 'AUDITOR', scopeType: 'GROUP' }] },
  { email: 'ceo@mindspace.test', displayName: 'Jun-ho Executive', roles: [{ role: 'EXECUTIVE', scopeType: 'GROUP' }] },
  { email: 'manager@mindspace.test', displayName: 'Amina Manager', roles: [{ role: 'MANAGER', scopeType: 'LEGAL_ENTITY', entityCode: 'KE01' }] },
  { email: 'employee@mindspace.test', displayName: 'Kevin Employee', roles: [{ role: 'EMPLOYEE', scopeType: 'LEGAL_ENTITY', entityCode: 'KE01' }] },
];
