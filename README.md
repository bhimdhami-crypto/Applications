# Mindspace HR Portal

HR and payroll portal for **Mindspace Artificial Intelligence Inc.** and its subsidiaries in Kenya, Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico and New Zealand.

Done so far:

- **Milestone 1:** secure sign-in, employee records, and the month-end payroll run with payslips. Kenya was the first country with payroll rules.
- **Milestone 2:** staff profiles with photos, contact details, IDs, education, next of kin and HR documents, plus an import of 12,408 sample staff.
- **Milestone 3:** leave requests and approvals, balances, a team leave calendar and public holidays for all eight countries. Unpaid leave comes off pay.
- **Milestone 4:** salary advances, staff loans and IOUs with their approvals and payroll recovery; meal vouchers, gym memberships and gift vouchers, taxed as benefits on the payslip.
- **Milestone 5:** payroll rules for Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico and New Zealand, so every subsidiary can run month-end payroll.
- **Milestone 6:** the policies and forms library with read confirmations, staff chat, a community page for news, photos and videos with moderation, and a daily activity tracker.

| Part | Stack |
|---|---|
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16 |
| `apps/web` | Next.js 15, React 19 |
| Email in development | Mailpit (catches every email locally) |
| CAPTCHA | Cloudflare Turnstile (free) |

## Quick start

You need Node 22 and Docker.

```bash
docker compose up -d                 # Postgres on 5432, Mailpit on 8025/1025
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm install
npm run db:migrate
npm run db:seed                      # companies, the seven test accounts, benefit options, policies and sample chats
npm run db:import-sample             # optional: 12,408 sample staff with documents and photos
npm run dev:api                      # http://localhost:4000/api
npm run dev:web                      # http://localhost:3000
```

Open **http://localhost:3000** for the portal and **http://localhost:8025** for the test inboxes. In GitHub Codespaces, run `dev:api` and `dev:web` in two terminals, then open ports 3000 and 8025 from the **Ports** tab.

Open the test inbox to see the emails. Every email the portal sends (sign-in codes, welcome emails, payslip notices) lands there, so the test accounts need no real mailbox.

## Test accounts

All emails use the reserved `.test` domain, so nothing can ever reach a real person.

| Email | Password | Role | What they can do |
|---|---|---|---|
| admin@mindspace-ai.test | `Admin#Mindspace2026` | Administrator | Everything: add and delete employees, give any role, approve and finalize payroll |
| hr@mindspace-ai.test | `Test#Mindspace2026` | HR | Add and edit employees (employee or manager role only) |
| payroll@mindspace-ai.test | `Test#Mindspace2026` | Payroll | Create and recalculate payroll drafts |
| manager@mindspace-ai.test | `Test#Mindspace2026` | Manager | See their own team (no pay figures) |
| developer@mindspace-ai.test | `Test#Mindspace2026` | Employee | Own profile and payslips (fully remote) |
| tester@mindspace-ai.test | `Test#Mindspace2026` | Employee | Own profile and payslips |
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

## Tests

```bash
npm run db:test:setup   # migrates the hrportal_test database (created by docker compose)
npm test                # payroll rule unit tests for all eight countries + full API flow
```

The API test signs in through the email code, checks every role boundary, adds and deletes an employee, runs payroll from draft to finalized, and checks profile access, uploads, the sample import, leave from request to payslip, and advances, loans, IOUs and benefits from request to repayment, and policies, chat, the community page, moderation and the activity tracker. It wipes its database, so it only runs against a database whose name ends in `_test`.

## Screenshots

| | |
|---|---|
| ![Sign in](docs/screenshots/01-sign-in.png) | ![Payroll draft](docs/screenshots/02-payroll-draft.png) |
| ![Admin home](docs/screenshots/03-admin-home.png) | ![Payslip](docs/screenshots/05-payslip.png) |
| ![Staff list](docs/screenshots/06-staff-list.png) | ![Manager view of a profile](docs/screenshots/08-manager-view.png) |

![Staff profile](docs/screenshots/07-staff-profile.png)

| | |
|---|---|
| ![My leave](docs/screenshots/09-my-leave.png) | ![Leave approvals](docs/screenshots/11-leave-approvals.png) |

![Leave calendar](docs/screenshots/10-leave-calendar.png)

| | |
|---|---|
| ![Advances and loans](docs/screenshots/12-advances-and-loans.png) | ![Loan and benefit approvals](docs/screenshots/13-loan-approvals.png) |
| ![Benefits](docs/screenshots/14-benefits.png) | ![Payslip with deductions and benefits](docs/screenshots/15-payslip-benefits.png) |

![Loan book](docs/screenshots/16-loan-book.png)

![Payroll runs for every country](docs/screenshots/17-payroll-all-countries.png)

| | |
|---|---|
| ![South Africa payslip](docs/screenshots/18-payslip-south-africa.png) | ![New Zealand payslip](docs/screenshots/19-payslip-new-zealand.png) |

| | |
|---|---|
| ![Policies and forms](docs/screenshots/20-policies.png) | ![Community page](docs/screenshots/22-community.png) |

![Chat](docs/screenshots/21-chat.png)

| | |
|---|---|
| ![My day](docs/screenshots/23-my-day.png) | ![Team activity](docs/screenshots/24-team-activity.png) |
| ![Moderation](docs/screenshots/25-moderation.png) | ![Chat on a phone](docs/screenshots/26-chat-mobile.png) |
