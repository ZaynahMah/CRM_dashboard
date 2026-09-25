-- =====================================================================
-- CLiQ Push Ops — Slot number persistence
-- Run TENTH. Adds the Slot column from the CRM input file as a real
-- column — it was previously parsed but never persisted.
--
-- HISTORICAL NOTE (this file was corrected after the fact — you do not
-- need to re-run it if you've already run an earlier version):
-- The original version of this file also created a unique index on
-- (launch_date, launch_time, slot_number), on the theory that one slot
-- holds one campaign. That's wrong: multiple campaigns legitimately
-- share a slot (confirmed against real CRM Input data — Slot identifies
-- a time position, not a single PN). That index was removed here, and
-- if it's already live on your database, 11_remove_slot_uniqueness.sql
-- drops it. Rows don't need a natural key at all — the UUID primary key
-- is sufficient, and re-upload is handled by explicit delete-then-insert
-- in the app, not by a database constraint.
-- =====================================================================

alter table campaigns add column if not exists slot_number integer;

select count(*) as campaigns_with_slot_number from campaigns where slot_number is not null;
