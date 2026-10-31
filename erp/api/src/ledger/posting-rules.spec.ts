import { PostingRuleError, prepareLines, reverseLines } from './posting-rules';

describe('prepareLines', () => {
  it('accepts a balanced KES journal', () => {
    const lines = prepareLines(
      [
        { accountId: 1, debit: '1500.50' },
        { accountId: 2, credit: '1000' },
        { accountId: 3, credit: '500.50' },
      ],
      'KES',
    );
    expect(lines.map((l) => [l.lineNo, l.debit, l.credit])).toEqual([
      [1, '1500.5000', '0.0000'],
      [2, '0.0000', '1000.0000'],
      [3, '0.0000', '500.5000'],
    ]);
    expect(lines[0].currencyCode).toBe('KES');
  });

  it('rejects an unbalanced journal with both totals in the message', () => {
    expect(() => prepareLines([{ accountId: 1, debit: '100' }, { accountId: 2, credit: '99.99' }], 'KES')).toThrow(
      'debits 100.0000, credits 99.9900',
    );
  });

  it('does not suffer float rounding: 0.1 + 0.2 balances 0.3', () => {
    expect(() =>
      prepareLines(
        [
          { accountId: 1, debit: '0.1' },
          { accountId: 1, debit: '0.2' },
          { accountId: 2, credit: '0.3' },
        ],
        'KES',
      ),
    ).not.toThrow();
  });

  it.each([
    [[{ accountId: 1, debit: '10' }], 'at least two lines'],
    [[{ accountId: 1, debit: '10', credit: '10' }, { accountId: 2 }], 'not both'],
    [[{ accountId: 1, debit: '-10' }, { accountId: 2, credit: '-10' }], 'cannot be negative'],
    [[{ accountId: 1, debit: '0' }, { accountId: 2, credit: '0' }], 'cannot be zero'],
    [[{ accountId: 1, debit: '10.005' }, { accountId: 2, credit: '10.005' }], 'at most 2 decimals'],
  ])('rejects %j', (lines, message) => {
    expect(() => prepareLines(lines, 'KES')).toThrow(PostingRuleError);
    expect(() => prepareLines(lines, 'KES')).toThrow(message);
  });

  it('converts a USD line at the given rate and rounds to KES cents', () => {
    const lines = prepareLines(
      [
        { accountId: 1, currencyCode: 'USD', exchangeRate: '129.255', foreignAmount: '100.01' },
        { accountId: 2, credit: '12926.79' },
      ],
      'KES',
    );
    // 100.01 × 129.255 = 12926.79255 → 12926.79
    expect(lines[0]).toMatchObject({
      debit: '12926.7900',
      credit: '0.0000',
      currencyCode: 'USD',
      exchangeRate: '129.255000',
      foreignDebit: '100.0100',
      foreignCredit: '0.0000',
    });
  });

  it('treats a negative foreign amount as a credit', () => {
    const lines = prepareLines(
      [
        { accountId: 1, debit: '1300' },
        { accountId: 2, currencyCode: 'usd', exchangeRate: '130', foreignAmount: '-10' },
      ],
      'KES',
    );
    expect(lines[1]).toMatchObject({ credit: '1300.0000', foreignCredit: '10.0000', currencyCode: 'USD' });
  });

  it('requires a rate and foreign amount on foreign lines', () => {
    expect(() =>
      prepareLines([{ accountId: 1, currencyCode: 'USD', debit: '10' }, { accountId: 2, credit: '10' }], 'KES'),
    ).toThrow('needs exchangeRate and foreignAmount');
  });
});

describe('reverseLines', () => {
  it('swaps every side so the reversal cancels the original', () => {
    const original = prepareLines(
      [
        { accountId: 1, currencyCode: 'USD', exchangeRate: '130', foreignAmount: '10' },
        { accountId: 2, credit: '1300' },
      ],
      'KES',
    );
    const reversed = reverseLines(original);
    expect(reversed[0]).toMatchObject({ debit: '0.0000', credit: '1300.0000', foreignCredit: '10.0000' });
    expect(reversed[1]).toMatchObject({ debit: '1300.0000', credit: '0.0000' });
  });
});
