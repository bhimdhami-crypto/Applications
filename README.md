# Mindspace HR ERP

> Designed and created by **Bhim Dhami** · © 2026 Bhim Dhami. All rights reserved. See [LICENSE](LICENSE).

HR, payroll and people-operations platform for **Mindspace Artificial Intelligence Inc.** and its subsidiaries in Kenya, Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico and New Zealand: one portal for 12,000+ staff, eight payroll rule sets and eight currencies.

![Admin dashboard](docs/screenshots/02-admin-dashboard.png)

## Modules

| Area | Module | What it covers |
|---|---|---|
| Overview | **Dashboard** | Role-aware home: key figures, every subsidiary's payroll month on a draft, approved, finalised track, and one list of everything waiting for you |
| | **Workforce analytics** | Headcount, joiners and leavers, attrition, tenure, age, grade, contract, gender and location, per company or group-wide, with CSV export |
| Core HR | **Employees and staff profiles** | Records, job and pay, IDs, education, next of kin, photos and HR documents with verification |
| | **Organisation** | Legal entities, departments with their heads, and an interactive reporting-line chart |
| | **Recruitment** | Job openings with pay ranges, a candidate pipeline board, interview scores, and one-click hire that creates the employee and login |
| | **Performance** | Weighted goals, review cycles with self and manager reviews, rating distribution and progress tracking |
| Time | **Leave** | Requests, two-step approvals, balances, carry-over, team calendar and public holidays for eight countries |
| | **My day and team attendance** | Clock in and out, work notes, corrections, monthly attendance report |
| Pay | **Payroll** | Month-end runs per company with statutory rules for eight countries, payroll register with CSV export, approval and finalisation |
| | **Payslips** | Printable payslips with earnings, deductions, employer contributions and benefits in kind |
| | **Advances, loans and IOUs** | Requests with live repayment quotes, three-step approvals, payroll recovery and the loan book |
| | **Benefits** | Meal vouchers, gym plans and gift vouchers, taxed on the payslip |
| Workplace | **Policies and forms** | 22 policies and 20 forms with read confirmations per version |
| | **Chat, community and moderation** | Direct and group chat, a company feed with media, reporting and moderation |
| Control | **Audit trail** | Read-only log of sign-ins, changes and approvals, filterable by action, person, record and date |

| Part | Stack |
|---|---|
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16, helmet security headers, health check at `/api/health` |
| `apps/web` | Next.js 15 (App Router), React 19, IBM Plex Sans, Lucide icons, light and dark themes |
| Email in development | Mailpit (catches every email locally) |
| CAPTCHA | Cloudflare Turnstile (free) |
| Deployment | Docker images for the API and the website (`docker/Dockerfile`, `docker-compose.prod.yml`) |

Milestones delivered: secure sign-in, employee records and payroll (1); staff profiles and 12,408 sample staff (2); leave (3); advances, loans and benefits (4); payroll for all eight countries (5); policies, chat, community and the activity tracker (6); **HR ERP release (7): the new interface, workforce analytics, organisation, recruitment, performance, audit trail and production packaging.**

## Quick start

You need Node 22 and Docker.

```bash
docker compose up -d                 # Postgres on 5432, Mailpit on 8025/1025
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm install
npm run db:migrate
npm run db:seed                      # companies, the seven test accounts, benefit options, policies, sample chats, job openings and a review cycle
npm run db:import-sample             # optional: 12,408 sample staff with documents, photos and reporting lines
npm run dev:api                      # http://localhost:4000/api
npm run dev:web                      # http://localhost:3000
```

Open **http://localhost:3000** for the portal and **http://localhost:8025** for the test inboxes. In GitHub Codespaces, run `dev:api` and `dev:web` in two terminals, then open ports 3000 and 8025 from the **Ports** tab.

Open the test inbox to see the emails. Every email the portal sends (sign-in codes, welcome emails, payslip notices) lands there, so the test accounts need no real mailbox.

## Test accounts

All emails use the reserved `.test` domain, so nothing can ever reach a real person.

