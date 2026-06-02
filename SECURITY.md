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

## Auth + multi-device history (2026-05-18 — migration 003)

Adds Supabase Auth (magic-link via email) and per-user Row Level Security so
"My print history" syncs across every device a student signs in on.

**To activate:**
1. Run `supabase/migrations/003_auth_history.sql` in the Supabase SQL Editor.
2. In Supabase dashboard → **Authentication → URL Configuration**, add your
   production + preview URLs (e.g. `https://campusprint.vercel.app/`,
   `https://*-kuda3333.vercel.app/`) to the **Redirect URLs** allowlist.
3. (Optional but recommended) **Authentication → Providers → Email**, customise
   the magic-link email template with your CampusPrint brand.

**What the migration does:**
- Adds `user_id uuid references auth.users(id)` column to `print_jobs`.
- Replaces the old anon-only RLS policies with three auth-aware ones:
  - `insert_own_or_anon` — anyone can insert; signed-in users MUST link the
    row to their own `auth.uid()` (no impersonation).
  - `select_own` — authenticated users can read only their own jobs.
  - `update_own` — authenticated users can update only their own jobs
    (foundation for future "cancel pending job" flow).

**Two new request types in `api/send-email.js`:**
- `topup_request` — student requests print-credit top-up. Routed to
  `OPERATOR_EMAIL` (bursary office) + customer confirmation.
- `bulk_request` — lecturer requests bulk handout. Same routing.
Both share validation, HTML-escaping, and the rate-limit/CORS posture of the
existing `print_job` type.

## Supabase migration (2026-05-17)

Firebase Firestore was replaced with Supabase Postgres. The Supabase JS client is
loaded from a pinned esm.sh URL; `print_jobs` writes go through RLS-protected
INSERT policies. See `README.md` for setup steps.

## Firebase decommissioning (2026-05-18)

The legacy Firebase project (`saloon-booking-ce824`) is no longer used by this
codebase. The `firestore.rules` file has been deleted because Supabase is now the
sole backend (migrations 001–003). **Action required outside this repo:** delete
the legacy Firebase project, or rotate its API key and lock all rules to
`allow read, write: if false;`, then deauthorise its OAuth clients.

## Playbook audit follow-ups (2026-06-02)

Ran the Secure Build Master Playbook against the repo and closed three of its
hard-gate (§14/§9/§12/§15) gaps:

- **Automated tests (§14 P0).** Added a zero-dependency `node:test` suite under
  `test/` covering the `send-email` validators, `escapeHtml`/CORS allowlist logic,
  idempotency fingerprinting, and the Resend webhook's Svix signature verification
  (valid / tampered / wrong-secret / stale-timestamp / missing-header). Run with
  `npm test`. The pure helpers in `api/send-email.js` and `api/webhook-resend.js`
  are now exported for testability without changing the Vercel handler contract.
- **CI gate + secret scanning (§9/§12 P0).** Added `.github/workflows/ci.yml`:
  runs `npm test` and a **gitleaks** secret scan on every PR and push. The
  `.gitleaks.toml` allowlists only the public anon Supabase JWT and `.env.example`
  placeholders — a `service_role` key would still trip the scan.
- **Privacy/T&C copy accuracy (§15 P0).** The Privacy Notice previously claimed it
  collected file *contents*; corrected to state the build records file *metadata
  (name) only*. T&C "non-refundable / reverse any charge" language (a Path-A relic)
  was rewritten to match Path B, where students are not billed per job.

Still open from this audit: automated DB backups + tested restore (§7/§13 P0 —
needs Supabase Pro/PITR, dashboard action), and SRI/self-hosting the Supabase
client bundle (§4 P1 — true SRI isn't possible on an ESM `import`; mitigated today
only by version pinning).

## IMMEDIATE STOP — fixes landed across commits

| # | Item | File | Status |
|---|------|------|--------|
| 1 | Legacy Firebase rules file removed; Supabase is sole backend | `firestore.rules` (deleted) | ✅ |
| 2 | Remove legacy `salon_booking` handler from email endpoint (CWE-732) | `api/send-email.js` | ✅ |
| 3 | HTML-escape every user-controlled field before email interpolation (CWE-79) | `api/send-email.js` | ✅ |
| 4 | Lock CORS to `ALLOWED_ORIGINS` env allowlist; fail closed (CWE-942) | `api/send-email.js` | ✅ |
| 5 | Strict request-body schema validation + 400-char field caps (CWE-20) | `api/send-email.js` | ✅ |
| 6 | Refuse to send when `RESEND_FROM` is `onboarding@resend.dev` (CWE-441) | `api/send-email.js` | ✅ |
| 7 | Generic error responses; full errors only in server logs (CWE-209) | `api/send-email.js` | ✅ |
| 8 | Verify Supabase JWT on send-email; suppress customer mail when unauthenticated (CWE-290 / spoof) | `api/send-email.js` | ✅ |
| 9 | Per-identity rate limit (10/min) on send-email; replay-safe via idempotency key (CWE-770) | `api/send-email.js` | ✅ |
| 10 | 8s `AbortSignal.timeout` on Resend fetch (CWE-400) | `api/send-email.js` | ✅ |
| 11 | Canonical-origin emailRedirectTo + email-domain allowlist on magic link (CWE-601) | `index.html` | ✅ |
| 12 | Security headers + CSP via `vercel.json` (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) | `vercel.json` | ✅ |
| 13 | Pin `@supabase/supabase-js` to exact version (supply-chain hardening) | `index.html` | ✅ |
| 14 | `.env.example` documenting required env vars | `.env.example` | ✅ |
| 15 | `package.json` with engine pin and deploy scripts | `package.json` | ✅ |
| 16 | This document — security posture + remediation tracker | `SECURITY.md` | ✅ |

