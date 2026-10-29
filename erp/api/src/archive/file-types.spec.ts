import { recogniseFile, safeFileName } from './file-types';

describe('recogniseFile', () => {
  const pdf = Buffer.from('%PDF-1.7\n...');
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

  it('accepts files whose content matches their name', () => {
    expect(recogniseFile('Invoice 123.PDF', pdf)).toBe('application/pdf');
    expect(recogniseFile('statement.xlsx', zip)).toContain('spreadsheetml');
    expect(recogniseFile('bank.csv', Buffer.from('date,amount\n2026-03-01,100\n'))).toBe('text/csv');
  });

  it('refuses a renamed program, a mismatch, an unknown type or an empty file', () => {
    expect(recogniseFile('invoice.pdf', Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(recogniseFile('invoice.xlsx', pdf)).toBeNull();
    expect(recogniseFile('setup.exe', Buffer.from('MZ'))).toBeNull();
    expect(recogniseFile('empty.pdf', Buffer.alloc(0))).toBeNull();
    expect(recogniseFile('data.csv', Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('keeps a readable name without path parts or odd characters', () => {
    expect(safeFileName('..\\..\\Windows\\KRA invoice #12.pdf')).toBe('KRA_invoice_12.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('...')).toBe('file');
  });
});
