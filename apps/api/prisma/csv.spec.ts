import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and newlines', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n2,"line1\nline2",\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: 'say "hi"' },
      { a: '2', b: 'line1\nline2', c: '' },
    ]);
  });
});