### Environment variables required AFTER this commit

The function will return `500 service_unavailable` until these are set in Vercel
(`vercel env add` for each, in **Preview** and **Production** scopes):

| Var | Example | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `re_***` | Resend API key, scoped to one verified sending domain |
| `RESEND_FROM` | `noreply@mail.campusprint.example.edu` | Verified sender. **NOT** `onboarding@resend.dev` |
| `OPERATOR_EMAIL` | `print-ops@example.edu` | Where operator notifications go |
| `ALLOWED_ORIGINS` | `https://campusprint.example.edu,https://campusprint-staging.example.edu` | Comma-separated CORS allowlist |

## Still outstanding — P1 (next sprint)

| ID | Severity | Issue | Fix |
|---|---|---|---|
| V6 | HIGH | Student ID is a free-text field — impersonation by design | Federated SSO (Entra ID / Google / SAML); magic-link is the interim path with domain allowlist |
| V18 | MED | In-memory rate limit is per warm instance only — can be evaded across cold starts | Move to Upstash Redis / Vercel KV with `@upstash/ratelimit` |
| V19 | MED | Server-side email-domain allowlist not yet enforced (client-side check only) | Add Supabase Auth Hook (`before_user_created`) that rejects non-allowlisted domains |
| V20 | MED | ~~No observability — `console.error` only~~ | ✅ Structured JSON logs + `requestId` per request + optional Sentry (`SENTRY_DSN` env var) landed 2026-05-19 |
| V21 | MED | ~~No Resend bounce webhook~~ | ✅ `/api/webhook-resend.js` with Svix signature verification landed 2026-05-19. **Action:** add endpoint in Resend dashboard + set `RESEND_WEBHOOK_SECRET` env var |
| V22 | LOW | CSP still allows `'unsafe-inline'` for scripts (inline `onclick` handlers + module script) | Extract inline handlers, switch to nonce-based CSP |
| V23 | MED (accepted) | Supabase session tokens persist in `localStorage` (XSS-readable) — a deviation from the playbook §3 / Appendix C "no tokens in localStorage" rule | Accepted trade-off for a static SPA — see *Session-token storage decision* below. Revisit if a server framework is adopted. |

## Session-token storage decision (V23 — accepted trade-off)

The playbook (§3 "Sessions & tokens", Appendix C) says never store auth tokens in
`localStorage`/`sessionStorage` because an XSS bug can exfiltrate them. CampusPrint's
front-end is a **static single-page app** loaded straight from Vercel's CDN with no
server framework, so the standard `@supabase/supabase-js` client persists the session
in `localStorage` (its default). The cookie-based alternative (`HttpOnly` refresh
cookie + access token in memory) requires server-side session handling
(`@supabase/ssr` inside Next.js/SvelteKit/etc.), which this build does not have.

**Decision:** accept `localStorage` storage for now, mitigated by:

- A **strict CSP** ([vercel.json](vercel.json)) with no `'unsafe-eval'`, a locked
  `script-src`/`connect-src` allowlist, and `object-src 'none'` — the primary XSS
  containment. (Tightening the remaining `'unsafe-inline'` is tracked as V22.)
- **Consistent output-encoding** via `esc()` on every `innerHTML` sink (the only XSS
  entry points), so there is no known script-injection path to abuse the tokens.
- **Short-lived access tokens with refresh rotation** (Supabase default).
- A **pinned** Supabase client (`@2.45.4`) to blunt CDN supply-chain risk.

**Revisit trigger:** the moment this app gains a server framework (e.g. migrating the
static page into Next.js for the operator dashboard), switch to `@supabase/ssr`
cookie-based storage and remove this exception.

## Infrastructure checklist (manual — requires dashboard access)

### Supabase PITR backups
Point-in-Time Recovery requires the **Pro plan** (≥ $25/mo). Once upgraded:

1. Supabase dashboard → **Project Settings → Database → Backups**
2. Enable **Point-in-Time Recovery** — retains WAL for 7 days by default.
3. Test a restore to a staging branch (`supabase db reset --linked`) before going live.

Until then, take a manual snapshot before every destructive migration:
```
supabase db dump -f backup_$(date +%Y%m%d).sql
```

### Uptime monitoring
`GET /api/health` returns `{"status":"ok","ts":"...","version":"<git-sha>","region":"..."}`.

Recommended free monitor: **UptimeRobot** (uptimerobot.com)
1. New monitor → **HTTP(S)** → URL: `https://campusprint-pi.vercel.app/api/health`
2. Monitoring interval: **5 minutes**
3. Alert contact: ops email + WhatsApp webhook
4. Keyword check: `"status":"ok"` — alerts if the body changes (e.g. 500 with error JSON)

### Migration CI
`.github/workflows/migration-check.yml` runs on every PR that touches `supabase/migrations/`:
- Validates sequential file numbering
- Flags `DROP TABLE` / `TRUNCATE` / `DELETE FROM` with a warning
- Fails the build if a destructive migration has no ROLLBACK comment

## P1 + P2

See the Council of 5 rebuild roadmap delivered on 2026-05-16. Phased plan: weeks 5–8
deliver SSO + multi-tenancy + operator dashboard + deliverability; weeks 9–12 deliver
WCAG 2.1 AA remediation, i18n, BotID + Upstash rate limits, Sentry + Axiom logging,
Rolling Releases.

## Vulnerability disclosure

While this project is pre-alpha, please open a private GitHub Security Advisory
against `kuda3333/campusprint` for any issue. Do **not** open public issues for
security findings.
