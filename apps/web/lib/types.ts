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
