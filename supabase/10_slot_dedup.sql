-- =====================================================================
-- CLiQ Push Ops — Slot number persistence + idempotent re-upload
-- Run TENTH. Fixes two real bugs found while diagnosing the "Upload
-- failed" report:
--   1. The Slot column from the CRM input file was parsed but never
--      written to any campaign field — it's added here as a real column.
--   2. There was no stable key to make re-uploading the same file safe,
--      so a retry after a partial failure would have duplicated every
--      row that already succeeded.
-- =====================================================================

alter table campaigns add column if not exists slot_number integer;

-- One physical slot (a specific day + time + slot position) can hold
-- exactly one campaign — this is the natural key the CRM input file
-- already implies (Day, Time, Slot).
--
-- Deliberately NOT a partial index (no WHERE clause): Supabase's
-- .upsert(rows, { onConflict: "..." }) generates a plain
-- ON CONFLICT (col1, col2, col3) clause with no way to attach a WHERE
-- predicate from the client, and Postgres requires a partial index's
-- predicate to match the ON CONFLICT target exactly or it's rejected
-- with "no unique or exclusion constraint matching the specification."
-- A plain (non-partial) unique constraint doesn't need that predicate
-- anyway: Postgres's standard NULL semantics already treat every NULL
-- as distinct from every other value under a UNIQUE constraint, so rows
-- with no slot_number (Add Campaign, Emergency, CRM Self PNs created
-- individually) never conflict with each other or with anything else —
-- this only actually constrains rows that carry a real slot number.
create unique index if not exists campaigns_day_time_slot_unique
  on campaigns (launch_date, launch_time, slot_number);

select count(*) as campaigns_with_slot_number from campaigns where slot_number is not null;
