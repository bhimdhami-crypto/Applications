import { PostingLineInput } from './posting-rules';

export interface IntercompanyLineInput extends PostingLineInput {
  /** The sister company this line is for */
  partnerCompanyId?: number;
  /** The account in the sister company that takes this amount (its cost, income or asset) */
  partnerAccountId?: number;
}

/** Current account of `companyId` with `partnerCompanyId`, keyed `${companyId}>${partnerCompanyId}` */
export type LinkMap = Map<string, number>;

export const linkKey = (companyId: number, partnerCompanyId: number) => `${companyId}>${partnerCompanyId}`;

export class IntercompanyError extends Error {}

/**
 * Splits a voucher into what each company posts. An intercompany line posts in this company to its
 * current account with the partner, and in the partner company to the chosen account, balanced there
 * by the partner's current account with this company. Example, MFI-DS pays MDS's rent:
 *   MFI-DS:  Dr current account with MDS 50,000   Cr Bank 50,000
 *   MFI-MDS: Dr Rent 50,000                        Cr current account with DS 50,000
 * Both current accounts then agree, which the reconciliation report checks.
 */
export function planIntercompany(companyId: number, lines: IntercompanyLineInput[], links: LinkMap) {
  const own: PostingLineInput[] = [];
  const partners = new Map<number, PostingLineInput[]>();

  lines.forEach((line, i) => {
    const { partnerCompanyId, partnerAccountId, ...rest } = line;
    if (partnerCompanyId === undefined && partnerAccountId === undefined) {
      own.push(rest);
      return;
    }
    const label = `Line ${i + 1}`;
    if (!partnerCompanyId || !partnerAccountId) {
      throw new IntercompanyError(`${label}: an intercompany line needs both the partner company and its account`);
    }
    if (partnerCompanyId === companyId) throw new IntercompanyError(`${label}: the partner must be another company`);
    const ownCurrent = links.get(linkKey(companyId, partnerCompanyId));
    const partnerCurrent = links.get(linkKey(partnerCompanyId, companyId));
    if (!ownCurrent || !partnerCurrent) {
      throw new IntercompanyError(`${label}: the intercompany current accounts for this pair of companies are not set up`);
    }

    own.push({ ...rest, accountId: ownCurrent });
    const mirror = partners.get(partnerCompanyId) ?? [];
    mirror.push({ ...rest, accountId: partnerAccountId });
    mirror.push({ ...opposite(rest), accountId: partnerCurrent, description: rest.description });
    partners.set(partnerCompanyId, mirror);
  });

  return { own, partners };
}

function opposite(line: PostingLineInput): PostingLineInput {
  if (line.foreignAmount !== undefined) {
    const amount = line.foreignAmount.trim();
    return { ...line, foreignAmount: amount.startsWith('-') ? amount.slice(1) : `-${amount}` };
  }
  return { ...line, debit: line.credit, credit: line.debit };
}