| Email | Password | Role | What they can do |
|---|---|---|---|
| admin@mindspace-ai.test | `Admin#Mindspace2026` | Administrator | Everything: add and delete employees, give any role, approve and finalize payroll, read the audit trail |
| hr@mindspace-ai.test | `Test#Mindspace2026` | HR | Add and edit employees (employee or manager role only), workforce analytics, recruitment and hiring, review cycles |
| payroll@mindspace-ai.test | `Test#Mindspace2026` | Payroll | Create and recalculate payroll drafts, workforce analytics |
| manager@mindspace-ai.test | `Test#Mindspace2026` | Manager | See their own team (no pay figures), hire for their openings, review their team and set goals |
| developer@mindspace-ai.test | `Test#Mindspace2026` | Employee | Own profile and payslips, goals and self review (fully remote) |
| tester@mindspace-ai.test | `Test#Mindspace2026` | Employee | Own profile and payslips, goals and self review |
| finance@mindspace-ai.test | `Test#Mindspace2026` | Finance | Approve advances, loans and IOUs; confirm IOU settlements; the loan book |

Change the passwords with `SEED_ADMIN_PASSWORD` and `SEED_USER_PASSWORD` before seeding anything other than a laptop. The seed refuses to run with `NODE_ENV=production` unless both are set.

## Staff profiles

Every employee has a profile page (**My profile** in the menu for your own). It holds job details, contact details, IDs, education, up to five next of kin, a profile photo and HR documents.

| Who | Sees | Can change |
|---|---|---|
| HR and admin | Everything, including HR-only documents | Everything; their uploads are verified straight away; verify, reject or delete documents |
| Payroll | Everything, including pay and IDs | Nothing |
| The employee | Their own profile and documents, except HR-only ones | Phone, personal email, marital status, dependants, next of kin and photo; uploads wait for HR to verify |
| Their manager | Job details and photo of their direct reports | Nothing (no pay, IDs, next of kin or documents) |

Uploads must be PDF, PNG, JPEG or WebP (checked from the file contents, not the name), up to 10 MB; photos up to 5 MB. Files are stored on disk under `apps/api/storage/` (set `STORAGE_DIR` to move it). That folder is not in git.

### Sample staff

`npm run db:import-sample` loads the 12,408 sample employees in `sample-data/` across the eight countries, with one next of kin each, 156,381 document register entries and an avatar for everyone. Eight people have scanned specimen files (ID, education certificate, profile summary). It takes under a minute, skips anyone already imported, and does not create logins, so the sample staff cannot sign in. Run `npm run db:seed` first.

All sample data is fictional, and IDs start with `SPECIMEN`.

## Leave

Staff request leave under **My leave**. The portal counts working days, skipping the weekend (Friday and Saturday in Egypt) and the country's public holidays.

| Leave | Allowance | Approved by |
|---|---|---|
| Annual | 21 working days, +1 for every 2 years of service, up to 25 (more where the law says so: Mexico, and Egypt after 10 years or from age 50). Pro-rated in the year someone joins. Up to 5 unused days carry over. | Manager |
| Sick | 30 days on full pay, then 30 on half pay. A medical certificate is needed after 2 days. | Manager |
| Floating holiday, family care | 2 and 5 days a year | Manager |
| Compassionate | 5 days per bereavement | Manager |
| Study | 10 days a year | Manager, then HR |
| Maternity or primary caregiver | 16 weeks (4 months in South Africa and Egypt, 26 weeks in New Zealand) | Manager, then HR |
| Paternity or partner | 4 weeks | Manager, then HR |
| Unpaid | Up to 3 months | Manager, then HR |

- Requests go to the employee's manager, who is emailed and has 3 working days to respond. Staff without a manager in the portal go straight to HR.
- HR can record leave for anyone, approved at once (useful for the imported staff, who have no login), and adjust balances for opening balances.
- **Leave calendar:** HR, payroll and admins see a whole company; managers see their team; everyone else sees when teammates are away, but not why.
- **Payroll:** unpaid leave, and sick leave past the full-pay days, reduce basic pay for those working days before tax. Every payslip shows the annual leave left.
- **Public holidays** for 2026 onwards are generated for each country the first time they are needed. Islamic holidays are estimates: HR checks them against the official gazette and corrects them under **Leave calendar > Public holidays**.

**These rules are drafts (`LEAVE-2026.1-draft`).** HR in each country should confirm them against local law before go-live.

## Advances, loans and IOUs

Staff ask under **Advances and loans** (forms HR-F02, HR-F03 and HR-F04 of the Staff Advances, Loans and IOUs policy, POL-22). The form shows the monthly deduction and take-home pay before anything is sent.

| | Limit | Repaid | Approved by |
|---|---|---|---|
| Salary advance | Half of net pay, once in any 3 months | In full from the next salary | Manager, Payroll, Finance |
| Staff loan | 3 times monthly gross pay over up to 36 months; permanent staff after 6 months | Monthly instalments on a reducing balance: personal and vehicle 5%, housing 4%, education and emergency interest-free | Manager, HR, Finance; Country Head (the admin) for a housing loan above 3 times gross pay |
| IOU | Cash for a business purchase | Settled with receipts within 14 days; Finance recovers whatever was not spent or returned | Manager, Finance |

