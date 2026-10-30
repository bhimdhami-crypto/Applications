import { dueDateFor, subledgerProblem } from './subledger-rules';

const debtors = { code: '42000', subledger: 'AR' };
const creditors = { code: '22000', subledger: 'AP' };
const bank = { code: '1100', subledger: null };
const customer = { code: 'C001', kind: 'CUSTOMER', isActive: true };
const supplier = { code: 'S001', kind: 'SUPPLIER', isActive: true };

describe('subledger rules', () => {
  it('needs a customer on Debtors Control and a supplier on Creditors Control', () => {
    expect(subledgerProblem('Line 1', debtors, customer)).toBeNull();
    expect(subledgerProblem('Line 1', creditors, supplier)).toBeNull();
    expect(subledgerProblem('Line 1', debtors, null)).toMatch(/choose the customer/);
    expect(subledgerProblem('Line 1', creditors, customer)).toMatch(/not a supplier/);
  });

  it('keeps parties off other accounts', () => {
    expect(subledgerProblem('Line 2', bank, null)).toBeNull();
    expect(subledgerProblem('Line 2', bank, customer)).toMatch(/only be used on a Debtors or Creditors Control/);
  });

  it('refuses an inactive party', () => {
    expect(subledgerProblem('Line 1', debtors, { ...customer, isActive: false })).toMatch(/inactive/);
  });

  it('works out the due date from the terms unless one is given', () => {
    const tx = new Date('2026-03-15T00:00:00.000Z');
    expect(dueDateFor(tx, 30).toISOString().slice(0, 10)).toBe('2026-04-14');
    expect(dueDateFor(tx, 30, '2026-03-31').toISOString().slice(0, 10)).toBe('2026-03-31');
  });
});
