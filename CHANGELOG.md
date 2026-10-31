# Changelog

## Milestone 7: HR ERP release (October 2026)

### New modules
- **Workforce analytics** (`/analytics`, `GET /api/analytics/workforce`): headcount, joiners and leavers, attrition, tenure, age, grade, contract, gender and location; per company or group; CSV export.
- **Organisation** (`/organisation`, `/api/organisation/*`): legal entities, departments with heads, interactive reporting-line chart. Sample staff now get reporting lines on import (`npm run db:sample-reporting-lines` for existing data).
- **Recruitment** (`/recruitment`, `/api/recruitment/*`): job openings with references and pay ranges, candidate pipeline board, interview scores, hire-to-employee with login and welcome email.
- **Performance** (`/performance`, `/api/performance/*`): weighted goals, review cycles, self and manager reviews with email notifications, rating distribution.
- **Audit trail** (`/audit`, `GET /api/audit`): read-only, filterable log for administrators.

### Interface
- New design system: IBM Plex Sans, a white, grey and orange colour theme (bright `#FF6600` accents, accessible deeper orange for buttons and links, dark-grey text, charcoal dark mode), full dark mode, consistent page headers, key-figure tiles, status badges, empty states and SVG/CSS charts.
- New app shell: grouped, collapsible, icon navigation; top bar with breadcrumbs, people search (`/`), pay period, notification bell and account menu with theme switch; mobile drawer.
- Redesigned sign-in, dashboard (group companies payroll track, "waiting for you" list), employees, staff profile (hero and tabs), payroll runs, payroll register (search, paging, CSV export), payslip document and every other page.

### Legal and credits
- Public `/legal` page: disclaimer, terms of use, privacy notice, copyright and credits.
- Footer on every page with the copyright line and "Designed and created by Bhim Dhami"; terms acceptance note on sign-in; computer-generated notice on payslips.
- Proprietary `LICENSE`; `author` and `license` set in every `package.json`.

### Platform
- Security headers on the API (helmet) and the website; `GET /api/health`; graceful shutdown.
- `/api/auth/me` returns `hasPhoto` instead of the photo storage key.
- Docker images (`docker/Dockerfile`) and `docker-compose.prod.yml`; Next.js standalone output; Prisma CLI available at runtime for `migrate deploy`.
- Migration `20261014090000_recruitment_performance`; indexes on `Employee.managerId` and `AuditLog.createdAt`.
- End-to-end tests for every new module and role boundary; `npm run typecheck` now covers the website.
- `.editorconfig`, `.prettierrc.json`, `.nvmrc`, `.dockerignore`.
