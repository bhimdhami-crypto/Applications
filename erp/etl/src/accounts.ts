import sql from 'mssql';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

/** A staged Evolution account (stg_evo.Accounts), only the columns the mapping reads */
export interface EvoAccount {
  AccountLink: number;
  Master_Sub_Account: string | null;
  Account: string | null;
  Description: string | null;
  iAccountType: number | null;
  SubAccOfLink: number | null;
  ActiveAccount: boolean | null;
}

export interface MappedAccount {
  sourceLinkId: number;
  code: string;
  description: string;
  type: AccountType;
  parentSourceLinkId: number | null;
  isActive: boolean;
}

/**
 * Evolution numbers its account types; which number means which type is confirmed per installation
 * by running sql/04-account-types.sql and filling account-types.json. Unknown numbers stop the mapping
 * and are listed, so no account is ever filed under a guessed type.
 */
export function mapAccounts(rows: EvoAccount[], typeMap: Record<string, string>) {
  const unknown = new Map<number | null, string[]>();
  const mapped: MappedAccount[] = [];
  for (const r of rows) {
    const type = typeMap[String(r.iAccountType)];
    if (!type || !TYPES.includes(type as AccountType)) {
      const examples = unknown.get(r.iAccountType) ?? [];
      if (examples.length < 3) examples.push(`${r.Master_Sub_Account ?? r.Account} ${r.Description ?? ''}`.trim());
      unknown.set(r.iAccountType, examples);
      continue;
    }
    mapped.push({
      sourceLinkId: r.AccountLink,
      code: (r.Master_Sub_Account || r.Account || String(r.AccountLink)).trim(),
      description: (r.Description ?? '').trim() || '(no description)',
      type: type as AccountType,
      parentSourceLinkId: r.SubAccOfLink && r.SubAccOfLink > 0 ? r.SubAccOfLink : null,
      isActive: r.ActiveAccount !== false,
    });
  }
  return { mapped, unknown };
}

/**
 * Upserts the mapped accounts into dbo.GlAccount for one company, matched on the Evolution AccountLink,
 * then links sub-accounts to their parents. Safe to re-run.
 */
export async function loadAccounts(target: sql.ConnectionPool, companyId: number, accounts: MappedAccount[]) {
  const tx = new sql.Transaction(target);
  await tx.begin();
  try {
    for (const a of accounts) {
      await new sql.Request(tx)
        .input('companyId', sql.Int, companyId)
        .input('sourceLinkId', sql.Int, a.sourceLinkId)
        .input('code', sql.NVarChar(50), a.code)
        .input('description', sql.NVarChar(200), a.description.slice(0, 200))
        .input('type', sql.NVarChar(20), a.type)
        .input('isActive', sql.Bit, a.isActive).query(`
MERGE dbo.GlAccount AS t
USING (SELECT @companyId AS companyId, @sourceLinkId AS sourceLinkId) AS s
  ON t.companyId = s.companyId AND t.sourceLinkId = s.sourceLinkId
WHEN MATCHED THEN UPDATE SET code = @code, description = @description, type = @type, isActive = @isActive
WHEN NOT MATCHED THEN INSERT (companyId, code, description, type, isPostable, isActive, sourceLinkId)
  VALUES (@companyId, @code, @description, @type, 1, @isActive, @sourceLinkId);`);
    }
    await new sql.Request(tx).input('companyId', sql.Int, companyId).query(`
UPDATE child SET parentId = parent.id
FROM dbo.GlAccount child
JOIN stg_evo.Accounts src ON src.AccountLink = child.sourceLinkId
JOIN dbo.Company c ON c.id = child.companyId AND src._company = c.code
JOIN dbo.GlAccount parent ON parent.companyId = child.companyId AND parent.sourceLinkId = src.SubAccOfLink
WHERE child.companyId = @companyId;`);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
