/**
 * Reading bank statement exports. Banks differ in column names, date formats and how they show money
 * in and out, so a layout says which column holds what; it is guessed from the headings the first time
 * and remembered per bank account after that.
 */

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD.MM.YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface StatementLayout {
  /** Rows above the heading row, such as the bank's name and account details */
  headerRow: number;
  date: string;
  description: string;
  reference?: string | null;
  /** Either one signed amount column, or separate money-out and money-in columns */
  amount?: string | null;
  moneyOut?: string | null;
  moneyIn?: string | null;
  balance?: string | null;
  dateFormat: DateFormat;
}

export interface ParsedLine {
  row: number;
  txDate: string;
  description: string;
  reference: string | null;
  /** Units of 0.0001: positive is money into the account, negative is money out */
  amount: bigint;
  balance: bigint | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  problems: string[];
}

/** RFC 4180 CSV, also with semicolons or tabs; strips a byte order mark */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  // Judged on the first lines together: a bank's title line above the table often has no delimiter at all
  const top = body.split(/\r?\n/, 15).join('\n');
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(top, d) > count(top, best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

const GUESSES: Record<'date' | 'description' | 'reference' | 'amount' | 'moneyOut' | 'moneyIn' | 'balance', string[]> = {
  date: ['transactiondate', 'trandate', 'txndate', 'postingdate', 'bookingdate', 'date', 'valuedate'],
  description: ['description', 'transactiondescription', 'narrative', 'narration', 'details', 'transactiondetails', 'particulars', 'remarks', 'memo'],
  reference: ['reference', 'ref', 'chequeno', 'chequenumber', 'customerreference', 'bankreference', 'refno', 'transactionreference'],
  amount: ['amount', 'transactionamount', 'value'],
  moneyOut: ['debit', 'debits', 'withdrawal', 'withdrawals', 'moneyout', 'paidout', 'debitamount', 'dr'],
  moneyIn: ['credit', 'credits', 'deposit', 'deposits', 'moneyin', 'paidin', 'creditamount', 'cr'],
  balance: ['balance', 'runningbalance', 'closingbalance', 'ledgerbalance', 'bookbalance'],
};

/** Finds the heading row (within the first 15) and guesses which column is which */
export function guessLayout(rows: string[][]): StatementLayout | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const headings = rows[r].map((h) => h.trim());
    const find = (key: keyof typeof GUESSES) => {
      for (const want of GUESSES[key]) {
        const hit = headings.find((h) => norm(h) === want);
        if (hit) return hit;
      }
      // Headings such as "Transaction Narrative" or "Payment Details"
      if (key === 'description') return headings.find((h) => /description|narrat|details|particulars/.test(norm(h))) ?? null;
      return null;
    };
    const date = find('date');
    const description = find('description');
    const amount = find('amount');
    const moneyOut = find('moneyOut');
    const moneyIn = find('moneyIn');
    if (!date || !description || (!amount && !(moneyOut && moneyIn))) continue;
    const layout: StatementLayout = {
      headerRow: r,
      date,
      description,
      reference: find('reference'),
      amount: moneyOut && moneyIn ? null : amount,
      moneyOut: moneyOut && moneyIn ? moneyOut : null,
      moneyIn: moneyOut && moneyIn ? moneyIn : null,
      balance: find('balance'),
      dateFormat: 'DD/MM/YYYY',
    };
    const samples = rows.slice(r + 1, r + 40).map((row) => row[headings.indexOf(date)] ?? '');
    layout.dateFormat = guessDateFormat(samples);
    return layout;
  }
  return null;
}

export interface StatementDetails {
  currency: string | null;
  accountNumber: string | null;
}

/**
 * The account details banks print above the table ("Account Currency:,USD", "Account No:,0100003275358 - SBICKENX"),
 * used to catch a file dropped on the wrong bank account.
 */
export function statementDetails(rows: string[][], headerRow: number): StatementDetails {
  const details: StatementDetails = { currency: null, accountNumber: null };
  for (const row of rows.slice(0, headerRow)) {
    const label = norm(row[0] ?? '');
    const value = row.slice(1).join(' ').trim();
    if (!details.currency && label.includes('currency')) details.currency = value.match(/\b[A-Z]{3}\b/)?.[0] ?? null;
    if (!details.accountNumber && /^(account|acc|ac)(no|number|num)$/.test(label)) details.accountNumber = value.match(/\d[\d\s-]{4,}\d/)?.[0].replace(/\D/g, '') ?? null;
  }
  return details;
}

/** The first format that reads every sample, preferring day-first as Kenyan banks print dates */
export function guessDateFormat(samples: string[]): DateFormat {
  const filled = samples.map((s) => s.trim()).filter(Boolean);
  return DATE_FORMATS.find((f) => filled.length > 0 && filled.every((s) => parseDate(s, f))) ?? 'DD/MM/YYYY';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date as YYYY-MM-DD, or null when the text does not fit the format or is not a real day */
export function parseDate(text: string, format: DateFormat): string | null {
  const t = text.trim().split(/[ T]/)[0];
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  switch (format) {
    case 'DD/MM/YYYY':
    case 'MM/DD/YYYY':
      match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (!match) return null;
      [d, m] = format === 'DD/MM/YYYY' ? [+match[1], +match[2]] : [+match[2], +match[1]];
      y = +match[3];
      break;
    case 'DD.MM.YYYY':
      match = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!match) return null;
      [d, m, y] = [+match[1], +match[2], +match[3]];
      break;
    case 'YYYY-MM-DD':
      match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return null;
      [y, m, d] = [+match[1], +match[2], +match[3]];
      break;
    case 'DD-MMM-YYYY':
      match = t.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{2}|\d{4})$/);
      if (!match) return null;
      d = +match[1];
      m = MONTHS.indexOf(match[2].toLowerCase()) + 1;
      y = +match[3];
      if (!m) return null;
      break;
  }
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * An amount as units of 0.0001. Reads 1,234.50, (1,234.50) and 1,234.50 DR as negatives,
 * and 1,234.50 CR as positive; blank is null. Anything else is an error.
 */
