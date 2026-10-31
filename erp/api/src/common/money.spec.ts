import { fromUnits, roundUnits, toUnits } from './money';

describe('money', () => {
  it('round-trips amounts at 4 decimal places', () => {
    expect(fromUnits(toUnits('1234.5'))).toBe('1234.5000');
    expect(fromUnits(toUnits('-0.0001'))).toBe('-0.0001');
    expect(fromUnits(toUnits(42))).toBe('42.0000');
  });

  it('rejects text that is not an amount, or has too many decimals', () => {
    expect(() => toUnits('12,000')).toThrow('Not a valid amount');
    expect(() => toUnits('1.23456')).toThrow('more than 4 decimal places');
  });

  it('rounds half away from zero to the currency decimals', () => {
    expect(fromUnits(roundUnits(toUnits('2.345'), 2))).toBe('2.3500');
    expect(fromUnits(roundUnits(toUnits('-2.345'), 2))).toBe('-2.3500');
    expect(fromUnits(roundUnits(toUnits('2.3449'), 2))).toBe('2.3400');
  });
});
