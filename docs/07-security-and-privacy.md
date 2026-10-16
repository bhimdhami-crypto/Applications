# Security and privacy model

## 1. Identity

| Control | Now (phase 2) | Later |
|---|---|---|
| Sign-in | Password (bcrypt, cost 12, at least 12 characters with letters and digits) then a 6-digit code by email | TOTP apps and passkeys; biometrics on mobile (phase 7) |
| SSO | Token issuer built in | OIDC / OAuth 2.0 federation with Entra ID, Okta or Keycloak (phase 9) |
| Brute force | 5 wrong passwords lock the account for 15 minutes; 5 wrong codes void the challenge; rate limits on every sign-in endpoint; unknown emails take as long as wrong passwords | Redis-backed limits across servers |
| Tokens | 15-minute access JWT naming the session; refresh tokens rotate on every use and are stored only as hashes; a replayed refresh token ends the session | |
| Web | Refresh token in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`; access token only in memory | |
| Mobile | Refresh token returned to the app for the device keystore (Keychain / Keystore) | Device binding |
| Revocation | Every request re-checks the session, so sign-out, deactivation and password change take effect at once | |

## 2. Authorisation

- **Roles** (see `packages/shared/src/access.ts`): group admin, HR admin, HR officer, payroll operator (maker), payroll approver (checker), finance, treasury, auditor, executive, manager, employee.
- **Scope** of each role: whole group, one country, or one legal entity. Permissions resolve to the exact list of companies.
- **Group-only powers** (new legal entities; countries and currencies) cannot come from a country or company role.
- **Segregation of duties:** one person cannot hold payroll operator with payroll approver or treasury, or approver with treasury, over the same company. Group admins configure but cannot approve payroll or release payments. Nobody can change their own roles.
- **Delegation limits:** only group admins can hand out payroll, finance, treasury, auditor and admin roles. Country HR admins can grant HR officer, manager, employee and executive roles inside their own countries only.
- **Not found, not forbidden:** records outside a user's scope answer 404, so other companies' data is not revealed by its existence.
- **Field-level permissions** for bank, tax and identity data (`people.sensitive.read`) and employee-relations and medical records (`people.relations.read`) are in place for phase 2 and 3 screens.

## 3. Audit

Append-only `audit_log`, enforced by a database trigger, records sign-ins, failed passwords, lockouts, refresh-token reuse, user and role changes, organisation changes and feature switches, with actor, company, IP and detail. Sensitive reads and exports join it from phase 2 (employee records) and phase 6 (reports). Auditors see the log within their own scope.

## 4. Platform

- Helmet security headers on the API; frame, content-type, referrer and permissions headers on the web portal.
- Input validation on every endpoint with unknown fields rejected.
- Secrets come from the environment; `JWT_SECRET` must be at least 16 characters or the API will not start. Production uses a secrets manager (phase 10).
- TLS everywhere outside a laptop; `COOKIE_SECURE=true` behind HTTPS.
- Planned: malware scanning of uploads (phase 3), encryption of sensitive columns (phase 2), PostgreSQL row-level security (phase 9), backup and restore drills (phase 9).

## 5. Privacy by jurisdiction

The platform will hold records of processing, consent where required, retention schedules per country and data-residency settings per company. The applicable laws include the EU GDPR (France, Netherlands), Kenya's Data Protection Act 2019, Uganda's Data Protection and Privacy Act 2019, Tanzania's Personal Data Protection Act 2022, Egypt's Personal Data Protection Law 151 of 2020, India's DPDP Act 2023, China's PIPL, Australia's Privacy Act 1988, Japan's APPI and South Korea's PIPA. **This list is not a legal assessment.** Hosting, retention and cross-border transfer rules must be confirmed by qualified local counsel before go-live, especially for China (PIPL transfer rules) and the EU.

## 6. Demonstration data

Only synthetic people. Emails use the reserved `.test` domain, identifiers are marked as specimens and bank details are test-only, so nothing in the demo can reach a real person or account.