export function parseAmount(text: string | undefined): bigint | null {
  let t = (text ?? '').trim().replace(/[\s,]/g, '').replace(/^(KES|KSH|USD|EUR|GBP)/i, '');
  if (!t || t === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  const suffix = t.match(/(DR|CR)$/i);
  if (suffix) {
    negative = suffix[1].toUpperCase() === 'DR';
    t = t.slice(0, -2);
  }
  if (t.endsWith('-')) {
    negative = true;
    t = t.slice(0, -1);
  }
  if (!/^-?\d+(\.\d{1,4})?$/.test(t)) throw new Error(`"${text}" is not an amount`);
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  const [whole, fraction = ''] = t.split('.');
  const units = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
  return negative ? -units : units;
}

/** Applies a layout to the rows; lines that cannot be read are reported, not guessed at */
export function readStatement(rows: string[][], layout: StatementLayout): ParseResult {
  const headings = (rows[layout.headerRow] ?? []).map((h) => h.trim());
  const col = (name?: string | null) => (name ? headings.indexOf(name) : -1);
  const idx = {
    date: col(layout.date),
    description: col(layout.description),
    reference: col(layout.reference),
    amount: col(layout.amount),
    moneyOut: col(layout.moneyOut),
    moneyIn: col(layout.moneyIn),
    balance: col(layout.balance),
  };
  const problems: string[] = [];
  const missing = (['date', 'description'] as const).filter((k) => idx[k] < 0);
  if (missing.length) return { lines: [], problems: [`No column ${missing.map((k) => `"${layout[k]}"`).join(' or ')} in the heading row`] };
  if (idx.amount < 0 && (idx.moneyOut < 0 || idx.moneyIn < 0)) return { lines: [], problems: ['Choose an amount column, or both a money-out and a money-in column'] };

  const lines: ParsedLine[] = [];
  rows.slice(layout.headerRow + 1).forEach((row, i) => {
    const rowNo = layout.headerRow + i + 2;
    const rawDate = row[idx.date]?.trim() ?? '';
    // Totals and blank rows at the foot of the export have no date: skip them quietly
    if (!rawDate) return;
    const txDate = parseDate(rawDate, layout.dateFormat);
    if (!txDate) {
      // A text row such as "Opening balance" or "Closing balance" is not a transaction
      if (!/\d/.test(rawDate)) return;
      problems.push(`Row ${rowNo}: "${rawDate}" is not a ${layout.dateFormat} date`);
      return;
    }
    try {
      let amount: bigint | null;
      if (idx.amount >= 0) amount = parseAmount(row[idx.amount]);
      else {
        const out = parseAmount(row[idx.moneyOut]);
        const inn = parseAmount(row[idx.moneyIn]);
        // Some banks print money out as a negative number in the debit column; it is out either way
        amount = out != null || inn != null ? (inn ?? 0n) - (out != null && out < 0n ? -out : (out ?? 0n)) : null;
      }
      if (amount == null || amount === 0n) {
        problems.push(`Row ${rowNo}: no amount`);
        return;
      }
      lines.push({
        row: rowNo,
        txDate,
        description: (row[idx.description] ?? '').trim().replace(/\s+/g, ' ').slice(0, 400),
        reference: idx.reference >= 0 ? (row[idx.reference] ?? '').trim().slice(0, 100) || null : null,
        amount,
        balance: idx.balance >= 0 ? parseAmount(row[idx.balance]) : null,
      });
    } catch (e) {
      problems.push(`Row ${rowNo}: ${(e as Error).message}`);
    }
  });
  return { lines, problems };
}

/**
 * Puts lines oldest first. Many banks list newest first; the running balance shows which way round
 * the file is, and failing that the dates do.
 */
export function inDateOrder(lines: ParsedLine[]): ParsedLine[] {
  if (lines.length < 2) return lines;
  const fits = (list: ParsedLine[]) => list.slice(1).every((l, i) => l.balance == null || list[i].balance == null || list[i].balance! + l.amount === l.balance);
  const reversed = [...lines].reverse();
  if (lines.every((l) => l.balance != null)) {
    if (fits(lines)) return lines;
    if (fits(reversed)) return reversed;
  }
  return lines[0].txDate > lines[lines.length - 1].txDate ? reversed : lines;
}

/** Rows where the running balance does not follow from the one before: a sign of a misread column */
export function balanceBreaks(lines: ParsedLine[]): number[] {
  const breaks: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1].balance;
    const cur = lines[i].balance;
    if (prev != null && cur != null && prev + lines[i].amount !== cur) breaks.push(lines[i].row);
  }
  return breaks;
}
