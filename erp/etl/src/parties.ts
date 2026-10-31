import sql from 'mssql';

export type PartyKind = 'CUSTOMER' | 'SUPPLIER';

/** A staged Evolution Client or Vendor row joined to its currency code, only the columns the mapping reads */
export interface EvoParty {
  DCLink: number;
  Account: string | null;
  Name: string | null;
  CurrencyCode: string | null;
  Credit_Limit: number | null;
  Tax_Number: string | null;
  EMail: string | null;
}

export interface MappedParty {
  sourceLinkId: number;
  code: string;
  name: string;
  currencyCode: string | null;
  creditLimit: string | null;
  taxNumber: string | null;
  email: string | null;
}

/**
 * Evolution Client (customers) and Vendor (suppliers) rows to ERP parties. A home-currency account has
 * no currency of its own. Accounts with no code are reported rather than loaded under a made-up one.
 */
export function mapParties(rows: EvoParty[], homeCurrency: string) {
  const mapped: MappedParty[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const code = (r.Account ?? '').trim();
    if (!code) {
      problems.push(`DCLink ${r.DCLink} (${r.Name ?? 'no name'}) has no account code`);
      continue;
    }
    if (seen.has(code.toLowerCase())) {
      problems.push(`${code} appears twice`);
      continue;
    }
    seen.add(code.toLowerCase());
    const currency = r.CurrencyCode?.trim().toUpperCase() || null;
    mapped.push({
      sourceLinkId: r.DCLink,
      code: code.slice(0, 50),
      name: ((r.Name ?? '').trim() || code).slice(0, 200),
      currencyCode: currency === homeCurrency ? null : currency,
      creditLimit: r.Credit_Limit && r.Credit_Limit > 0 ? r.Credit_Limit.toFixed(2) : null,
      taxNumber: r.Tax_Number?.trim().slice(0, 50) || null,
      email: r.EMail?.trim().slice(0, 200) || null,
    });
  }
  return { mapped, problems };
}

/** Upserts parties of one kind into dbo.Party for one company, matched on the Evolution DCLink. Safe to re-run. */
export async function loadParties(target: sql.ConnectionPool, companyId: number, kind: PartyKind, parties: MappedParty[]) {
  const tx = new sql.Transaction(target);
  await tx.begin();
  try {
    for (const p of parties) {
      await new sql.Request(tx)
        .input('companyId', sql.Int, companyId)
        .input('kind', sql.NVarChar(10), kind)
        .input('sourceLinkId', sql.Int, p.sourceLinkId)
        .input('code', sql.NVarChar(50), p.code)
        .input('name', sql.NVarChar(200), p.name)
        .input('currencyCode', sql.Char(3), p.currencyCode)
        .input('creditLimit', sql.Decimal(19, 4), p.creditLimit)
        .input('taxNumber', sql.NVarChar(50), p.taxNumber)
        .input('email', sql.NVarChar(200), p.email).query(`
MERGE dbo.Party AS t
USING (SELECT @companyId AS companyId, @kind AS kind, @sourceLinkId AS sourceLinkId) AS s
  ON t.companyId = s.companyId AND t.kind = s.kind AND t.sourceLinkId = s.sourceLinkId
WHEN MATCHED THEN UPDATE SET code = @code, name = @name, currencyCode = @currencyCode, creditLimit = @creditLimit,
  taxNumber = @taxNumber, email = @email
WHEN NOT MATCHED THEN INSERT (companyId, kind, code, name, currencyCode, creditLimit, taxNumber, email, sourceLinkId)
  VALUES (@companyId, @kind, @code, @name, @currencyCode, @creditLimit, @taxNumber, @email, @sourceLinkId);`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
