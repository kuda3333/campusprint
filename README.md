# CampusPrint

University print release client — mobile-first submission flow that sits on top of an
institution's existing print-management system (PaperCut, Microsoft Universal Print,
IPP, ezeep, Pharos).

> ⚠️ **Status: pre-alpha.** Do NOT use with real student data, real payments, or real
> institutional brands. See [SECURITY.md](SECURITY.md) for the full posture and the
> remediation tracker from the 2026-05-16 Council of 5 review.

## What's in the repo right now

- `index.html` — single-page mobile checkout UI. Uses the **Supabase JS client** (CDN)
  for persisting print jobs. Replace the two placeholder values near the top of the
  `<script>` block (`SUPABASE_URL` and `SUPABASE_ANON`) with your project's values.
- `supabase/migrations/001_print_jobs.sql` — run this in Supabase SQL Editor once to
  create the `print_jobs` table, status-machine check constraints, indexes, and RLS
  policies.
- `api/send-email.js` — Vercel serverless function for Resend operator/student
  notifications. Requires `RESEND_API_KEY`, `RESEND_FROM`, `OPERATOR_EMAIL`, and
  `ALLOWED_ORIGINS` env vars. Returns `500 service_unavailable` if any are missing.
- `firestore.rules` — deny-all safety lock for the old Firebase project.
  **Deploy and then stop using that Firebase project entirely.**
- `package.json` — minimal project metadata + `vercel dev / deploy` scripts.
- `SECURITY.md` — vulnerability tracker + roadmap.

## First-time Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**, paste `supabase/migrations/001_print_jobs.sql`, and **Run**.
3. Go to **Settings → API**, copy the **Project URL** and **anon public key**.
4. Open `index.html`, find the two `// ← replace` lines near the top of the `<script>` block,
   and paste in those values.
5. Push to Vercel — no build step needed.

## Local dev

```bash
npm i -g vercel        # already installed in this dev env
vercel link            # link the local folder to the Vercel project
vercel env pull        # pull env vars from Vercel into .env.local
npm run dev            # start vercel dev on http://localhost:3000
```

## Deploy

```bash
npm run deploy:preview   # preview deployment
npm run deploy:prod      # production deployment (use Rolling Releases)
```
