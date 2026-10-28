# Publish the demo on Vercel

The demo runs as two Vercel projects from this one repository, plus a free Neon Postgres database:

| Vercel project | Root directory | What it is |
| --- | --- | --- |
| `mindspace-hr-api` | `apps/api` | The NestJS API, as one Vercel Function |
| `mindspace-hr` | `apps/web` | The Next.js website. It passes `/api/...` calls on to the API project |

The demo build turns on **demo mode**: the sign-in page lists the test accounts and their passwords, and the
6-digit sign-in code is filled in automatically instead of being emailed. Only use demo mode with the fictional sample data.

## 1. API project

1. On Vercel choose **Add New → Project**, import `bhimdhami-crypto/Applications`, name it `mindspace-hr-api`
   and set **Root Directory** to `apps/api`. Leave the build settings as they are (`apps/api/vercel.json` sets them;
   it installs from the repository root, since Vercel's own install fails on npm workspaces with "Tracker idealTree already exists").
2. Add these **Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `DEMO_MODE` | `true` |
   | `STORAGE_DRIVER` | `database` |
   | `CAPTCHA_PROVIDER` | `disabled` |
   | `MAIL_TRANSPORT` | `memory` |
   | `PAYROLL_AUTODRAFT` | `false` |
   | `JWT_SECRET` | a long random string (40 characters or more) |
   | `SEED_ADMIN_PASSWORD` | `Admin#Mindspace2026` (or your own) |
   | `SEED_USER_PASSWORD` | `Test#Mindspace2026` (or your own) |

3. Click **Deploy**. This first build fails because there is no database yet; that is expected.
4. In the project open **Storage → Create Database → Neon (Serverless Postgres)**, pick the free plan and
   connect it to the project for all environments. This adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
5. Open **Deployments**, pick the failed deployment and choose **Redeploy**. The build applies the database
   migrations, seeds the companies and test accounts, and imports the 12,408 sample staff with their photos
   (about a minute, roughly 75 MB of the database). Later builds skip data that is already there.
6. Check `https://mindspace-hr-api.vercel.app/api/health` answers.

## 2. Website project

1. **Add New → Project** again, import the same repository, name it `mindspace-hr` and set **Root Directory** to `apps/web`.
2. Environment variables:

   | Name | Value |
   | --- | --- |
   | `API_PROXY_TARGET` | the API project's address, for example `https://mindspace-hr-api.vercel.app` (no trailing slash) |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `disabled` |

3. Click **Deploy**, then open `https://mindspace-hr.vercel.app`.

Every push to `main` redeploys both projects.

## Good to know

- Emails (payslips, notices) are kept in memory and not sent, since the demo has no mail server.
- The automatic payroll drafts on the 20th are off. Payroll staff can still create drafts by hand.
- Uploaded photos and documents are stored in the database (`StoredFile` table), because Vercel Functions have no lasting disk.
- To reset the demo data, delete and recreate the Neon database, then redeploy the API project.
