-- CampusPrint — Supabase migration 002 (2026-05-17)
-- ⚠  DESTRUCTIVE — drops two columns and permanently deletes any data in them.
--    IF EXISTS guards make re-running safe on a DB that already has this applied,
--    but on a DB that has data in payment_method / amount_paid those values are
--    unrecoverable after this runs. Take a manual snapshot first if unsure.
--
-- ROLLBACK (if you need to undo before any production data is written):
--   alter table print_jobs add column if not exists payment_method text;
--   alter table print_jobs add column if not exists amount_paid     numeric(10,2);
--
-- Path B reorientation: payment is now handled at the institutional contract level,
-- not per-job. Removing the columns rather than leaving them nullable, because:
--   (a) Path B doesn't bill students per job — there is no "amount paid" concept.
--   (b) Storing strings like "EcoCash"/"InnBucks"/"Visa" without a verified webhook
--       was a Seat-3 V5 CRITICAL ("fraud-adjacent PAID claim"). Deleting the columns
--       deletes the vulnerability surface entirely.
--   (c) Institutional billing in Path B is aggregate (jobs per month × per-seat fee).
--       It's a separate concern, not a per-row column.
--
-- Run this in: supabase.com → SQL Editor → New query → paste → Run.

alter table print_jobs drop column if exists payment_method;
alter table print_jobs drop column if exists amount_paid;
