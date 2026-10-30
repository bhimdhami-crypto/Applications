import { IntercompanyError, linkKey, planIntercompany } from './intercompany';
import { prepareLines } from './posting-rules';

// Company 1 = MFI-DS, company 2 = MFI-MDS. DS's current account with MDS is 100, MDS's with DS is 200.
const links = new Map([
  [linkKey(1, 2), 100],
  [linkKey(2, 1), 200],
]);

describe('planIntercompany', () => {
  it('posts DS paying MDS rent to both companies, each side balanced', () => {
    const { own, partners } = planIntercompany(
      1,
      [
        { accountId: 0, debit: '50000', partnerCompanyId: 2, partnerAccountId: 77, description: 'MDS rent' },
        { accountId: 10, credit: '50000' },
      ],
      links,
    );
    expect(own).toEqual([
      { accountId: 100, debit: '50000', description: 'MDS rent' },
      { accountId: 10, credit: '50000' },
    ]);
    const mds = partners.get(2)!;
    expect(mds).toEqual([
      { accountId: 77, debit: '50000', description: 'MDS rent' },
      { accountId: 200, debit: undefined, credit: '50000', description: 'MDS rent' },
    ]);
    expect(() => prepareLines(own, 'KES')).not.toThrow();
    expect(() => prepareLines(mds, 'KES')).not.toThrow();
  });

  it('flips the sign of a foreign amount on the mirror line', () => {
    const { partners } = planIntercompany(
      1,
      [
        { accountId: 0, currencyCode: 'USD', exchangeRate: '130', foreignAmount: '-10', partnerCompanyId: 2, partnerAccountId: 77 },
        { accountId: 10, debit: '1300' },
      ],
      links,
    );
    expect(partners.get(2)!.map((l) => l.foreignAmount)).toEqual(['-10', '10']);
  });

  it('refuses a pair without current accounts both ways, or a partner equal to itself', () => {
    const oneWay = new Map([[linkKey(1, 2), 100]]);
    const line = { accountId: 0, debit: '1', partnerCompanyId: 2, partnerAccountId: 77 };
    expect(() => planIntercompany(1, [line], oneWay)).toThrow(IntercompanyError);
    expect(() => planIntercompany(1, [{ ...line, partnerCompanyId: 1 }], links)).toThrow('another company');
    expect(() => planIntercompany(1, [{ ...line, partnerAccountId: undefined }], links)).toThrow('needs both');
  });
});
