import sql from 'mssql';

/**
 * Evolution is only ever read. Every query against it passes through readOnly(), which refuses
 * anything but a SELECT. Give the ETL a SQL login with db_datareader only, so the database enforces it too.
 */
export function assertReadOnly(statement: string) {
  const text = statement.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^(select|with)\b/i.test(text)) throw new Error('Evolution queries must be SELECT statements');
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|into)\b/i.test(text)) {
    throw new Error('Evolution queries must not change data');
  }
}

export async function connectEvolution(database: string) {
  const base = required('EVO_CONNECTION');
  return new sql.ConnectionPool(`${base};Database=${database};Application Name=mfi-erp-etl (read-only)`).connect();
}

export async function connectErp() {
  return new sql.ConnectionPool(required('ERP_CONNECTION')).connect();
}

export async function readEvolution<T>(pool: sql.ConnectionPool, statement: string, params: Record<string, unknown> = {}) {
  assertReadOnly(statement);
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return (await request.query<T>(statement)).recordset;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see erp/.env.example)`);
  return value;
}