- Each step is approved by a different person, and nobody approves their own request. Everything waiting for someone is under **Loan and benefit approvals**, with an email at each step.
- Take-home pay must stay above a third of gross pay. The request is refused if it would not, and payroll takes less (the loan runs longer) if pay drops.
- **Payroll** deducts advances, IOU balances and loan instalments after tax. Repayments are recorded when the run is finalized. Someone leaving repays everything from final dues; the **Loan book** flags anything still owed.
- **Finance** confirms IOU settlements against the receipts, recovers an overdue IOU through payroll after emailing the employee, and records cash repayments.
- **Privacy:** loan details are visible to the employee, Payroll, Finance and their approvers only.
- **Kenya:** the employer pays fringe benefit tax (30%) on the interest saved on cheap loans, against the market rate in `KE_MARKET_RATE` (update it every quarter).

**These rules are drafts (`LOANS-2026.1-draft`).** Finance should confirm the limits and rates.

## Benefits

Under **Benefits**, staff join a meal option (HR-F06) or a gym plan (HR-F07); managers and HR nominate people for gift vouchers (HR-F05).

- **Meal vouchers:** a canteen wallet or partner meal card for on-site and hybrid staff, or a cash meal allowance for fully remote staff. One at a time.
- **Gym:** Standard, Premium and Family add-on plans at partner gyms. The company pays a subsidy; the employee's share comes off net pay.
- Enrolments run whole calendar months and are approved by HR and then Payroll. Ending one stops it at the end of the current payroll month.
- **Gift vouchers** for birthdays, long service, festive seasons, recognition, weddings and new babies. A manager's nomination counts as the manager step and then HR approves. HR's nominations go to the person's manager, or are issued at once if they have none.
- **Payslip:** the company's share and vouchers appear as benefits in kind. In Kenya they are tax-free up to KES 5,000 a month in total, and fully taxed above that. The remote meal allowance is paid as taxable cash.
- HR sets the options and prices for each company under **Benefits > Manage benefit options**, which also shows members, monthly cost and vouchers issued. The Kenya prices in the seed are examples.

## Policies and forms

**Policies and forms** holds the 22 group policies (POL-01 to POL-22) and 20 HR forms (HR-F01 to HR-F20) as PDFs, grouped by topic and searchable.

- Policies marked "must read" ask every employee to open them and press **I have read this policy**. The count shows in the menu and on the home page.
- Confirmations are kept per version. When HR uploads a new version, everyone confirms again, unless HR marks it as a small correction (typos, layout).
- HR uploads, updates and hides documents under **Manage policies and forms**, sees who has read each policy per company, and emails a reminder to those with a login. Staff without a login can hand in a signed copy.
- Forms that have an online version in the portal (leave, advances, loans, IOUs, gift vouchers, meals, gym) say so.

## Chat and community

- **Chat:** one-to-one and group chats with anyone who has a portal login, across all companies. Unread counts show in the menu. People can delete their own messages and report anyone else's.
- **Community:** posts with up to 4 photos, an MP4 video (up to 50 MB) or a PDF, likes and comments. Before attaching files the author confirms they made them or have permission, and that anyone recognisable agreed (POL-20 copyright rules).
- **Moderation:** HR sees reported messages, posts and comments and removes or keeps each one. The author is emailed when something is removed. Removed content is hidden but kept as a company record.
- Chat and the community page refresh every few seconds; there is no separate chat server to run.

## Daily activity tracker

Under **My day**, staff clock in (in the office, remote, or at a client or on site) and out, and note what they worked on. This follows POL-21.

- The portal records clock-in and clock-out times, the work mode and the notes. It does **not** record location, screens, keystrokes, websites or apps; the page says so.
- A forgotten clock-out is closed after 16 hours at 9 hours from clock-in and flagged.
- Staff can correct their times (with a reason) and notes for the last 7 days. Corrections are marked as edited.
- **Team activity:** managers see their direct reports for any day; HR and Payroll see a whole company, plus a monthly report of days present, hours worked and hours noted, with a CSV download.
- Each company's times use its own time zone.

## The interface

