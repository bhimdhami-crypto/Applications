/** Pairs bank statement lines with ledger rows on the bank account, the way a person ticks them off */

export interface BankItem {
  id: string;
  txDate: string;
  /** Units of 0.0001, money in positive */
  amount: bigint;
  text: string;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Words of four or more characters, or numbers of three or more digits: cheque numbers, invoice numbers, names */
function tokens(text: string) {
  return new Set((text.toUpperCase().match(/[A-Z]{4,}|\d{3,}/g) ?? []).filter((t) => !COMMON.has(t)));
}
const COMMON = new Set(['PAYMENT', 'TRANSFER', 'CHARGE', 'CHARGES', 'BANK', 'FROM', 'WITH', 'KENYA', 'LIMITED']);

/**
 * One-to-one matches with the same amount. A statement line may clear up to `windowDays` after the
 * ledger date (cheques take time) and up to 3 days before it. Where several rows fit, the one sharing a
 * reference or name wins, then the nearest date; a tie is left for a person to decide.
 */
export function autoMatch(lines: BankItem[], entries: BankItem[], windowDays = 10): Array<{ lineId: string; entryId: string }> {
  const candidates: Array<{ line: BankItem; entry: BankItem; score: number }> = [];
  for (const line of lines) {
    const lt = tokens(line.text);
    for (const entry of entries) {
      if (entry.amount !== line.amount) continue;
      const gap = days(entry.txDate, line.txDate);
      if (gap > windowDays || gap < -3) continue;
      const shared = [...tokens(entry.text)].filter((t) => lt.has(t)).length;
      // Shared words matter more than dates; a gap of a day costs little
      candidates.push({ line, entry, score: shared * 100 - Math.abs(gap) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedLines = new Set<string>();
  const usedEntries = new Set<string>();
  const out: Array<{ lineId: string; entryId: string }> = [];
  for (const c of candidates) {
    if (usedLines.has(c.line.id) || usedEntries.has(c.entry.id)) continue;
    // Ambiguous if another free row scores the same for this line, or another free line for this row:
    // leave whichever side is in doubt for a person
    const tie = (o: (typeof candidates)[number]) => o !== c && o.score === c.score;
    const lineInDoubt = candidates.some((o) => tie(o) && o.line.id === c.line.id && !usedEntries.has(o.entry.id));
    const entryInDoubt = candidates.some((o) => tie(o) && o.entry.id === c.entry.id && !usedLines.has(o.line.id));
    if (lineInDoubt || entryInDoubt) {
      if (lineInDoubt) usedLines.add(c.line.id);
      if (entryInDoubt) usedEntries.add(c.entry.id);
      continue;
    }
    usedLines.add(c.line.id);
    usedEntries.add(c.entry.id);
    out.push({ lineId: c.line.id, entryId: c.entry.id });
  }
  return out;
}
