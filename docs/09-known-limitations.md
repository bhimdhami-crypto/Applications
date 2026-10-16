# Known limitations and open items

Updated at the end of each phase.

## Phase 1 and phase 2 slice 1

- **No employee records yet.** The portal has the organisation, users and roles. Employee master data and the 45,000-person synthetic generator are the next slice of phase 2.
- **Sign-in codes go by email only.** Authenticator apps, passkeys and SSO come later. For demos, `DEMO_SHOW_CODES=true` shows the code on screen; it is ignored in production mode.
- **Rate limits are per API process** (in memory). With several API servers they need the Redis store (phase 3).
- **Translations are drafts.** Kiswahili, French and Arabic cover the portal shell only and have not been reviewed by professional translators. Page content is still English.
- **Redis and MinIO** run in Docker Compose but the code does not use them yet.
- **Statutory rules: none yet.** Nothing in this release calculates pay or tax.
- **Leave rules are an unverified draft** (`LEAVE-2026.1-draft`), carried over from the first build. Entitlements, carry-over and the country overrides have not been checked against current law. Holiday dates for the first build's eight countries are generated drafts (Islamic holidays are estimates); the other seven countries have none until HR enters them.
- **Loan rules and payroll packs are unverified drafts** (`LOANS-2026.1-draft`, and the eight country payroll packs from the first build). Net pay, limits and instalments are estimates. Instalments are not deducted yet; that arrives with month-end payroll, until then the demo history stops at September 2026.
- **Advances and loans only in the eight countries with a draft payroll pack.** France, India, China, Australia, the Netherlands, Japan and Korea can request IOUs only.
- **Benefit prices are drafts.** Kenya's six meal and gym options come from the first build and await HR's confirmation; the other fourteen companies have no options until HR adds them. Payslip lines for benefits in kind, cash meal allowances and employee shares arrive with month-end payroll.
- **Half days** are not supported yet; leave counts whole working days.
- **Docker image tags** in `docker-compose.yml` were pinned without pulling them in this environment; check `docker compose up -d` on first use.
- The earlier build (PR #2) is left untouched. Its features are being carried over one by one (see the implementation plan); its four extra countries are already part of the fifteen.
