import { PartyKind, Subledger } from '../common/constants';

export const KIND_FOR: Record<Subledger, PartyKind> = { AR: 'CUSTOMER', AP: 'SUPPLIER' };

interface AccountFacts {
  code: string;
  subledger: string | null;
}

interface PartyFacts {
  code: string;
  kind: string;
  isActive: boolean;
}

/**
 * Keeps the control accounts and the customer and supplier balances in step: a line on Debtors Control
 * names a customer, a line on Creditors Control names a supplier, and no other line names either.
 * Returns why the line cannot post, or null.
 */
export function subledgerProblem(label: string, account: AccountFacts, party: PartyFacts | null | undefined): string | null {
  const ledger = account.subledger as Subledger | null;
  if (!ledger) {
    return party ? `${label}: ${party.code} can only be used on a Debtors or Creditors Control account, not ${account.code}` : null;
  }
  const kind = KIND_FOR[ledger];
  const word = kind === 'CUSTOMER' ? 'customer' : 'supplier';
  if (!party) return `${label}: ${account.code} is a control account, so choose the ${word}`;
  if (party.kind !== kind) return `${label}: ${party.code} is not a ${word}, and ${account.code} takes ${word}s only`;
  if (!party.isActive) return `${label}: ${word} ${party.code} is inactive`;
  return null;
}

/** Due date: the one given on the line, else the document date plus the party's payment terms */
export function dueDateFor(txDate: Date, termsDays: number, given?: string): Date {
  if (given) return new Date(`${given.slice(0, 10)}T00:00:00.000Z`);
  return new Date(txDate.getTime() + termsDays * 86_400_000);
}
