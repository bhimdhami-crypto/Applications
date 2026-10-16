# Product requirements

**Product:** Global People & Payroll Enterprise Platform (demo brand: *Mindspace Portal*)
**Status:** Phase 1 baseline, October 2026
**Owner:** Bhim Dhami

## 1. Purpose

One HR and payroll platform for a multinational group with many legal employers in many countries. Every country and company runs its own payroll, policies and approvals, while the group sees consolidated headcount and employment cost in one reporting currency.

It replaces the earlier Mindspace HR Portal build (PR #2), which was designed for one company per country, eight African and Pacific countries, and payroll rules written directly in code.

## 2. Scope of the initial release

### Countries and currencies

| # | Country | ISO | Currency | Decimals | Interface languages |
|---|---|---|---|---|---|
| 1 | Kenya | KE | KES | 2 | English, Kiswahili |
| 2 | Uganda | UG | UGX | 0 | English, Kiswahili, Luganda |
| 3 | Tanzania | TZ | TZS | 2 | Kiswahili, English |
| 4 | Egypt | EG | EGP | 2 | Arabic (right to left), English |
| 5 | France | FR | EUR | 2 | French, English |
| 6 | India | IN | INR | 2 | Hindi, English |
| 7 | China | CN | CNY | 2 | Simplified Chinese, English, Traditional Chinese |
| 8 | Australia | AU | AUD | 2 | English |
| 9 | Netherlands | NL | EUR | 2 | Dutch, English |
| 10 | Japan | JP | JPY | 0 | Japanese, English |
| 11 | South Korea | KR | KRW | 0 | Korean, English |

Administrators add countries, currencies, companies, branches and languages through the admin console without code changes.

### Organisation hierarchy

Global Group → Country → Legal Entity → Business Unit → Branch → Department → Cost Centre → Employee.

### Users and their workspaces

| Persona | Main needs |
|---|---|
| Employee | Own profile, payslips, leave, attendance, expenses, letters, policies, HR cases, AI assistant |
| Line manager | Team view, approvals, delegation, reviews, team cost within their scope |
| Country HR | Employee records, lifecycle workflows, leave and attendance for their countries |
| Global HR / HR admin | Group-wide HR, configuration, job grades and salary bands |
| Payroll operator | Payroll inputs, runs, simulations, exceptions, payslips |
| Payroll approver | Checker role: reviews and approves runs prepared by someone else |
| Finance | Journals, liabilities, GL reconciliation, FX, intercompany recharges |
| Treasury | Payment files and payment confirmations |
| Auditor | Read-only access to records and the audit trail in their scope |
| Group admin / IT security | Users, roles, integrations, feature flags, system health |
| Executives | Group and country dashboards |

## 3. Functional requirements

The full list, with IDs used in the traceability matrix, is in [03-requirements-traceability.md](03-requirements-traceability.md). The headline capabilities are:

1. **Multi-company and multi-country:** separate payroll per legal entity, transfers and secondments between entities and countries, shared service centres, global grades with local titles, strict data boundaries even for users who can see several companies.
2. **Employee master data:** effective-dated records with full history, duplicate detection, configurable mandatory fields per country, self-service changes that go through approval, field-level protection for bank, tax, medical and employee-relations data.
3. **Employee lifecycle:** requisition to exit, each step a workflow with status, owner, deadline, approvals, comments, attachments, notifications and audit.
4. **Payroll engine:** configurable frequencies and pay groups, the full earnings and deductions catalogue, retro and off-cycle runs, maker-checker approvals, period locking. Lifecycle: Draft → Input validation → Calculation → Exception review → Reconciliation → Approval → Finalisation → Payment file → Payment confirmation → GL posting → Period closure. Approved runs are never overwritten: corrections are reversal or adjustment records.
5. **Country compliance framework:** every statutory rule is effective-dated and versioned, records its source, jurisdiction, verification date and approval status, and cannot be shown as certified until a qualified person approves it.
6. **Multi-currency:** payroll, functional and group reporting currencies; effective-dated controlled exchange rates; historical results are never re-translated with today's rate.
7. **Localisation:** interface, notifications, payslips and policy content in the languages above, right-to-left Arabic, local number, date and currency formats, user, company and group language preferences.
8. **Leave, time and attendance:** statutory and company leave types, accrual, carry forward, half days, team calendars, shifts, overtime approval, timesheets checked against payroll.
9. **Talent:** recruitment, onboarding, probation, performance, learning, succession, engagement surveys. AI may summarise but never decides on people.
10. **Self-service:** employee and manager portals on web and mobile.
11. **Dashboards and reports:** executive, payroll, HR and finance dashboards from live data with permission-aware filters, plus a report builder and standard report library, exports to Excel, CSV and PDF.
12. **AI HR assistant:** answers from approved, versioned policy documents with citations and from the user's own data through permission-checked tools. Never sees the database directly, never discloses other people's data, never approves anything.
13. **Mobile apps:** one React Native (Expo) codebase for Android and iOS: sign-in with MFA and biometrics, payslips, leave, attendance, expenses, approvals, announcements, assistant, push notifications.
14. **Oracle and SAP integration:** a connector framework with field mapping, retries, dead-letter queue, idempotency keys and reconciliation; mock Oracle Fusion and SAP adapters; CSV/SFTP fallback.
15. **Workflow and notifications:** configurable sequential, parallel and conditional approvals with thresholds, delegation, escalation, SLAs and versioning.
16. **Administration console:** everything configurable listed in section 25 of the brief.

## 4. Demonstration data

Synthetic data only. Each of the 11 countries gets an independently drawn employee count between 4,000 and 5,000 from a fixed random seed, so the group totals 44,000 to 55,000 people, with at least 12 months of payroll history and the related leave, attendance, recruitment, performance, expense and workflow records. Contact details use reserved test domains, bank details are test-only, and identifiers are marked as specimens. A verification report lists the actual counts by country, company and department.

## 5. Non-functional requirements

| Area | Target |
|---|---|
| Scale | 55,000 employees, 11 countries, concurrent payroll teams per country |
| API latency | p95 under 300 ms for paged list and detail endpoints at 50,000 employees (to be proven by load tests in phase 9) |
| Payroll run | A 5,000-employee monthly run calculated in under 2 minutes in a background job (to be proven in phase 4) |
| Availability | 99.9% for self-service in production, with documented recovery point and recovery time objectives |
| Security | OIDC and OAuth 2.0, MFA, RBAC plus attribute scopes, encryption in transit and at rest, full audit of sensitive reads, changes, approvals and exports |
| Accessibility | WCAG 2.2 AA |
| Money | Decimal arithmetic only, explicit rounding per currency and rule, documented calculation order |

## 6. Out of scope until confirmed

- Production Oracle and SAP connections: built only against confirmed target APIs and credentials.
- Statutory rates and thresholds: loaded only from official sources and approved by a qualified local payroll specialist. Until then every rule is shown as *unverified*.
- Legally authoritative translations: machine translation is a draft until professionally reviewed.
- Real employee data of any kind.

## 7. Acceptance

The initial release is accepted against section 31 of the brief. Each phase ends with working code, test results, updated documents and a list of what is not finished ([06-implementation-plan.md](06-implementation-plan.md)).
