# Implementation plan

Ten phases, following section 30 of the brief. Each phase ends with working code on a pull request, passing tests, updated documents and a list of unfinished items. Nothing is called complete until its core workflow works and its tests pass.

| Phase | Delivers | Key acceptance checks |
|---|---|---|
| **1. Foundations** | Requirements, architecture, traceability matrix, data model, navigation map, security model, UI design; working local environment | Docs reviewed; `docker compose up` plus the quick start brings up the portal |
| **2. Identity, organisation, people** | Sign-in with MFA, sessions, roles with group, country and company scopes; group, countries, currencies, legal entities, business units, branches, departments, cost centres; feature flags per company; employee master with effective-dated history; 45,000-person synthetic generator | Isolation tests prove a country HR user cannot read or change another country's records; generator report shows 4,000 to 5,000 people per country |
| **3. Self-service and workflow** | Workflow engine, notifications, documents with malware scanning, employee and manager portals, leave, holidays, attendance, shifts, timesheets, overtime, expenses, onboarding and exit | End-to-end tests for leave request to approval to balance, and onboarding to first day |
| **4. Payroll engine** | Pay groups, calendars, salary components, run lifecycle with maker-checker, locking, simulations, reversals, payslips, payment files, GL journals, FX rates, 12 months of synthetic payroll | Duplicate-run prevention, reversal and retro tests; run calculated, approved, finalised, reconciled and exported |
| **5. Country compliance** | Rule set framework with source, verification and approval; rule packs for the 15 countries loaded from official sources and marked unverified until a local specialist signs off; statutory exports | Each rule shows its verification status; tests use independently verified fixtures where available |
| **6. Insight and assistant** | Executive, payroll, HR and finance dashboards; report builder and standard reports; AI assistant with policy retrieval and permission-checked tools; full translation catalogues and RTL | Dashboards match database totals; assistant permission tests |
| **7. Mobile** | Expo app for Android and iOS: MFA and biometrics, payslips, leave, attendance, expenses, approvals, assistant, push | Sign-in and core flows on both platforms; store submission guide |
| **8. Integrations** | Connector framework, Oracle Fusion and SAP mock adapters, CSV/SFTP fallback, monitoring and reconciliation | Contract tests against the mocks |
| **9. Hardening** | Load tests at 55,000 people, security review, row-level security, SSO, accessibility audit, backup and restore drills | Published results, not claims |
| **10. Go-live readiness** | Deployment templates, monitoring, runbooks, manuals, country readiness checklist, parallel payroll plan | Release checklist signed off |

## Phase 1 and the start of phase 2 (this pull request)

Done in this pull request:

- Phase 1 documents in `docs/`.
- Local environment: Postgres, Redis, MinIO and Mailpit in Docker Compose; npm workspaces; CI on every push.
- Shared package: the 15 countries, 14 currencies with their decimal places, the language catalogue with text direction, roles and permissions, brand and theme tokens.
- API: sign-in with password and emailed one-time code, rotating refresh tokens with reuse detection, sign-out and session list; role assignments scoped to group, country or company; the organisation hierarchy with create and edit; countries and currencies that admins can extend; feature switches per company; audit log; OpenAPI docs at `/api/docs`.
- Web portal: sign-in, light and dark themes in KTM orange, language switcher with right-to-left Arabic, company switcher limited to the user's access, dashboard, organisation explorer, users and roles, countries and currencies, audit log, and the developer credit on every page.
- Seeded demo group: Mindspace Artificial Intelligence Inc. with 15 countries and 18 legal entities, their business units, branches, departments and cost centres, and 13 test accounts.
- Light theme with KTM orange as the default; dark theme and six colour presets in the top bar and on My account.

## Carrying over the first build (decided 16 October 2026)

Bhim asked that nothing from the first build is lost: every feature, form and policy stays, and its four countries (South Africa, Nigeria, Mexico, New Zealand) join the eleven in the brief. This pull request is merged only once all of these work on the new foundation:

| First-build feature | Where it lands | Status |
|---|---|---|
| Staff profiles: job, contact, IDs, education, next of kin, photo, HR documents | Phase 2 employee master | Done |
| Sample staff | Generator: 500 to 1,000 per country, reproducible seed ([report](demo-data-report.md)) | Done |
| Leave: requests, approvals, balances, team calendar, public holidays | Phase 3, draft rule pack marked unverified | Done |
| Salary advances, staff loans and IOUs with approvals and payroll recovery | Phase 3-4, draft rules marked unverified | Done |
| Meal, gym and gift-voucher benefits | Phase 3-4 | Done |
| Month-end payroll and payslips for the first build's eight countries | Phase 4, rule packs marked unverified | Done |
| Policies and forms library (22 policies, 20 fillable forms) with read confirmations | Phase 3 | Done |
| Staff chat, community page with moderation, daily activity tracker | Phase 3 | Done |

## Phase 2, slice 2: employee master (this pull request)

- Persons, employments, effective-dated job records (grade, business unit, department, branch, cost centre, manager) and pay records, with the database refusing overlapping open records.
- Profile details, next of kin and beneficiaries, photos (or a drawn avatar), the HR document register with uploads, verification and HR-only documents.
- Identity and bank numbers encrypted at rest, masked on screen, and every reveal written to the audit log.
- Bank detail changes go to HR for approval by someone other than the requester.
- Staff directory with search and filters, My profile, My team for managers, Hire someone, Headcount, Change requests.
- 11,153 fictional people across the 15 countries, 500 to 1,000 per country, with the verification report in [demo-data-report.md](demo-data-report.md).

## Phase 3, first slice: leave from the first build (this pull request)

