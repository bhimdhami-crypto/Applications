# MFI ERP

Web ERP for MFI on **SQL Server Express**: general ledger first, then receivables, payables, inventory, and sales and purchase orders. It is built to replace Sage Evolution 200 one module at a time, and it migrates MFI's own data from the Evolution company databases (MFI-DS, MFI-MDS, MFI-TS).

This is **phase 0**: the foundation. See the [plan](https://claude.ai/artifact/FzcWuJUY41BAEHUJoc6fat) for all phases.

| Part | What it is |
|---|---|
| `api` | NestJS 11 API, Prisma 6 on SQL Server, sign-in with roles, audit log, the posting engine and general ledger endpoints |
| `etl` | Migration tool: reads Evolution (SELECT only), stages its tables in `stg_evo`, maps the chart of accounts |
| `etl/sql` | Scripts to run in SSMS: profile the Evolution databases, trace how Evolution posts a document, map account types |

## Clean-room rules

The app is original work. Evolution is studied only from the outside:

- **Allowed:** MFI's own data and schema in SQL Server, SQL traces of what Evolution writes, Sage's public documentation, and how staff use the screens.
- **Not allowed in this folder:** decompiled or disassembled Sage code, Sage DLLs, its stored procedures, screenshots or other Sage assets. Do not run decompilers (Ghidra, IDA, ILSpy, REA and similar) on Evolution: its licence forbids it.
- **Open-source ERPs:** design ideas from ERPNext, Odoo, Dolibarr and AccountGo are welcome. Do not copy code from the GPL/LGPL/AGPL projects (ERPNext, Odoo, Dolibarr). AccountGo is MIT: code adapted from it must keep its copyright notice.

## Design

- **One database, many companies.** Every table carries `companyId`, so group reports need no `Table.Combine`. SQL Server Express caps a database at 10 GB; if the three companies outgrow that, move to SQL Server Standard.
- **One posting engine.** Every ledger change goes through `LedgerService.post()`: it checks the period is open, the accounts are postable and belong to the company, and debits equal credits to the cent. Header, lines and audit log are written in one serializable transaction, under a gapless audit number (`GL000001`), like Evolution's `cAuditNumber`.
- **Posted rows are never changed.** Mistakes are corrected with a reversing journal. A database CHECK keeps every ledger row one-sided and non-negative.
- **Exact money.** Amounts are `DECIMAL(19,4)` and the engine adds them as integers of 0.0001, so float rounding never unbalances a journal. Foreign lines store the foreign amount and rate; the KES amount is rate × foreign amount, rounded once.
- **Traceable migration.** Migrated accounts keep Evolution's `AccountLink` in `sourceLinkId`.

## Quick start

You need Node 22 and SQL Server (2017 or later, Express is fine). For a local server, `docker compose up -d` in this folder starts SQL Server 2022 Express.

```bash
cd erp
cp .env.example api/.env          # then edit the passwords and connection strings
npm install
# create the empty database once, e.g. in SSMS: CREATE DATABASE mfierp
npm run db:migrate
npm run db:seed                   # currencies, MFI-DS/MFI-MDS/MFI-TS, fiscal periods, VAT codes, admin account
npm run dev:api                   # http://localhost:4100/api
```

Sign in with `POST /api/auth/login` and send the returned token as `Authorization: Bearer <token>`.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/health` | anyone | API and database status |
| `GET /api/companies` | signed in | Companies |
| `GET /api/companies/:company/periods` | signed in | Fiscal periods |
| `GET /api/companies/:company/accounts` | signed in | Chart of accounts |
| `POST /api/companies/:company/accounts` | accountant | Add an account |
| `POST /api/companies/:company/journals` | accountant | Post a journal |
| `GET /api/companies/:company/journals?from=&to=` | signed in | Journals in a date range |
| `GET /api/companies/:company/journals/:auditNo` | signed in | One journal with its lines |
| `POST /api/companies/:company/journals/:auditNo/reverse` | accountant | Reverse a journal once |
| `GET /api/companies/:company/trial-balance?from=&to=` | signed in | Trial balance |

Example journal (a KES line and a USD line):

```json
{
  "txDate": "2026-03-20",
  "description": "USD sale",
  "lines": [
    { "accountId": 12, "currencyCode": "USD", "exchangeRate": "129.5", "foreignAmount": "1000" },
    { "accountId": 40, "credit": "129500" }
  ]
}
```

On a foreign line a positive `foreignAmount` is a debit and a negative one a credit.

## Migrating from Evolution

The ETL reads Evolution with SELECT statements only. Give it a SQL login with **db_datareader only** on the three Evolution databases, so SQL Server enforces that too.

1. In SSMS, run `etl/sql/01-profile.sql` on each company database: table sizes and the total against the 10 GB Express limit.
2. Copy Evolution tables into the ERP database's `stg_evo` schema:
   `npm run etl -- stage MFI-DS` (or name tables: `npm run etl -- stage MFI-DS Accounts,PostGL`)
3. Run `etl/sql/04-account-types.sql` in SSMS, and record in `etl/account-types.json` which `iAccountType` number is an asset, liability, equity, income or expense account. The tool never guesses: unmapped numbers stop it and are listed with examples.
4. Load the chart of accounts: `npm run etl -- accounts MFI-DS`. Safe to re-run; accounts are matched on `AccountLink`.

Opening balances, history and reconciliation reports come in phase 1.

### Learning how Evolution posts

`etl/sql/02-trace-posting.sql` records the SQL Evolution sends while you post one document, and `03-snapshot.sql` lists every PostGL, PostAR and PostST row that document wrote, grouped by audit number. That is how the posting rules for each document type are worked out, without touching Evolution's program files. Use a test copy of the company, not the live database during month-end.

## Tests

```bash
npm test         # unit tests, plus the end-to-end ledger suite against TEST_DATABASE_URL
```

The end-to-end suite wipes its database, so it only runs against a database whose name ends in `_test`. CI runs everything against SQL Server 2022 Express.
