import { Prisma } from '@prisma/client';
import { display, fieldChanges, lineChanges } from './changes';

describe('display', () => {
  it('treats blanks as empty and amounts by value', () => {
    expect(display('')).toBeNull();
    expect(display(undefined)).toBeNull();
    expect(display(new Prisma.Decimal('30.00'))).toBe('30');
    expect(display(new Date('2026-03-15T00:00:00Z'))).toBe('2026-03-15');
    expect(display(false)).toBe('false');
  });
});

describe('fieldChanges', () => {
  const before = { name: 'Acme', termsDays: 30, creditLimit: new Prisma.Decimal('100000.00'), email: null as string | null };
  const labels = { name: 'Name', termsDays: 'Terms (days)', creditLimit: 'Credit limit', email: 'Email' };

  it('lists only the fields that changed, by label', () => {
    const after = { ...before, termsDays: 60, email: 'ap@acme.co.ke' };
    expect(fieldChanges(before, after, labels)).toEqual([
      { field: 'Terms (days)', from: '30', to: '60' },
      { field: 'Email', from: null, to: 'ap@acme.co.ke' },
    ]);
  });

  it('finds nothing when only the form of a value changed', () => {
    expect(fieldChanges(before, { ...before, creditLimit: new Prisma.Decimal('100000') }, labels)).toEqual([]);
  });
});

describe('lineChanges', () => {
  it('reports removed and added lines and ignores lines that only moved', () => {
    const before = ['5000 Dr 100.00', '1100 Cr 100.00'];
    const after = ['1100 Cr 120.00', '5000 Dr 100.00', '6100 Dr 20.00'];
    expect(lineChanges(before, after)).toEqual({ removed: ['1100 Cr 100.00'], added: ['1100 Cr 120.00', '6100 Dr 20.00'] });
  });

  it('counts repeated lines one by one', () => {
    expect(lineChanges(['A', 'A'], ['A'])).toEqual({ removed: ['A'], added: [] });
  });
});
