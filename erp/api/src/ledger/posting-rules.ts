import { SCALE, fromUnits, roundUnits, toUnits } from '../common/money';

export interface PostingLineInput {
  accountId: number;
  debit?: string;
  credit?: string;
  /** ISO code; omitted or equal to the home currency means a home-currency line */
  currencyCode?: string;
  /** Home currency per one foreign unit, required on foreign lines */
  exchangeRate?: string;
  /** Amount in the foreign currency; the home amount is then rate × foreign, rounded */
  foreignAmount?: string;
  description?: string;
  projectId?: number;
  taxCodeId?: number;
}

export interface PreparedLine {
  lineNo: number;
  accountId: number;
  debit: string;
  credit: string;
  currencyCode: string;
  exchangeRate: string;
  foreignDebit: string;
  foreignCredit: string;
  description?: string;
  projectId?: number;
  taxCodeId?: number;
}

export class PostingRuleError extends Error {}

const RATE_SCALE = 1_000_000n;

/**
 * Checks a journal the way the ledger requires and returns the rows to insert:
 * at least two lines, each line one-sided and positive, and total debits equal total credits
 * in home currency, to the cent. Foreign lines get their home amount from rate × foreign amount.
 */
export function prepareLines(lines: PostingLineInput[], homeCurrency: string, homeDecimals = 2): PreparedLine[] {
  if (lines.length < 2) throw new PostingRuleError('A journal needs at least two lines');

  let totalDebit = 0n;
  let totalCredit = 0n;
  const prepared = lines.map((line, i): PreparedLine => {
    const label = `Line ${i + 1}`;
    const currency = (line.currencyCode ?? homeCurrency).toUpperCase();
    const isForeign = currency !== homeCurrency;

    let debit = 0n;
    let credit = 0n;
    let foreignDebit = 0n;
    let foreignCredit = 0n;
    let rate = '1.000000';

    if (isForeign) {
      if (!line.exchangeRate || !line.foreignAmount) {
        throw new PostingRuleError(`${label}: a ${currency} line needs exchangeRate and foreignAmount`);
      }
      if (line.debit || line.credit) {
        throw new PostingRuleError(`${label}: on a ${currency} line give foreignAmount (positive = debit, negative = credit), not debit or credit`);
      }
      const rateMicro = parseRate(line.exchangeRate, label);
      const foreign = toUnits(line.foreignAmount);
      if (foreign === 0n) throw new PostingRuleError(`${label}: amount cannot be zero`);
      const home = convert(abs(foreign), rateMicro, homeDecimals);
      // Positive foreign amount = debit, negative = credit
      if (foreign > 0n) {
        debit = home;
        foreignDebit = foreign;
      } else {
        credit = home;
        foreignCredit = -foreign;
      }
      rate = formatRate(rateMicro);
    } else {
      debit = line.debit ? toUnits(line.debit) : 0n;
      credit = line.credit ? toUnits(line.credit) : 0n;
      if (debit < 0n || credit < 0n) throw new PostingRuleError(`${label}: amounts cannot be negative`);
      if (debit > 0n && credit > 0n) throw new PostingRuleError(`${label}: use either debit or credit, not both`);
      if (debit === 0n && credit === 0n) throw new PostingRuleError(`${label}: amount cannot be zero`);
      if (roundUnits(debit + credit, homeDecimals) !== debit + credit) {
        throw new PostingRuleError(`${label}: ${homeCurrency} amounts have at most ${homeDecimals} decimals`);
      }
    }

    totalDebit += debit;
    totalCredit += credit;
    return {
      lineNo: i + 1,
      accountId: line.accountId,
      debit: fromUnits(debit),
      credit: fromUnits(credit),
      currencyCode: currency,
      exchangeRate: rate,
      foreignDebit: fromUnits(foreignDebit),
      foreignCredit: fromUnits(foreignCredit),
      description: line.description,
      projectId: line.projectId,
      taxCodeId: line.taxCodeId,
    };
  });

  if (totalDebit !== totalCredit) {
    throw new PostingRuleError(
      `Journal does not balance: debits ${fromUnits(totalDebit)}, credits ${fromUnits(totalCredit)}`,
    );
  }
  return prepared;
}

/** The mirror image of posted lines, used to reverse a batch */
export function reverseLines(lines: PreparedLine[]): PreparedLine[] {
  return lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
    foreignDebit: l.foreignCredit,
    foreignCredit: l.foreignDebit,
  }));
}

/** foreign units × rate, rounded once (half up) to the home currency's decimals */
function convert(foreignUnits: bigint, rateMicro: bigint, decimals: number): bigint {
  const step = 10n ** BigInt(SCALE - decimals);
  const denominator = RATE_SCALE * step;
  return ((foreignUnits * rateMicro + denominator / 2n) / denominator) * step;
}

function abs(n: bigint) {
  return n < 0n ? -n : n;
}

function parseRate(text: string, label: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(text.trim())) throw new PostingRuleError(`${label}: exchange rate must be positive, up to 6 decimals`);
  const [whole, fraction = ''] = text.trim().split('.');
  const micro = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, '0'));
  if (micro === 0n) throw new PostingRuleError(`${label}: exchange rate must be positive`);
  return micro;
}

function formatRate(micro: bigint): string {
  return `${micro / RATE_SCALE}.${(micro % RATE_SCALE).toString().padStart(6, '0')}`;
}
