# CampusPrint

University print release client — mobile-first submission flow that sits on top of an
institution's existing print-management system (PaperCut, Microsoft Universal Print,
IPP, ezeep, Pharos).

> ⚠️ **Status: pre-alpha.** Do NOT use with real student data, real payments, or real
> institutional brands. See [SECURITY.md](SECURITY.md) for the posture and the
> remediation tracker.

## What's in the repo right now

- `index.html` — single-page mobile checkout UI + "other student services" grid
  (history sync, kiosk directory, top-up requests, bulk handouts, scan info, past
  papers placeholder). Uses the Supabase JS client (CDN, pinned version) for
  persisting print jobs and for magic-link sign-in.
- `supabase/migrations/001_print_jobs.sql` — schema for the `print_jobs` table, status-
  machine check constraints, indexes, and base RLS policies.
- `supabase/migrations/002_path_b_drop_payment.sql` — removes the payment columns
  (Path B: institutions pay at the contract level, not students at submit time).
- `supabase/migrations/003_auth_history.sql` — adds Supabase Auth + per-user RLS so
  print history syncs across devices for signed-in users.
- `api/send-email.js` — Vercel serverless function for Resend notifications. Verifies
  the caller's Supabase JWT (when supplied), rate-limits per identity, dedupes by
  job number, and never sends customer-confirmation mail to an unverified address.
  Required env vars: `RESEND_API_KEY`, `RESEND_FROM`, `OPERATOR_EMAIL`,
  `ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. See `.env.example`.
- `vercel.json` — region pin (`fra1`), function `maxDuration`, security headers
  (HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- `package.json` — project metadata + `vercel dev / deploy` scripts.
- `SECURITY.md` — vulnerability tracker and remediation roadmap.

## First-time setup

1. **Supabase** — create a free project, then in **SQL Editor → New query** run each
   migration in `supabase/migrations/` in order (001, 002, 003). Then go to
   **Authentication → URL Configuration** and add your production origin to the
   Redirect URLs allowlist (do NOT add wildcard preview domains in prod).
2. **Resend** — create a sending domain, verify SPF/DKIM/DMARC, and generate an
   API key scoped to that domain. Do not use `onboarding@resend.dev`.
3. **Vercel env vars** — copy `.env.example` to `.env.local` for dev, and run
   `vercel env add` for each variable in **Preview** and **Production** scopes.
4. Update `CONFIG.SUPABASE_URL` and `CONFIG.SUPABASE_ANON` near the top of
   `index.html` if you're forking to a different Supabase project. (These are the
   anon-public key and project URL — safe to ship in the browser as long as RLS
   stays enforced.)

## Local dev

```bash
npm i -g vercel
vercel link            # link to your Vercel project
vercel env pull        # pull env vars into .env.local
npm run dev            # vercel dev on http://localhost:3000
```

## Deploy

```bash
npm run deploy:preview   # preview deployment
npm run deploy:prod      # production (use Rolling Releases for canary)
```
