# Security & Production-Readiness — CampusPrint

> **Status (2026-05-16):** PRE-ALPHA. Do not use with real student data, real payments,
> or real institutional brands. The Council of 5 review on 2026-05-16 surfaced 17
> vulnerabilities across the codebase, 5 rated CRITICAL. This document tracks them.

## What this app is becoming (Path B — companion model)

CampusPrint is being repositioned as a **mobile release-client that sits on top of an
institution's existing print-management system** (PaperCut Mobility Print, Microsoft
Universal Print, IPP, Pharos, ezeep). It is not a standalone payment-collection kiosk.
Implications:

- **No direct student micropayments.** Institutions pay a per-seat SaaS fee.
- **No custom file storage long-term.** Files are submitted directly to the campus
  print server via the institution's chosen protocol. Vercel Blob may be used as a
  staging buffer with a < 60-second TTL.
- **SSO is mandatory.** Auth via Microsoft Entra ID, Google Workspace, SAML 2.0
  (Shibboleth / Okta / Ping), or magic-link fallback gated to an email-domain allowlist.

## Supabase migration (2026-05-17)

Firebase Firestore replaced with Supabase Postgres. Key files changed:

| File | Change |
|---|---|
| `index.html` | Firebase SDK + init removed; Supabase JS client wired via CDN (`esm.sh`). `saveJob` now calls `db.from('print_jobs').insert(...)`. Dead EmailJS stub + `sendEmail` function removed. |
| `supabase/migrations/001_print_jobs.sql` | Schema for `print_jobs` table with status-machine check constraint, indexes, RLS policies (anon INSERT allowed; anon SELECT denied; service_role full access). |

**Manual steps required to activate:**
1. Create a free project at supabase.com.
2. In the project's **SQL Editor**, run the contents of `supabase/migrations/001_print_jobs.sql`.
3. Copy **Project URL** and **anon public key** from Settings → API.
4. Replace the two placeholder values in `index.html` (marked with `// ← replace`):
   - `SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co'`
   - `SUPABASE_ANON = 'YOUR_ANON_KEY_HERE'`
5. Deploy (the static `index.html` change is enough — no build step yet).

## IMMEDIATE STOP — fixes landed in this commit

| # | Item | File | Status |
|---|------|------|--------|
| 1 | Deny-all Firestore safety lock until proper rules ship | `firestore.rules` | ✅ written; **needs `firebase deploy --only firestore:rules` against a `campusprint-prod` project** (do NOT deploy against the shared salon project) |
| 2 | Remove legacy `salon_booking` handler from email endpoint (CWE-732) | `api/send-email.js` | ✅ |
| 3 | HTML-escape every user-controlled field before email interpolation (CWE-79) | `api/send-email.js` | ✅ |
| 4 | Lock CORS to `ALLOWED_ORIGINS` env allowlist; fail closed (CWE-942) | `api/send-email.js` | ✅ |
| 5 | Strict request-body schema validation + 200-char field caps (CWE-20) | `api/send-email.js` | ✅ |
| 6 | Refuse to send when `RESEND_FROM` is `onboarding@resend.dev` (CWE-441) | `api/send-email.js` | ✅ |
| 7 | Generic error responses; full errors only in server logs (CWE-209) | `api/send-email.js` | ✅ |
| 8 | `package.json` with engine pin and deploy scripts | `package.json` | ✅ |
| 9 | This document — security posture + remediation tracker | `SECURITY.md` | ✅ |

### Environment variables required AFTER this commit

The function will return `500 service_unavailable` until these are set in Vercel
(`vercel env add` for each, in **Preview** and **Production** scopes):

| Var | Example | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `re_***` | Resend API key, scoped to one verified sending domain |
| `RESEND_FROM` | `noreply@mail.campusprint.example.edu` | Verified sender. **NOT** `onboarding@resend.dev` |
| `OPERATOR_EMAIL` | `print-ops@example.edu` | Where operator notifications go |
| `ALLOWED_ORIGINS` | `https://campusprint.example.edu,https://campusprint-staging.example.edu` | Comma-separated CORS allowlist |

## Still outstanding — P0 (next session)

These were flagged CRITICAL or HIGH by Seat 3 and are **not yet fixed**:

| ID | Severity | Issue | Fix |
|---|---|---|---|
| V4 | CRITICAL | Firestore default-open posture in the shared salon project (`saloon-booking-ce824`) | Rotate API key in Firebase Console, create `campusprint-prod` project, deploy `firestore.rules` |
| ~~V5~~ | ~~CRITICAL~~ | ✅ **FIXED 2026-05-17 by deletion.** Path B removed the payment step from the student flow entirely. The "PAID" claim, the payment-platform selector, the cost banner, and the `payment_method`/`amount_paid` DB columns are all gone. Institutional billing happens out-of-band at the contract level. (Migration `supabase/migrations/002_path_b_drop_payment.sql`.) | — |
| V6 | HIGH | Student ID is a free-text field — impersonation by design | Auth.js + Entra ID / Google / SAML (Path B requires this) |
| V9 | HIGH | Firebase web config + project name `saloon-booking-ce824` is shipped to the browser, leaking that student PII and salon-customer PII are co-mingled | New dedicated Firebase project; rotate the leaked key |
| V11–V17 | MED/LOW | PII leak in logs (`console.error` in send-email.js, `alert(e.code)` in index.html); missing security headers; predictable job-number RNG; silent email-fail | All tracked for next P0 sweep |

## P1 + P2

See the Council of 5 rebuild roadmap delivered on 2026-05-16. Phased plan: weeks 5–8
deliver SSO + multi-tenancy + operator dashboard + deliverability; weeks 9–12 deliver
WCAG 2.1 AA remediation, i18n, BotID + Upstash rate limits, Sentry + Axiom logging,
Rolling Releases.

## Vulnerability disclosure

While this project is pre-alpha, please open a private GitHub Security Advisory
against `kuda3333/campusprint` for any issue. Do **not** open public issues for
security findings.