- **Navigation** is grouped by job to be done (Overview, My workspace, People, Approvals, Payroll and finance, Workplace, Administration) and shows only what your role can use. Groups collapse, and the whole menu folds down to icons; both choices are remembered per browser. On a phone the menu slides in from the left.
- **Top bar:** where you are, a people search (press <kbd>/</kbd> to jump to it; HR, payroll and managers), the current pay period, a bell that totals everything waiting for you, and your account menu with the theme switch (light, dark or follow the device).
- **Design system:** one stylesheet (`apps/web/app/globals.css`) built on colour tokens: white and light-grey surfaces, dark-grey text (no pure black) and orange. Bright orange `#FF6600` marks accents, active items, progress and charts; buttons use a deeper orange `#C94A00` with white text and links use `#C24E00`, so text stays readable (WCAG AA). Blue marks approved or in-progress states, so it is never confused with the brand orange. Dark mode uses charcoal greys rather than black. Change the theme in one place, the `:root` block. Shared building blocks (page header, key-figure tiles, status badges, empty states, bar, column, stacked and donut charts) live in `apps/web/components/ui.tsx`. Charts are plain SVG and CSS, so there is no chart library to load.
- **Printing:** payslips and reports print without the menus. Use **Print or save as PDF** on a payslip.

## Workforce analytics

Under **Workforce analytics** (HR, payroll and admins). Pick a company or see the whole group.

- Active headcount, people managers, joiners and leavers in the last 12 months, the attrition rate (leavers over the average of headcount now and a year ago), average tenure and age, staff on leave today and open positions.
- Joiners and leavers by month; headcount by department, grade, contract, gender and work location; length of service and age bands; why people left.
- A table per company with turnover and the latest payroll status and totals. Pay is never added up across companies, because each pays in its own currency.
- **Export CSV** downloads every breakdown. The API only returns counts, never names or individual pay.

## Organisation

Everyone can open **Organisation**.

- **Entities:** each subsidiary with its headcount, departments, currency and whether its payroll rules are signed off.
- **Reporting line:** your managers above you and your direct reports below. Click anyone to move the chart to them. Staff see their own company; HR, payroll and admins see every company and start from **Departments**, which lists each department with its heads.
- Only names, job titles, departments and grades are shown. Profiles open for HR, payroll and admins, for yourself, and for a manager's own direct reports.
- `npm run db:import-sample` also gives the sample staff reporting lines (the most senior person in each department leads it, managers and leads report to them, and everyone else is shared across the leads). Run `npm run db:sample-reporting-lines` to add them to sample staff imported before this release; it only fills in missing managers.

## Recruitment

HR runs **Recruitment**; a hiring manager sees the openings they hire for.

| | HR and admins | Hiring manager |
|---|---|---|
| Create, edit, hold, reopen or close openings | Yes | No |
| See an opening, its candidates and pay range | All openings | Their own openings |
| Add candidates | Yes | Yes (recorded as referrals) |
| Move candidates, score interviews (1 to 5), add notes | Yes | Yes |
| Hire | Yes | No |

- Each opening gets a reference such as `REQ-KE-0007`, a company, department, location, contract, grade, number of positions, optional monthly pay range and closing date.
- The board shows Applied, Screening, Interview, Offer and Hired. Candidates who are not progressing or withdrew are kept on record and can be reconsidered. The same email cannot apply twice to one opening.
- **Hire** (only from Offer) creates the employee in the opening's company with its job title, department, location, contract and grade, reporting to the hiring manager, with a portal login and the usual welcome email. When every position is filled, the opening is marked filled.

## Performance

- **Goals:** everyone keeps their own goals with a weight and a due date and updates progress; a goal at 100% is marked complete. Managers see and set goals for their direct reports, HR for anyone. The weighted progress shows at the top.
- **Review cycles:** HR opens a cycle for a company (one open cycle per company at a time). Everyone in that company with a portal login gets a review, with their current manager as reviewer, and an email.
- **Self review, then the manager:** the employee rates themself 1 to 5 with comments; their manager is emailed, reads it and gives the final rating and comments; the employee is emailed when it is complete. HR completes reviews for people without a manager. Nobody can complete their own manager review, and closed cycles accept nothing.
- **Review cycles** shows each cycle's progress and the spread of final ratings; HR and managers can list the reviews in it.

Ratings: 1 below expectations, 2 partly meets, 3 meets, 4 exceeds, 5 exceptional.

## Audit trail

Admins see **Audit trail**: every sign-in, record change, approval, payroll action, hire and review the portal records, newest first, with who did it and the details. Filter by action (for example `payroll.` or `recruitment.hire`), record type, person and dates. Entries cannot be changed or deleted from the portal.

