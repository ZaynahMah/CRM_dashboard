-- =====================================================================
-- CLiQ Push Ops — Full data reset
-- Run this ANYTIME you want the dashboard to start from a genuinely
-- empty state for every role. This does NOT touch your schema, your
-- accounts, or your master reference data (segments/categories/brands/
-- offers) — it only clears operational records: campaigns and everything
-- that hangs off a campaign.
--
-- Why you're seeing prefilled data: 03_seed.sql was designed for local
-- testing only (it seeds ~250 demo campaigns across a 60-day window) but
-- once run against your real Supabase project, that data stays there
-- until explicitly cleared — the app has no way to distinguish "seed"
-- rows from real ones, by design, since a real campaign and a demo
-- campaign are the same shape. Running this script is the fix.
-- =====================================================================

truncate table
  activity_logs,
  notifications,
  change_requests,
  qc_checklists,
  content_submissions,
  crm_decisions,
  campaigns
restart identity cascade;

-- Legacy tables from the old slot-board model (no longer used by the app,
-- but harmless to clear too if they still have rows from early testing).
truncate table calendar_slots, calendar_days restart identity cascade;

select
  (select count(*) from campaigns)      as campaigns,
  (select count(*) from activity_logs)  as activity_logs,
  (select count(*) from notifications)  as notifications;
-- Every count above should read 0. Reload the app — every dashboard,
-- every queue, and the workflow funnel will all show zero until you
-- upload a real CRM input file.