- Nine leave types from the Leave and Holidays Policy and the Parental and Family Policy, with the first build's country overrides (Mexico, Egypt, South Africa, New Zealand), as rule pack `LEAVE-2026.1-draft`. Every balance screen says the pack is unverified, and each request records the pack version it was counted under.
- Requests go to the line manager in force today (when they have a portal account), then to HR for study, maternity, paternity and unpaid leave. HR recording leave for someone approves it at once. Nobody decides their own leave, and two deciders at once cannot both win.
- Working days use each company's weekend days and the country's public holidays. The portal drafts holidays only for the first build's eight countries; France, India, China, Australia, the Netherlands, Japan and Korea start empty for HR to enter from the gazette. HR confirms or removes drafts.
- Who is away: HR sees a company, managers everyone below them, others their teammates without the reason.
- Companies with leave switched off refuse new requests.
- About 18,600 fictional leave requests for 2026 in the demo data.

## Phase 3, second slice: advances, loans and IOUs from the first build (this pull request)

- Salary advances, five kinds of staff loan and IOUs, with the first build's limits as rule pack `LOANS-2026.1-draft`: an advance up to half of net pay once in any 3 months, loans up to 3 times gross pay (housing more, with the Country Head), take-home pay kept above a third of gross. Every screen says the rules are unverified.
- Advances and loans only where one of the first build's eight draft payroll packs can work out net pay and recover them (Kenya, Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico, New Zealand). Those packs are copied as they were and marked `verified: false`. IOUs work everywhere.
- One approvals inbox. Steps run in order (manager, HR, Payroll, Finance, Country Head as the request needs), each step by a different person, never on your own request, and two people deciding at once cannot both win.
- IOUs are settled with receipts that only Finance in that company can open; Finance confirms, sends back, recovers an overdue IOU through payroll, or records cash repayments.
- The loan book for Payroll and Finance, limited to their companies. Loan details are visible only to the employee, their approvers, Payroll and Finance.
- Companies with loans switched off refuse new requests. About 970 fictional requests in the demo data.

## Phase 3, third slice: meal, gym and gift-voucher benefits from the first build (this pull request)

- Each company's meal and gym options with the company and employee share and who may join by work location. The first build's six Kenyan options are carried over as draft prices for HR to confirm; other companies start empty and HR adds their own.
- Employees join from a month that payroll has not closed (HR, then Payroll approve), one meal option at a time, and end a membership at the end of the open payroll month.
- Managers nominate their direct reports and HR anyone in their companies for gift vouchers; the nominator's own step counts, someone else approves the rest, and the voucher is taxed in the month it is issued.
- The approvals inbox now carries enrolments and nominations next to loans. The employee's share of gym and meal plans counts against what an advance or loan may take.
- HR, Payroll and Finance see each company's options, members, monthly cost and the year's vouchers; only HR changes options.
- About 220 memberships and 26 vouchers for the Kenyan companies in the demo data.

## Phase 3, fourth slice: policies and forms from the first build (this pull request)

- The first build's 22 group policies and 20 HR forms (draft pack, version 0.1), with the original PDFs under `sample-data/library`. The page says the pack is a draft not yet reviewed by lawyers in each country.
- Staff open a policy and confirm they have read it; the portal counts what is still to read. A new version asks everyone again, unless HR marks it a small correction.
- Only group HR administrators publish, change or hide policies and forms (new group-only permission `policies.manage`). HR in each country sees, for their own companies, who has read the current version and emails a reminder to those with a portal account.
- About 19,000 fictional read confirmations for three widely read policies in the demo data.

## Phase 3, fifth slice: chat, community page and activity tracker from the first build (this pull request)

- Direct and group chats between colleagues anywhere in the group, with unread counts. Leaving a group keeps what was said before; deleting a message hides it but keeps the record (POL-20 3.10).
- The community page: posts with up to four photos, MP4 videos or PDFs (the author confirms they may share them), likes and comments.
- Anyone can report a message, post or comment. The report goes to HR for the author's company, who remove it (the author is emailed) or keep it. HR in another country cannot see it.
- My day: clock in and out with where you work (office, remote, on site), work notes, corrections for the last 7 days marked as edited, and forgotten clock-outs closed after 16 hours. No location, screen or keystrokes are recorded (POL-21).
- Team activity: managers see everyone below them; HR and Payroll see a whole company, with a monthly report and CSV export. Switched off with the company's time and attendance module.
- Sample chats, two posts with one open report, and two weeks of fictional clock-ins and work notes for the Kenyan companies.

## Phase 4, first slice: month-end payroll and payslips from the first build (this pull request)

- Payroll prepares a company's month from its draft country pack: pay records in force, part months for joiners and leavers, unpaid and half-pay sick leave, advance, loan and IOU instalments, and meal, gym and voucher lines. Staff without a pay record, or paid in another currency, are listed to check rather than guessed.
- Maker and checker: Payroll prepares, recalculates and sends for approval; a payroll approver who did not prepare it approves or sends it back with a note, then finalises. Finalising locks the month (new deductions start the month after), records each loan repayment against its payslip, closes repaid loans and emails employees that their payslip is ready, without amounts.
- A company cannot have two runs for a month or a new run before one already under way. Companies with payroll switched off, or without a pack (France, India, China, Australia, the Netherlands, Japan, Korea), are refused; "Prepare for all my companies" skips them and says why.
- Every run, payslip, register CSV and approval email says the rules are unverified drafts. Payslips are printable and watermarked "Unverified draft".
- Totals stay in each company's currency: there is no approved exchange-rate table yet, so no USD figures are shown.
- A finalised September 2026 for the nine companies with a pack in the demo data, with about 5,400 payslips; September's loan repayments are linked to their payslips.

Next: the rest of phase 4 (pay groups, reversals, payment files, GL journals and exchange rates).
