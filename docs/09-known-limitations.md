# Known limitations and open items

Updated at the end of each phase.

## Phase 1 and phase 2 slice 1

- **No employee records yet.** The portal has the organisation, users and roles. Employee master data and the 45,000-person synthetic generator are the next slice of phase 2.
- **Sign-in codes go by email only.** Authenticator apps, passkeys and SSO come later. For demos, `DEMO_SHOW_CODES=true` shows the code on screen; it is ignored in production mode.
- **Rate limits are per API process** (in memory). With several API servers they need the Redis store (phase 3).
- **Translations are drafts.** Kiswahili, French and Arabic cover the portal shell only and have not been reviewed by professional translators. Page content is still English.
- **Redis and MinIO** run in Docker Compose but the code does not use them yet.
- **Statutory rules: none yet.** Nothing in this release calculates pay or tax.
- **Docker image tags** in `docker-compose.yml` were pinned without pulling them in this environment; check `docker compose up -d` on first use.
- The earlier build (PR #2) is left untouched. Its leave, loan, benefit and payroll rules for the previous eight countries are a reference only; Nigeria, South Africa, Mexico and New Zealand are not in the new country list.