## How sign-in works

1. Email, password and a Turnstile CAPTCHA.
2. A 6-digit code is emailed. It expires in 5 minutes and allows 5 tries; at most 5 codes per 15 minutes.
3. The browser keeps the session token for the tab only (8 hours).

The CAPTCHA keys in `.env.example` are Cloudflare's published test keys, which always pass. Put real keys in production.

## Month-end payroll

1. **Draft.** Payroll staff create a run for a company and month, or it is created automatically on the 20th (`PAYROLL_AUTODRAFT=true`), and the admin gets an email.
2. **Approve.** The admin checks totals and approves.
3. **Finalize.** The admin finalizes. Payslips are published and every employee gets an email.

Deleting an employee is a soft delete: their login stops at once, and their record and payslips are kept for the legal retention period.

### Kenya rules (`KE-2026.2-draft`)

PAYE bands with KES 2,400 personal relief; NSSF 6% up to KES 72,000 pensionable pay (employer matches); SHIF 2.75% (minimum KES 300); Affordable Housing Levy 1.5% each side; NITA KES 50 employer levy. NSSF, SHIF and the housing levy are deducted before PAYE. Benefits in kind over KES 5,000 a month are taxed; voluntary deductions never take pay below a third of gross (Employment Act s.19).

### Other countries

| Country | Rules | Employee pays | Employer pays |
|---|---|---|---|
| Uganda | `UG-2026.1-draft` | PAYE (nil to UGX 235,000 a month, then 10%, 20%, 30%, plus 10% above 10 million); NSSF 5%; Local Service Tax in four parts, July to October | NSSF 10% |
| Tanzania | `TZ-2026.1-draft` | PAYE (nil to TZS 270,000 a month, then 8% to 30%) after NSSF 10% | NSSF 10%, Skills Development Levy 3.5%, WCF 0.5% |
| South Africa | `ZA-2026.1-draft` | PAYE on annualised pay (18% to 45%) less age rebates; UIF 1% up to R17,712 | UIF 1%, Skills Development Levy 1% |
| Egypt | `EG-2026.1-draft` | Salary tax (0% to 27.5% after the EGP 20,000 exemption; high earners lose the lower bands); social insurance 11% on EGP 2,700 to 16,700; Martyrs' Fund 0.05% | Social insurance 18.75% |
| Nigeria | `NG-2026.1-draft` | PAYE under the Nigeria Tax Act 2025 (nil to NGN 800,000 a year, then 15% to 25%); pension 8%; NHF 2.5% of basic | Pension 10%, NSITF 1%, ITF 1% |
| Mexico | `MX-2026.1-draft` | ISR monthly table less the employment subsidy; IMSS on the integrated daily wage | IMSS, INFONAVIT 5%, state payroll tax 3% |
| New Zealand | `NZ-2026.1-draft` | PAYE (10.5% to 39%); ACC earners' levy 1.75%; KiwiSaver 3.5% from April 2026 | KiwiSaver 3.5% less ESCT; fringe benefit tax on benefits in kind |

Every country keeps take-home pay above a third of gross when loans and benefit shares are deducted. Each rules file under `apps/api/src/payroll/rules/` explains its rates.

Some figures are assumptions to check: South Africa uses the 2025/26 tables until the 2026 Budget figures are confirmed, and Mexico assumes a 3% state payroll tax and class I work risk. Kenya's fringe benefit tax on staff loans is the only loan benefit tax built so far. The US parent company has no payroll in the portal.

**All eight rule sets are marked unverified.** A payroll adviser in each country must sign them off before real pay. Until then the portal shows a warning on every run.

## Legal, disclaimer and credits

- **`/legal`** is a public page (readable before signing in) with the **Disclaimer** (no professional advice, accuracy, official records, no warranty and limitation of liability, third-party services), **Terms of use** (authorised use, accounts, confidentiality, accurate information, acceptable use, monitoring, changes, governing policies and law), **Privacy notice** (what is held, why, who can see it, retention, rights, cookies and storage) and **Copyright and credits**.
- Every page has a footer with the copyright line, "Designed and created by Bhim Dhami" and links to each section. The sign-in page asks people to accept the terms, and payslips carry a computer-generated notice.
- Names, dates and contact addresses are set once in `apps/web/lib/legal.ts`. The wording is a professional starting point; have it reviewed by the company's legal and data protection advisers in each country before go-live.
- The software is proprietary: see [LICENSE](LICENSE).

## Production deployment

