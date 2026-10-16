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
| Leave: requests, approvals, balances, team calendar, public holidays | Phase 3 | Planned |
| Salary advances, staff loans and IOUs with approvals and payroll recovery | Phase 3-4 | Planned |
| Meal, gym and gift-voucher benefits | Phase 3-4 | Planned |
| Month-end payroll and payslips for the first build's eight countries | Phase 4, rule packs marked unverified | Planned |
| Policies and forms library (22 policies, 20 fillable forms) with read confirmations | Phase 3 | Planned |
| Staff chat, community page with moderation, daily activity tracker | Phase 3 | Planned |

## Phase 2, slice 2: employee master (this pull request)

- Persons, employments, effective-dated job records (grade, business unit, department, branch, cost centre, manager) and pay records, with the database refusing overlapping open records.
- Profile details, next of kin and beneficiaries, photos (or a drawn avatar), the HR document register with uploads, verification and HR-only documents.
- Identity and bank numbers encrypted at rest, masked on screen, and every reveal written to the audit log.
- Bank detail changes go to HR for approval by someone other than the requester.
- Staff directory with search and filters, My profile, My team for managers, Hire someone, Headcount, Change requests.
- 11,153 fictional people across the 15 countries, 500 to 1,000 per country, with the verification report in [demo-data-report.md](demo-data-report.md).

Next: leave (requests, approvals, balances, team calendar, public holidays), then advances, loans and IOUs, benefits, the policies and forms library, chat, community and the activity tracker, then payroll for the first build's eight countries.
