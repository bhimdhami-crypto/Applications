# Requirements traceability matrix

Section numbers refer to the project brief. **Status:** ✅ done and tested · 🟡 partly done · ⬜ planned. "Evidence" names the code or test that proves a done item.

| ID | Brief § | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|---|
| R-01 | 1, 30 | Modular architecture; features switchable per company | 1-2 | ✅ | `docs/02-solution-architecture.md`; `entity_feature`; test "switches modules per company" |
| R-02 | 2 | Eleven brief countries plus the four from the first build (South Africa, Nigeria, Mexico, New Zealand) | 2 | ✅ | `packages/shared/src/countries.ts`; test "covers the fifteen countries"; seed |
| R-03 | 2, 4 | Several legal entities, business units, branches, departments, cost centres per country | 2 | ✅ | 18 seeded companies (2 in Kenya, India, Netherlands); `OrgService`; organisation tests |
| R-04 | 2, 25 | Admins add countries, companies, branches and currencies without code changes | 2 | ✅ | `/org/countries`, `/org/currencies`, `/org/entities` POST; test "keeps country and currency setup … to group admins" |
| R-05 | 3 | Next.js + React + TypeScript web portal, responsive | 1-2 | ✅ | `apps/web`; phone layout checked |
| R-06 | 3 | NestJS API with OpenAPI documentation | 2 | ✅ | `/api/docs` |
| R-07 | 3 | PostgreSQL, migrations | 2 | ✅ | `apps/api/prisma/migrations` |
| R-08 | 3 | Redis and object storage | 1, 3 | 🟡 | In Docker Compose; used from phase 3 |
| R-09 | 3 | Event-driven background jobs | 3-4 | ⬜ | |
| R-10 | 3, 20 | Expo mobile app for Android and iOS | 7 | ⬜ | Token design ready: mobile refresh flow tested |
| R-11 | 3 | Docker local environment, CI | 1 | ✅ | `docker-compose.yml`, `.github/workflows/ci.yml` |
| R-12 | 3 | Staging and production environments, IaC, monitoring | 10 | ⬜ | |
| R-13 | 4 | Hierarchy Group → Country → Legal entity → BU → Branch → Department → Cost centre → Employee | 2 | ✅ | `/org/tree`; each job record links an employee to business unit, branch, department and cost centre |
| R-14 | 4 | Strict company and country boundaries, also for multi-company users | 2 | ✅ | `resolveAccess`; tests "shows country HR only their country", "answers Not found for another country’s company" |
| R-15 | 4 | Shared service centres | 2 | 🟡 | Flag on the company; cross-company servicing scopes come with people data |
| R-16 | 4 | Transfers, secondments, intercompany | 2-4 | ⬜ | |
| R-17 | 4 | Global grades and salary bands, local titles | 2 | 🟡 | Global grades G1 to G7 (`job_grade`) with local job titles; salary bands to come with payroll |
| R-18 | 5 | Employee master record with effective-dated history | 2 | ✅ | `person`, `employment`, `assignment`, `compensation`; one open row per employment enforced in the database; test "keeps job history effective-dated" |
| R-19 | 6 | Lifecycle workflows A to T | 3 | ⬜ | |
| R-20 | 7 | Payroll engine and lifecycle, maker-checker, locking, reversals, simulation | 4 | 🟡 | Maker-checker roles and conflicts enforced now (test "refuses maker and checker") |
| R-21 | 8 | Country rule sets with source, verification and approval status | 5 | ⬜ | Design in architecture §6 |
| R-22 | 9 | Currencies with ISO decimals; group reporting currency | 2 | ✅ | `currencies.ts`; test "uses ISO 4217 minor units"; `reporting_currency` |
| R-23 | 9 | Effective-dated exchange rates, no uncontrolled re-translation | 4 | ⬜ | |
| R-24 | 10 | Localisation framework, RTL Arabic | 2, 6 | 🟡 | Language catalogue, 4 draft UI languages, RTL layout working; full catalogues in phase 6 |
| R-25 | 10 | Language preference at user, company, group level | 2 | ✅ | `preferred_language`, `default_language` on company and group |
| R-26 | 11-12 | Leave, attendance, scheduling | 3 | 🟡 | Leave done: requests, two-step approvals, balances, adjustments, calendar, public holidays per country, using each company's weekend days. Rules are the first build's draft pack `LEAVE-2026.1-draft`, marked unverified. `leave-rules.spec.ts`, `leave.e2e.spec.ts`. Attendance and scheduling later in phase 3 |
| R-27 | 13 | Recruitment, performance, talent | 3 | ⬜ | |
| R-28 | 14-15 | Employee and manager self-service | 2-3 | 🟡 | My profile (contacts, next of kin, photo, documents, bank change with HR approval), My team, My leave and Leave approvals; the rest in phase 3 |
| R-29 | 16, 22 | RBAC with scopes, segregation of duties, delegation limits | 2 | ✅ | `access.spec.ts`; `users.e2e.spec.ts` |
| R-30 | 17-18 | Dashboards and reports from live data | 6 | ⬜ | |
| R-31 | 19 | AI HR assistant with RAG and permission-checked tools | 6 | ⬜ | |
| R-32 | 21 | Oracle and SAP mock adapters | 8 | ⬜ | |
| R-33 | 22 | MFA | 2 | ✅ | Emailed one-time code; tests "accepts each code once" |
| R-34 | 22 | Session expiry and revocation | 2 | ✅ | Tests "rotates … refresh tokens", "lists my devices and signs one out", "signs a deactivated user out everywhere" |
| R-35 | 22 | Rate limiting and lockout | 2 | ✅ | Throttler on sign-in; test "locks the account after five wrong passwords" |
| R-36 | 22 | Audit trail of sensitive actions | 2 | ✅ | Test "keeps the audit log append-only"; scoped audit test |
| R-37 | 22 | OIDC SSO | 9 | ⬜ | |
| R-38 | 22 | Encryption of sensitive fields, malware scanning, backups | 2-9 | 🟡 | Identity and bank numbers encrypted with AES-256-GCM (`field-crypto.ts`), masked by default, every reveal audited; scanning and backups later |
| R-39 | 23 | Configurable workflow engine | 3 | ⬜ | |
| R-40 | 24 | Synthetic employees, reproducible seed. Changed by Bhim on 16 Oct 2026: 500 to 1,000 per country (7,500 to 15,000 in all) | 2 | ✅ | `staff-generator.ts`; 11,153 people; [verification report](demo-data-report.md); test "gives every country between 500 and 1,000 people" |
| R-41 | 26 | Light (default) and dark themes, colour presets, WCAG 2.2 AA colours | 1-2 | ✅ | `theme.ts` `ACCENTS`; contrast tests for every preset |
| R-47 | — | Keep every feature, form and policy of the first build (Bhim, 16 Oct 2026) | 2-4 | 🟡 | Port plan in `docs/06-implementation-plan.md` |
| R-42 | 26 | Company switcher limited to access rights | 2 | ✅ | `Shell.tsx`, `/me` entities |
| R-43 | 27 | Automated tests and CI | 1 | ✅ | 160 tests in CI (135 API, 25 shared) |
| R-44 | 28 | Paginated APIs, server-side filtering | 2 | ✅ | `/users`, `/audit`, `/employees` paginated and filtered on the server |
| R-45 | 29 | Product requirements, architecture, ERD, plans | 1 | ✅ | `docs/01` to `docs/09` |
| R-47 | — (first build) | Salary advances, staff loans and IOUs: limits, approval steps, payroll recovery, IOU settlement with receipts, loan book | 3-4 | 🟡 | Requests, quotes, staged approvals (manager, HR, Payroll, Finance, Country Head; one step per person, none on your own request), IOU settlement, cash repayments, loan book. Rules `LOANS-2026.1-draft` and the eight draft payroll packs, all marked unverified. `loan-rules.spec.ts`, `loans.e2e.spec.ts`. Deduction through month-end payroll comes with payroll |
| R-48 | — (first build) | Meal, gym and gift-voucher benefits with approvals | 3-4 | 🟡 | Options per company, enrolments (HR then Payroll), nominations (manager then HR), inbox, overview. `benefits.e2e.spec.ts`. Payslip lines come with payroll |
| R-49 | — (first build) | Policies and forms library with read confirmations | 3 | ✅ | `library.e2e.spec.ts`; group-only `policies.manage`; read report and reminders scoped to the HR user's companies |
| R-50 | — (first build) | Staff chat, community page with moderation, daily activity tracker | 3 | ✅ | `workplace.e2e.spec.ts`; chats and posts stay inside the group; reports go to HR for the author's company; the tracker records times, work mode and notes only (POL-21), managers see their team, HR and Payroll their companies |
| R-46 | — | Developer credit and copyright on the product | 1 | ✅ | `BRAND` in shared; footer, sidebar, sign-in, emails, API docs |
