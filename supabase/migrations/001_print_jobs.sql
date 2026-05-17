-- CampusPrint — Supabase migration 001
-- Run this in: supabase.com → your project → SQL Editor → New query → Run
--
-- What this creates:
--   • print_jobs table (all job metadata for CampusPrint)
--   • Row-Level Security enabled with two policies:
--       anon INSERT allowed (students submitting jobs, pre-auth phase)
--       anon SELECT denied  (operator reads come after auth integration in P1)
--
-- NOTE (Path B roadmap): once Auth.js + SSO is wired (weeks 5-8), the anon insert
-- policy gets replaced with `request.auth.uid IS NOT NULL` and a `tenant_id` column
-- is added for multi-institution support. For now, this matches the current single-
-- institution static-HTML flow.

-- ── EXTENSION ────────────────────────────────────────────────────────────────
-- uuid generation (already enabled on Supabase; included for completeness)
create extension if not exists "pgcrypto";

-- ── TABLE ────────────────────────────────────────────────────────────────────
create table if not exists print_jobs (
  id             uuid        primary key default gen_random_uuid(),

  -- Job identity
  job_number     text        not null unique,           -- e.g. CP-XYZABC

  -- Kiosk + student
  kiosk_location text        not null,
  student_id     text        not null,
  student_email  text,
  student_phone  text,

  -- Print details
  copies         integer     not null check (copies >= 1 and copies <= 400),
  paper_type     text        not null,
  print_sides    text        not null,
  file_name      text        not null,

  -- Payment (string for now; replaced by PSP webhook reference in P0-6)
  payment_method text        not null,
  amount_paid    text        not null,

  -- Collection window
  collect_by     text        not null,

  -- Lifecycle status machine
  -- pending → paid → ready_for_print → printing → printed → collected | expired
  status         text        not null default 'pending'
                              check (status in (
                                'pending','paid','ready_for_print',
                                'printing','printed','collected','expired','refunded'
                              )),

  -- Timestamps
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- auto-update updated_at on row changes
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger print_jobs_updated_at
  before update on print_jobs
  for each row execute procedure set_updated_at();

-- ── INDEXES ──────────────────────────────────────────────────────────────────
create index if not exists idx_print_jobs_status     on print_jobs (status);
create index if not exists idx_print_jobs_kiosk      on print_jobs (kiosk_location);
create index if not exists idx_print_jobs_student    on print_jobs (student_id);
create index if not exists idx_print_jobs_created    on print_jobs (created_at desc);

-- ── ROW-LEVEL SECURITY ───────────────────────────────────────────────────────
alter table print_jobs enable row level security;

-- Students can submit jobs without being authenticated (pre-SSO phase).
-- Tighten to: `with check (auth.uid() is not null)` once Auth.js is wired.
create policy "anon_can_insert" on print_jobs
  for insert to anon
  with check (true);

-- Nobody can read jobs without being authenticated.
-- Operator dashboard (P1) will add: `using (auth.jwt()->>'role' = 'operator')`.
create policy "deny_anon_select" on print_jobs
  for select to anon
  using (false);

-- Only the service-role key (server-side only, never in client) can update/delete.
-- This key is used by the /api/send-email function once we wire job-status updates.
create policy "service_role_all" on print_jobs
  for all to service_role
  using (true)
  with check (true);