`docker/Dockerfile` builds two small images from the repository root: `api` (runs any pending migrations, then starts; health check on `/api/health`) and `web` (the Next.js standalone server). `docker-compose.prod.yml` runs them with PostgreSQL and Mailpit:

```bash
cp .env.example .env.prod     # set JWT_SECRET, POSTGRES_PASSWORD, SMTP, CAPTCHA keys and WEB_ORIGIN
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
DATABASE_URL=postgresql://hr:<password>@localhost:5432/hrportal npm run db:seed   # once, from a checkout
```

- The website forwards `/api` to the API, so only port 3000 needs to be public. Put it behind HTTPS (a load balancer or reverse proxy).
- `API_PROXY_TARGET` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are fixed when the website image is built (build arguments).
- Uploaded files live in the `storage` volume; back it up with the database, or move to object storage.
- Set `PAYROLL_AUTODRAFT=false` on all but one API instance if you run several.

### Public demo on Vercel

The API and website can also run as two Vercel projects with a free Neon Postgres database, in **demo mode**
(`DEMO_MODE=true`: the sign-in page lists the test accounts and the sign-in code is filled in for you) and with
uploaded files kept in the database (`STORAGE_DRIVER=database`). Step-by-step setup: [docs/deploy-vercel.md](docs/deploy-vercel.md).

## Security

- Two-step sign-in (password, CAPTCHA and an emailed code), sessions that end with the browser tab, accounts and roles re-checked on every request.
- Every API route needs a signed-in user unless marked public (sign-in and the health check). Each module checks the role and, where it matters, the relationship (your manager, your hiring manager, your approver).
- Security headers on the API (helmet) and the website (no framing, no MIME sniffing, HSTS, strict referrer, no camera, microphone or location access).
- Uploads are checked by file content, not name. File storage keys never leave the server.
- Personal and pay data is limited by role as described above; analytics and the organisation chart return counts and names only.
- An append-only audit trail for administrators.

## Tests

```bash
npm run db:test:setup   # migrates the hrportal_test database (created by docker compose)
npm test                # payroll rule unit tests for all eight countries + full API flow
```

The API test signs in through the email code, checks every role boundary, adds and deletes an employee, runs payroll from draft to finalized, and checks profile access, uploads, the sample import, leave from request to payslip, advances, loans, IOUs and benefits from request to repayment, policies, chat, the community page, moderation and the activity tracker, and the HR ERP modules: workforce analytics, the organisation chart's company boundary, recruitment from referral to hired employee, a full review cycle (including that nobody reviews themself), goals and the audit trail. It wipes its database, so it only runs against a database whose name ends in `_test`.

## Screenshots

| | |
|---|---|
| ![Sign in](docs/screenshots/01-sign-in.png) | ![Dashboard in dark mode](docs/screenshots/03-admin-dashboard-dark.png) |
| ![Employees](docs/screenshots/05-employees.png) | ![Staff profile](docs/screenshots/06-staff-profile.png) |
| ![Organisation chart](docs/screenshots/07-organisation-chart.png) | ![Recruitment](docs/screenshots/08-recruitment.png) |
| ![Candidate pipeline](docs/screenshots/09-candidate-pipeline.png) | ![Review cycles](docs/screenshots/11-review-cycles.png) |
| ![Payroll runs](docs/screenshots/12-payroll-runs.png) | ![Payroll run](docs/screenshots/13-payroll-run.png) |
| ![Employee dashboard](docs/screenshots/15-employee-dashboard.png) | ![My leave](docs/screenshots/16-my-leave.png) |
| ![Leave approvals](docs/screenshots/17-leave-approvals.png) | ![Advances and loans](docs/screenshots/18-advances-and-loans.png) |
| ![Policies](docs/screenshots/19-policies.png) | ![Chat in dark mode](docs/screenshots/20-chat.png) |
| ![Audit trail](docs/screenshots/21-audit-trail.png) | ![Dashboard on a phone](docs/screenshots/22-mobile-dashboard.png) |
| ![Disclaimer, terms and privacy](docs/screenshots/23-legal-disclaimer.png) | |

![Workforce analytics](docs/screenshots/04-workforce-analytics.png)

| | |
|---|---|
| ![Performance](docs/screenshots/10-performance.png) | ![Payslip](docs/screenshots/14-payslip.png) |

---

© 2026 Bhim Dhami. All rights reserved. Designed and created by Bhim Dhami. Mindspace and the Mindspace logo belong to Mindspace Artificial Intelligence Inc.
