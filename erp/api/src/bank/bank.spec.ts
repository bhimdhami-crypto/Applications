import { autoMatch } from './matching';
import { reconcile } from './reconciliation';
import { balanceBreaks, guessLayout, inDateOrder, parseAmount, parseCsv, parseDate, readStatement } from './statement-csv';

const SCB = `Standard Chartered Bank Kenya
Account,0102030405060
Transaction Date,Value Date,Description,Cheque No,Debit,Credit,Balance
31/10/2026,31/10/2026,"SERVICE CHARGE, OCT",,450.00,,"1,210,350.00"
28/10/2026,28/10/2026,RTGS NAIROBI HOSPITAL INV 0091,,,"250,000.00","1,210,800.00"
27/10/2026,27/10/2026,CHQ 000123 KENYA POWER,000123,"48,210.00",,"960,800.00"
,,Closing balance,,,,"1,210,350.00"
`;

describe('bank statement files', () => {
  it('reads CSV with quotes, BOM and semicolons', () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads the amounts banks print', () => {
    expect(parseAmount('1,234.50')).toBe(12_345_000n);
    expect(parseAmount('(1,234.50)')).toBe(-12_345_000n);
    expect(parseAmount('1,234.50 DR')).toBe(-12_345_000n);
    expect(parseAmount('1,234.50CR')).toBe(12_345_000n);
    expect(parseAmount('KES 100')).toBe(1_000_000n);
    expect(parseAmount('')).toBeNull();
    expect(() => parseAmount('12abc')).toThrow('not an amount');
  });

  it('reads dates strictly', () => {
    expect(parseDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('05/10/2026', 'MM/DD/YYYY')).toBe('2026-05-10');
    expect(parseDate('5-Oct-26', 'DD-MMM-YYYY')).toBe('2026-10-05');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate('2026-10-05 00:00:00', 'YYYY-MM-DD')).toBe('2026-10-05');
  });

  it('finds the heading row below the bank details and guesses the columns', () => {
    const layout = guessLayout(parseCsv(SCB))!;
    expect(layout).toMatchObject({
      headerRow: 2,
      date: 'Transaction Date',
      description: 'Description',
      reference: 'Cheque No',
      moneyOut: 'Debit',
      moneyIn: 'Credit',
      balance: 'Balance',
      dateFormat: 'DD/MM/YYYY',
    });
  });

  it('reads a newest-first statement into date order, with money out negative', () => {
    const rows = parseCsv(SCB);
    const { lines, problems } = readStatement(rows, guessLayout(rows)!);
    expect(problems).toEqual([]);
    const ordered = inDateOrder(lines);
    expect(ordered.map((l) => [l.txDate, l.amount, l.reference])).toEqual([
      ['2026-10-27', -482_100_000n, '000123'],
      ['2026-10-28', 2_500_000_000n, null],
      ['2026-10-31', -4_500_000n, null],
    ]);
    expect(balanceBreaks(ordered)).toEqual([]);
    expect(balanceBreaks([ordered[0], { ...ordered[1], amount: 1n }])).toEqual([ordered[1].row]);
  });

  it('reports rows it cannot read instead of guessing', () => {
    const rows = parseCsv('Date,Narrative,Amount\n2026-13-01,x,5\n01/10/2026,y,abc\n02/10/2026,z,\n');
    const result = readStatement(rows, { headerRow: 0, date: 'Date', description: 'Narrative', amount: 'Amount', dateFormat: 'DD/MM/YYYY' });
    expect(result.lines).toEqual([]);
    expect(result.problems).toEqual(['Row 2: "2026-13-01" is not a DD/MM/YYYY date', 'Row 3: "abc" is not an amount', 'Row 4: no amount']);
  });
});

describe('autoMatch', () => {
  const item = (id: string, txDate: string, amount: bigint, text = '') => ({ id, txDate, amount, text });

  it('pairs the same amount within the clearing window', () => {
    const lines = [item('L1', '2026-10-27', -482_100_000n, 'CHQ 000123 KENYA POWER'), item('L2', '2026-10-31', -4_500_000n)];
    const entries = [item('E1', '2026-10-20', -482_100_000n, 'KPLC October 000123'), item('E2', '2026-09-01', -4_500_000n)];
    expect(autoMatch(lines, entries)).toEqual([{ lineId: 'L1', entryId: 'E1' }]);
  });

  it('prefers a shared reference over a nearer date', () => {
    const lines = [item('L1', '2026-10-10', 1_000_000n, 'RTGS INV 0091')];
    const entries = [item('E1', '2026-10-10', 1_000_000n, 'Receipt'), item('E2', '2026-10-08', 1_000_000n, 'Receipt INV 0091')];
    expect(autoMatch(lines, entries)).toEqual([{ lineId: 'L1', entryId: 'E2' }]);
  });

  it('leaves a tie for a person', () => {
    const lines = [item('L1', '2026-10-10', 1_000_000n)];
    const entries = [item('E1', '2026-10-09', 1_000_000n), item('E2', '2026-10-11', 1_000_000n)];
    expect(autoMatch(lines, entries)).toEqual([]);
  });
});

describe('reconcile', () => {
  it('explains the difference between the bank and the ledger', () => {
    // Ledger: opening 1,000 + receipt 250 (not yet on the statement) − cheque 48 (cleared) = 1,202
    // Bank:   opening 1,000 − cheque 48 − charge 0.45 (not yet in the ledger) = 951.55
    const ledger = [
      { txDate: '2026-10-28', amount: 2_500_000n, clearedOn: null },
      { txDate: '2026-10-20', amount: -480_000n, clearedOn: '2026-10-27' },
      // Cleared after the reconciliation date, so still unpresented on it
      { txDate: '2026-10-30', amount: -100_000n, clearedOn: '2026-11-02' },
    ];
    const bank = [
      { txDate: '2026-10-27', amount: -480_000n, clearedOn: '2026-10-20' },
      { txDate: '2026-10-31', amount: -4_500n, clearedOn: null },
    ];
    const r = reconcile('2026-10-31', 9_515_500n, 11_920_000n, ledger, bank);
    expect(r).toMatchObject({ depositsInTransit: 2_500_000n, unpresentedPayments: 100_000n, bankMoneyIn: 0n, bankMoneyOut: 4_500n });
    expect(r.adjustedBalance).toBe(11_920_000n);
    expect(r.difference).toBe(0n);
  });
});
