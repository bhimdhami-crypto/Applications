# MFI ERP

Web ERP for MFI on **SQL Server Express**: general ledger first, then receivables, payables, inventory, and sales and purchase orders. It is built to replace Sage Evolution 200 one module at a time, and it migrates MFI's own data from the Evolution company databases (MFI-DS, MFI-MDS, MFI-TS).

Phase 0 (the foundation) is done and phase 1 is under way: the web screens, and the general ledger, debtors and creditors reports. See the [plan](https://claude.ai/artifact/FzcWuJUY41BAEHUJoc6fat) for all phases.

| Part | What it is |
|---|---|
| `api` | NestJS 11 API, Prisma 6 on SQL Server: sign-in with roles, approval workflow, document archive, intercompany posting, the posting engine and general ledger endpoints |
| `web` | Next.js screens: vouchers with drag and drop, approvals inbox, archive, customers and suppliers, and the reports |
| `etl` | Migration tool: reads Evolution (SELECT only), stages its tables in `stg_evo`, maps the chart of accounts, customers and suppliers |
| `etl/sql` | Scripts to run in SSMS: profile the Evolution databases, trace how Evolution posts a document, map account types |

## Clean-room rules

The app is original work. Evolution is studied only from the outside:

- **Allowed:** MFI's own data and schema in SQL Server, SQL traces of what Evolution writes, Sage's public documentation, and how staff use the screens.
- **Not allowed in this folder:** decompiled or disassembled Sage code, Sage DLLs, its stored procedures, screenshots or other Sage assets. Do not run decompilers (Ghidra, IDA, ILSpy, REA and similar) on Evolution: its licence forbids it.
- **Open-source ERPs:** design ideas from ERPNext, Odoo, Dolibarr and AccountGo are welcome. Do not copy code from the GPL/LGPL/AGPL projects (ERPNext, Odoo, Dolibarr). AccountGo is MIT: code adapted from it must keep its copyright notice.

## Design

- **One database, many companies.** Every table carries `companyId`, so group reports need no `Table.Combine`. SQL Server Express caps a database at 10 GB; if the three companies outgrow that, move to SQL Server Standard.
- **One posting engine.** Every ledger change goes through `LedgerService.post()`: it checks the period is open, the accounts are postable and belong to the company, and debits equal credits to the cent. Header, lines and audit log are written in one serializable transaction, under a gapless audit number (`GL000001`), like Evolution's `cAuditNumber`.
- **Nothing posts without approval.** Every transaction is a voucher: drafted, submitted, approved stage by stage under the company's approval rule (its SOP), and posted by the last approval. Rules are set per document type and amount band, The seeded starting matrix follows common internal-control practice until MFI's written SOP replaces it: journals under KES 500,000 need the finance manager; from 500,000 a director as well; from 5,000,000 a second, different director; every reversal needs the finance manager and a director whatever its size. Administrators change the matrix on the Approval rules screen: one document type at a time, bands from 0 with no gaps or overlaps, and a reason that goes in the audit trail. Rules are never edited in place; a change retires the old rule and creates a new one, so a voucher already submitted finishes the route it started on, and earlier versions stay on record. The author never approves their own voucher, and one person approves at most one stage. A rejection needs a reason and sends the voucher back to its author.
- **Paperless.** Files dropped on the inbox (invoice scans, statements, contracts) become a draft voucher with the files attached; more can be added at any stage. Files are checked by content, fingerprinted with SHA-256, stored on disk under `ARCHIVE_DIR` (not in SQL Server, to spare the 10 GB limit) and searchable. Once a voucher is submitted its files can no longer be removed.
- **Intercompany in one step.** Each pair of companies has a current account on each side. A voucher line can name a sister company and its account: posting writes this company's side and a linked batch in the sister company in the same transaction, and a reconciliation report checks the two current accounts cancel out.
- **Posted rows are never changed.** Mistakes are corrected with a reversing voucher, which is approved like any other. A database CHECK keeps every ledger row one-sided and non-negative.
- **Exact money.** Amounts are `DECIMAL(19,4)` and the engine adds them as integers of 0.0001, so float rounding never unbalances a journal. Foreign lines store the foreign amount and rate; the KES amount is rate × foreign amount, rounded once.
- **Customer and supplier balances live on the control accounts.** An account marked as Debtors Control (`AR`) or Creditors Control (`AP`) takes only lines that name a customer or supplier, and no other account takes them. Every row there carries its party and a due date (the document date plus the party's payment terms, unless the line gives one), so aged debtors and creditors come straight from the ledger and always add up to the control accounts; the reports show the check. Payments and credits clear the oldest amounts first.
- **Change history.** Every change is logged with who made it and when, and an edit keeps each changed field's old and new value: a voucher's date, description and lines before and after, a customer's terms or credit limit, an account's control setting. Each voucher, customer, supplier and account shows its own history; finance managers, directors and administrators see the company's whole trail on the Change history screen, filter it by record, person, dates or voucher number, and export it to CSV. Administrators also see every sign-in and failed attempt. The log is append-only: a database trigger refuses updates and deletes (only a database whose name ends in `_test` may be cleared, for the automated tests).
- **Email alerts.** When a voucher reaches a stage, everyone who can approve that stage gets an email with the voucher, amount and a link; administrators are told only when nobody holds the role. Authors hear when their voucher is rejected (with the reason) or posted, and each weekday between 08:00 and noon (Nairobi) approvers get one reminder of anything that has waited on them a day or more. Emails are written in the same transaction as the approval step, then sent by a background worker that retries for about two hours before marking a message failed. Anyone can turn their emails off on the Approvals screen; administrators see every message, its status and any error on the Email outbox screen, can send themselves a test, and can retry. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `APP_URL` in `api/.env`; without `SMTP_HOST` nothing is sent and messages show as not sent.
- **Bank reconciliation.** Each bank account is linked to its GL account (for example 41000 KEGEA SCB Harambee KSH), with a start date: ledger rows before it were reconciled in Evolution. The bank's CSV export is dropped on the account: the heading row and columns (date, description, reference, one signed amount or money out and money in, balance, date format) are guessed and can be corrected, then remembered for next month. Tested with Standard Chartered and Stanbic exports. If the file prints its currency or account number above the table and they are another account's, it is refused. Newest-first files are put in date order, the running balance must add up, rows that cannot be read stop the import, and lines already brought in by an overlapping file are skipped. The file is kept and can be downloaded again. Statement lines are then matched to the ledger rows on the bank account: automatically when the amount is the same and the bank date is up to 10 days after the ledger date (a shared reference or name decides between candidates, ties are left alone), or by hand by ticking rows on both sides whose totals agree, or by dragging a ledger row onto a statement line. A line the ledger does not have yet (bank charges, interest) becomes a draft voucher that goes through approval and is matched once posted. The reconciliation statement at any date shows the statement balance, deposits and payments not yet on the statement, statement items not yet in the ledger, the ledger balance and any unexplained difference. One person prepares it (a difference needs a note) and a finance manager or director reviews it; the reviewer cannot be the preparer, and the review is refused if anything changed since. Once reviewed, matches on or before that date are locked.
- **Traceable migration.** Migrated accounts keep Evolution's `AccountLink`, and customers and suppliers their `DCLink`, in `sourceLinkId`.

## Quick start

You need Node 22 and SQL Server (2017 or later, Express is fine). For a local server, `docker compose up -d` in this folder starts SQL Server 2022 Express.

```bash
cd erp
cp .env.example api/.env          # then edit the passwords and connection strings
npm install
# create the empty database once, e.g. in SSMS: CREATE DATABASE mfierp
npm run db:migrate
npm run db:seed                   # currencies, MFI-DS/MFI-MDS/MFI-TS, fiscal periods, VAT codes, starting approval rules, admin
npm run dev:api                   # http://localhost:4100/api
npm run dev:web                   # http://localhost:3100, in a second terminal
```

Sign in with `POST /api/auth/login` and send the returned token as `Authorization: Bearer <token>`.

Roles: `ADMIN`, `DIRECTOR`, `FINANCE_MANAGER`, `ACCOUNTANT`, `VIEWER`. Paths below start with `/api/companies/:company` unless shown in full.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/health` | anyone | API and database status |
| `GET /api/companies` | signed in | Companies |
| `GET /periods` | signed in | Fiscal periods |
| `GET /accounts`, `POST /accounts` | signed in; finance | Chart of accounts |
| `PATCH /accounts/:id` | finance manager | Mark as Debtors (`AR`) or Creditors (`AP`) Control, rename, deactivate |
| `GET /parties?kind=`, `POST /parties`, `PATCH /parties/:id` | signed in; finance; finance manager | Customers and suppliers |
| `GET /reports/general-ledger?from=&to=&account=` | signed in | Each account's postings with opening and running balance |
| `GET /reports/aged?kind=CUSTOMER\|SUPPLIER&asAt=` | signed in | Aged debtors or creditors, checked against the control accounts |
| `GET /reports/statement?party=&from=&to=` | signed in | A customer's or supplier's statement and open items |
| `POST /vouchers` | finance | Draft a voucher |
| `POST /inbox` | finance | Drop files (multipart `files`) to start a draft with them attached |
| `GET /vouchers?status=`, `GET /vouchers/:no` | signed in | Vouchers, one voucher with lines, approval history and files |
| `PUT /vouchers/:no` | author | Change a draft or rejected voucher |
| `POST /vouchers/:no/submit` | author | Check it would post, then start its approval route |
| `POST /vouchers/:no/approve` | stage approver | Approve the current stage; the last stage posts |
| `POST /vouchers/:no/reject` | stage approver | Send back with a reason |
| `POST /vouchers/:no/recall`, `POST /vouchers/:no/cancel` | author | Withdraw from approval; cancel a draft |
| `POST /vouchers/:no/attachments`, `DELETE /vouchers/:no/attachments/:id` | signed in; author | Add files; remove one from a draft |
| `GET /api/approvals/pending` | signed in | Vouchers in any company waiting for me |
| `GET /approval-rules` | signed in | Active approval rules (SOPs) |
| `GET /approval-matrix`, `PUT /approval-matrix/:documentType` | signed in; admin | Each document type's amount bands and stages, with checks and past versions; replace one type's matrix, with a reason |
| `GET /archive?q=&from=&to=`, `GET /archive/:id/download` | signed in | Search the archive by file, voucher number or reference; download |
| `GET /intercompany-links`, `POST /intercompany-links` | signed in; finance manager | Current account with each sister company |
| `GET /api/intercompany/reconciliation?to=` | signed in | Both sides of every intercompany pair, and the difference |
| `GET /journals?from=&to=`, `GET /journals/:auditNo` | signed in | Posted journals |
| `POST /journals/:auditNo/reverse` | finance | Draft a reversing voucher |
| `GET /trial-balance?from=&to=` | signed in | Trial balance |
| `GET /history?entity=&userId=&from=&to=&q=&before=` | finance manager, director, admin | The company's change history, newest first, 100 at a time |
| `GET /history/:entity/:id` | signed in | One voucher's, customer's, supplier's or account's history |
| `GET /api/sign-ins?from=&to=&before=` | admin | Sign-ins and failed attempts in every company |
| `GET /bank-accounts`, `POST /bank-accounts`, `PATCH /bank-accounts/:id` | signed in; finance manager | Bank accounts with ledger and statement balance and what is left to match |
| `POST /bank-accounts/:id/statements/preview`, `POST /bank-accounts/:id/statements` | finance | Check, then import, a statement CSV (multipart `file`, optional `layout` JSON and `openingBalance`) |
| `GET /bank-accounts/:id/workspace`, `POST /bank-accounts/:id/auto-match`, `POST /bank-accounts/:id/matches`, `DELETE /bank-accounts/:id/matches/:matchId` | signed in; finance | Unmatched lines and ledger rows; match automatically, by hand, or undo |
| `POST /bank-accounts/:id/lines/:lineId/voucher` | finance | Draft a voucher for a statement line not yet in the ledger |
| `GET /bank-accounts/:id/reconciliation?asAt=`, `POST /bank-accounts/:id/reconciliations`, `POST /bank-accounts/:id/reconciliations/:rid/review` | signed in; finance; finance manager or director | Reconciliation statement; prepare; review and sign off |
| `GET /api/me/email-alerts`, `PUT /api/me/email-alerts` | signed in | My approval emails on or off |
| `GET /api/email/outbox?status=`, `POST /api/email/test`, `POST /api/email/outbox/:id/retry` | admin | Every email with its status; send a test; send one again |

Example voucher (a USD line, a KES line, and an intercompany line charging MFI-MDS's rent):

```json
{
  "txDate": "2026-03-20",
  "description": "USD sale; MDS rent paid on its behalf",
  "lines": [
    { "accountId": 12, "currencyCode": "USD", "exchangeRate": "129.5", "foreignAmount": "1000" },
    { "accountId": 40, "credit": "129500" },
    { "debit": "80000", "partnerCompany": "MFI-MDS", "partnerAccountId": 310 },
    { "accountId": 11, "credit": "80000" }
  ]
}
```

On a foreign line a positive `foreignAmount` is a debit and a negative one a credit. An intercompany line names the partner company and its account; this company's side goes to its current account with that partner. A line on a control account adds `"partyId"` (the customer or supplier) and, optionally, `"dueDate"`.

## Migrating from Evolution

The ETL reads Evolution with SELECT statements only. Give it a SQL login with **db_datareader only** on the three Evolution databases, so SQL Server enforces that too.

1. In SSMS, run `etl/sql/01-profile.sql` on each company database: table sizes and the total against the 10 GB Express limit.
2. Copy Evolution tables into the ERP database's `stg_evo` schema:
   `npm run etl -- stage MFI-DS` (or name tables: `npm run etl -- stage MFI-DS Accounts,PostGL`)
3. Run `etl/sql/04-account-types.sql` in SSMS, and record in `etl/account-types.json` which `iAccountType` number is an asset, liability, equity, income or expense account. The tool never guesses: unmapped numbers stop it and are listed with examples.
4. Load the chart of accounts: `npm run etl -- accounts MFI-DS`. Safe to re-run; accounts are matched on `AccountLink`. Main accounts listed in `etl/excluded-accounts.json` (39000 MFI ROUTING ACCOUNT) and their sub-accounts are not migrated. When balances and history are loaded (phase 1), each 39000 line goes to 42000 Debtors Control if its counterparty is a client, or 22000 Creditors Control if it is a supplier.

5. Load customers and suppliers: `npm run etl -- stage MFI-DS Client,Vendor,Currency`, then `npm run etl -- parties MFI-DS`. Evolution clients become customers and vendors become suppliers, matched on `DCLink`, so it is safe to re-run. The accounts in `etl/control-accounts.json` (42000 Debtors Control, 22000 Creditors Control) are marked as control accounts. Payment terms start at 30 days; set each party's terms on the Customers and Suppliers pages.

Opening balances and history come later in phase 1.

### Learning how Evolution posts

`etl/sql/02-trace-posting.sql` records the SQL Evolution sends while you post one document, and `03-snapshot.sql` lists every PostGL, PostAR and PostST row that document wrote, grouped by audit number. That is how the posting rules for each document type are worked out, without touching Evolution's program files. Use a test copy of the company, not the live database during month-end.

## Tests

```bash
npm test         # unit tests, plus the end-to-end ledger suite against TEST_DATABASE_URL
```

The end-to-end suite wipes its database, so it only runs against a database whose name ends in `_test`. CI runs everything against SQL Server 2022 Express.
