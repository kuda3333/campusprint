# CampusPrint

University print release client — mobile-first submission flow that sits on top of an
institution's existing print-management system (PaperCut, Microsoft Universal Print,
IPP, ezeep, Pharos).

> ⚠️ **Status: pre-alpha.** Do NOT use with real student data, real payments, or real
> institutional brands. See [SECURITY.md](SECURITY.md) for the full posture and the
> remediation tracker from the 2026-05-16 Council of 5 review.

## What's in the repo right now

- `index.html` — single-page mobile checkout UI. Design tokens at the top are the
  one piece worth carrying forward; the rest is being rebuilt around a proper file
  pipeline + SSO + an operator dashboard.
- `api/send-email.js` — Vercel serverless function for Resend notifications.
  Hardened on 2026-05-16; **requires `RESEND_API_KEY`, `RESEND_FROM`, `OPERATOR_EMAIL`,
  and `ALLOWED_ORIGINS` env vars to run.** Returns `500 service_unavailable` otherwise.
- `firestore.rules` — deny-all safety lock until proper auth + per-collection rules
  ship. **Deploy this against a new `campusprint-prod` Firebase project, not the
  shared salon project the code currently points at.**
- `package.json` — minimal project metadata + `vercel dev / deploy` scripts.
- `SECURITY.md` — vulnerability tracker + roadmap.

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
