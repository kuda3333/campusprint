-- CampusPrint — Supabase migration 003 (2026-05-18)
-- Adds Supabase Auth + per-user RLS so "My print history" can sync across devices.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- After running, enable Email magic-link in Authentication → Providers → Email
-- (the default project settings allow this; no extra config needed).

-- ── COLUMN ──────────────────────────────────────────────────────────────────
alter table print_jobs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_print_jobs_user on print_jobs (user_id);

-- ── RLS POLICIES (drop the anon-only set, add auth-aware ones) ─────────────
drop policy if exists "anon_can_insert"   on print_jobs;
drop policy if exists "deny_anon_select"  on print_jobs;

-- INSERT
-- Anyone (anon or authenticated) can insert a job.
-- If signed in, the job MUST be linked to the caller's auth.uid().
-- If signed out, user_id MUST be NULL.
-- This prevents a signed-in user from impersonating another user_id.
create policy "insert_own_or_anon" on print_jobs
  for insert
  with check (
    (auth.uid() is null and user_id is null)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- SELECT
-- Authenticated users can read ONLY their own jobs.
-- Anonymous users cannot read anything (operator dashboard will use
-- service_role from a server-side function once P1 lands).
create policy "select_own" on print_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

-- UPDATE
-- Authenticated users can update their own jobs (e.g. cancel a pending job).
-- They CANNOT change user_id (the with check clause enforces this).
create policy "update_own" on print_jobs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- service_role (used by server-side functions) keeps full access via the
-- existing "service_role_all" policy from migration 001.
