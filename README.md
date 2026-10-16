# Global People & Payroll Enterprise Platform

**Mindspace Portal** demo: HR and payroll for Mindspace Artificial Intelligence Inc. and its legal employers across 15 countries: Kenya, Uganda, Tanzania, Egypt, France, India, China, Australia, the Netherlands, Japan, South Korea, South Africa, Nigeria, Mexico and New Zealand. Web portal now; Android and iOS apps in phase 7.

**Designed and developed by Bhim Dhami. © 2026 Bhim Dhami. All rights reserved.**

This rebuild replaces the first Mindspace HR Portal (PR #2) on a new multi-country foundation. Every feature of the first build (staff profiles, leave, advances and loans, benefits, payroll, the policies and forms library, chat, the community page and the activity tracker) is being carried over before this is merged; see [docs/06-implementation-plan.md](docs/06-implementation-plan.md).

## What works today (phase 1 and phase 2, slice 1)

- Sign-in with password plus an emailed one-time code; rotating refresh tokens; device list and remote sign-out; lockout after five wrong passwords.
- Roles scoped to the whole group, a country or a single company, with segregation of duties (payroll maker, checker and treasury are kept apart) and limits on who can grant what.
- The demo group: 15 countries, 14 currencies, 18 legal entities, each with business units, branches, departments and cost centres. Admins add countries, currencies, companies and structure from the portal.
- Modules switched on or off per company.
- Append-only audit log.
- Light theme in KTM orange by default, with a dark theme and six colour presets to choose from; English, Kiswahili, French and Arabic (right to left) for the portal shell.
- OpenAPI docs at `/api/docs`.

See [docs/](docs/README.md) for requirements, architecture, data model, navigation map, plan, security model and known limitations.

| Part | Stack |
|---|---|
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16 |
| `apps/web` | Next.js 15, React 19 |
| `packages/shared` | Countries, currencies, languages, roles and permissions, theme tokens |
| Local services | PostgreSQL, Redis, MinIO, Mailpit (Docker Compose) |

## Quick start

You need Node 22 and Docker.

```bash
docker compose up -d                 # Postgres, Redis, MinIO and the Mailpit test inbox
cp .env.example apps/api/.env
npm install                          # also builds packages/shared
npm run db:migrate
npm run db:seed                      # 15 countries, 18 companies, 13 test accounts, ~11,000 fictional staff
npm run db:report                    # optional: headcount by country, company and department
npm run dev:api                      # http://localhost:4000/api  (docs at /api/docs)
npm run dev:web                      # http://localhost:3000
```

Sign-in codes arrive in the test inbox at **http://localhost:8025**. For a presentation, set `DEMO_SHOW_CODES=true` in `apps/api/.env` and the code is shown on the sign-in screen instead (never in production mode).

## Test accounts

Password for all: `Demo#Mindspace2026` (change `SEED_PASSWORD` before seeding anything but a laptop). Every address uses the reserved `.test` domain.

| Email | Role | Scope |
|---|---|---|
| admin@mindspace.test | Group administrator | Whole group |
| hr.global@mindspace.test | HR administrator | Whole group |
| hr.kenya@mindspace.test | HR administrator | Kenya |
| hr.france@mindspace.test | HR officer | France |
| hr.india@mindspace.test | HR officer | Mindspace Artificial Intelligence India Pvt Ltd only |
| payroll.kenya@mindspace.test | Payroll operator (maker) | Kenya |
| approver.kenya@mindspace.test | Payroll approver (checker) | Kenya |
| finance@mindspace.test | Finance | Whole group |
| treasury@mindspace.test | Treasury | Whole group |
| auditor@mindspace.test | Auditor | Whole group |
| ceo@mindspace.test | Executive | Whole group |
| manager@mindspace.test | Line manager | Mindspace Artificial Intelligence Kenya Ltd |
| employee@mindspace.test | Employee | Mindspace Artificial Intelligence Kenya Ltd |

Sign in as `hr.kenya` and then `hr.france` to see the data boundaries: each sees only their own country's companies, staff and users.

`manager` (Amina Mwangi) and `employee` (Kevin Otieno) are also employees in Kenya, so My profile and My team have data; so are `hr.kenya`, `payroll.kenya` and `approver.kenya` in the shared service centre. The seed gives each country 500 to 1,000 fictional people from a fixed random seed: see [docs/demo-data-report.md](docs/demo-data-report.md).

## Tests

```bash
npm run db:test:setup   # once: migrate the hrportal_test database
npm test                # shared unit tests and API integration tests on a real Postgres
npm run typecheck
```

## Licence

Proprietary. © 2026 Bhim Dhami. All rights reserved. No copying, distribution or reuse without written permission. All people, companies and figures in the demo data are fictional.
