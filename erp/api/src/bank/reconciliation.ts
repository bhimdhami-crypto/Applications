/**
 * The bank reconciliation statement: why the bank's balance and the ledger's differ on a date.
 *
 *   balance per bank statement
 * + deposits in the ledger the bank has not shown yet
 * − payments in the ledger the bank has not shown yet (unpresented cheques)
 * − money in on the statement not yet in the ledger (interest, customer deposits)
 * + money out on the statement not yet in the ledger (bank charges)
 * = balance per ledger, and any remainder is an unexplained difference
 *
 * An item is outstanding on a date when it is dated on or before it and is not matched, or is matched
 * only to items dated after it.
 */
export interface ReconItem {
  txDate: string;
  amount: bigint;
  /** The latest date among the items it is matched with; null when unmatched */
  clearedOn: string | null;
}

export interface Reconciliation {
  statementBalance: bigint;
  depositsInTransit: bigint;
  unpresentedPayments: bigint;
  bankMoneyIn: bigint;
  bankMoneyOut: bigint;
  adjustedBalance: bigint;
  ledgerBalance: bigint;
  difference: bigint;
}

export const outstanding = (item: ReconItem, asAt: string) => item.txDate <= asAt && (item.clearedOn == null || item.clearedOn > asAt);

export function reconcile(asAt: string, statementBalance: bigint, ledgerBalance: bigint, ledgerItems: ReconItem[], statementItems: ReconItem[]): Reconciliation {
  let depositsInTransit = 0n;
  let unpresentedPayments = 0n;
  for (const e of ledgerItems) {
    if (!outstanding(e, asAt)) continue;
    if (e.amount > 0n) depositsInTransit += e.amount;
    else unpresentedPayments -= e.amount;
  }
  let bankMoneyIn = 0n;
  let bankMoneyOut = 0n;
  for (const l of statementItems) {
    if (!outstanding(l, asAt)) continue;
    if (l.amount > 0n) bankMoneyIn += l.amount;
    else bankMoneyOut -= l.amount;
  }
  const adjustedBalance = statementBalance + depositsInTransit - unpresentedPayments - bankMoneyIn + bankMoneyOut;
  return {
    statementBalance,
    depositsInTransit,
    unpresentedPayments,
    bankMoneyIn,
    bankMoneyOut,
    adjustedBalance,
    ledgerBalance,
    difference: ledgerBalance - adjustedBalance,
  };
}
