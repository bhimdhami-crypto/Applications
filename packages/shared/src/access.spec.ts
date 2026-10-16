import { can, grantProblem, resolveAccess, RoleAssignmentLike } from './access';

const entities = [
  { id: 'ke1', countryCode: 'KE' },
  { id: 'ke2', countryCode: 'KE' },
  { id: 'fr1', countryCode: 'FR' },
];

describe('resolveAccess', () => {
  it('limits a country role to that country', () => {
    const access = resolveAccess([{ role: 'HR', scopeType: 'COUNTRY', countryCode: 'KE' }], entities);
    expect(can(access, 'people.read', 'ke1')).toBe(true);
    expect(can(access, 'people.read', 'ke2')).toBe(true);
    expect(can(access, 'people.read', 'fr1')).toBe(false);
    expect(can(access, 'payroll.prepare')).toBe(false);
  });

  it('limits a company role to that company', () => {
    const access = resolveAccess([{ role: 'PAYROLL_OPERATOR', scopeType: 'LEGAL_ENTITY', legalEntityId: 'ke2' }], entities);
    expect(can(access, 'payroll.prepare', 'ke2')).toBe(true);
    expect(can(access, 'payroll.prepare', 'ke1')).toBe(false);
  });

  it('never gives group-only permissions from a country or company role', () => {
    const access = resolveAccess([{ role: 'GROUP_ADMIN', scopeType: 'COUNTRY', countryCode: 'KE' }], entities);
    expect(can(access, 'geo.manage')).toBe(false);
    expect(can(access, 'org.entities.manage')).toBe(false);
    expect(can(access, 'org.structure.manage', 'ke1')).toBe(true);
  });

  it('keeps payroll approval and payment release away from group admins', () => {
    const access = resolveAccess([{ role: 'GROUP_ADMIN', scopeType: 'GROUP' }], entities);
    expect(can(access, 'payroll.prepare', 'fr1')).toBe(true);
    expect(can(access, 'payroll.approve', 'fr1')).toBe(false);
    expect(can(access, 'payments.release', 'fr1')).toBe(false);
  });
});

describe('grantProblem', () => {
  const groupAdmin: RoleAssignmentLike[] = [{ role: 'GROUP_ADMIN', scopeType: 'GROUP' }];
  const keHrAdmin: RoleAssignmentLike[] = [{ role: 'HR_ADMIN', scopeType: 'COUNTRY', countryCode: 'KE' }];
  const granter = (roles: RoleAssignmentLike[]) => ({ roles, access: resolveAccess(roles, entities), userId: 'g' });

  it('lets a group admin give any role', () => {
    expect(grantProblem(granter(groupAdmin), { userId: 't', existing: [] }, { role: 'PAYROLL_APPROVER', scopeType: 'COUNTRY', countryCode: 'FR' }, entities)).toBeNull();
  });

  it('stops anyone changing their own roles', () => {
    expect(grantProblem(granter(groupAdmin), { userId: 'g', existing: [] }, { role: 'HR', scopeType: 'GROUP' }, entities)).toMatch(/own roles/);
  });

  it('keeps a country HR admin inside their country and delegable roles', () => {
    const g = granter(keHrAdmin);
    expect(grantProblem(g, { userId: 't', existing: [] }, { role: 'HR', scopeType: 'LEGAL_ENTITY', legalEntityId: 'ke1' }, entities)).toBeNull();
    expect(grantProblem(g, { userId: 't', existing: [] }, { role: 'HR', scopeType: 'LEGAL_ENTITY', legalEntityId: 'fr1' }, entities)).toMatch(/outside/);
    expect(grantProblem(g, { userId: 't', existing: [] }, { role: 'HR', scopeType: 'GROUP' }, entities)).toMatch(/group-wide/);
    expect(grantProblem(g, { userId: 't', existing: [] }, { role: 'PAYROLL_OPERATOR', scopeType: 'COUNTRY', countryCode: 'KE' }, entities)).toMatch(/group administrator/);
  });

  it('blocks maker and checker on the same company', () => {
    const existing: RoleAssignmentLike[] = [{ role: 'PAYROLL_OPERATOR', scopeType: 'COUNTRY', countryCode: 'KE' }];
    expect(grantProblem(granter(groupAdmin), { userId: 't', existing }, { role: 'PAYROLL_APPROVER', scopeType: 'LEGAL_ENTITY', legalEntityId: 'ke2' }, entities)).toMatch(/cannot be held/);
    expect(grantProblem(granter(groupAdmin), { userId: 't', existing }, { role: 'PAYROLL_APPROVER', scopeType: 'COUNTRY', countryCode: 'FR' }, entities)).toBeNull();
  });
});
