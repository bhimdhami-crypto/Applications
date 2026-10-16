import { decryptField, encryptField, last4, masked } from './field-crypto';

describe('field encryption', () => {
  it('round-trips and never stores the plain value', () => {
    const stored = encryptField('SPECIMEN-KE-NID-12345678');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('12345678');
    expect(decryptField(stored)).toBe('SPECIMEN-KE-NID-12345678');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptField('same')).not.toBe(encryptField('same'));
  });

  it('rejects tampered values', () => {
    const stored = encryptField('TEST1234567890');
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => decryptField(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('masks to the last four characters', () => {
    expect(masked(last4('TEST 0012 3456'))).toBe('•••• 3456');
  });
});
