-- =====================================================================
-- Impersonation test for YOUR project (jofxdelfnyuaisdmzyuv).
-- Paste into the Supabase SQL Editor. It ends in ROLLBACK and leaves
-- NOTHING behind.
--
-- WHY THIS MATTERS: an earlier test used `request.jwt.claims` and
-- auth.uid() silently returned NULL, so the trigger exited early and the
-- test "passed" while proving nothing. ALWAYS check step 2 first.
-- =====================================================================

-- ── STEP 1: find real profile ids ───────────────────────────────────
select id, username, role from profiles
where role in ('CRM','CATEGORY','CONTENT') order by role;
-- Copy the CATEGORY and CONTENT ids into step 3.

-- ── STEP 2: find which setting YOUR project reads ───────────────────
-- Supabase's own auth.uid() reads request.jwt.claims (a JSON object).
-- Run BOTH and keep whichever returns non-NULL.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"PASTE_CONTENT_ID_HERE"}';
  select 'claims(json)' as style, auth.uid() as uid;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'PASTE_CONTENT_ID_HERE';
  select 'claim.sub' as style, auth.uid() as uid;
rollback;
-- If BOTH return NULL, stop: nothing below proves anything.
-- On hosted Supabase the first form is normally the right one.

-- ── STEP 3: the real test ───────────────────────────────────────────
select count(*) as campaigns_before from campaigns;
select count(*) as notifications_before from notifications;

begin;

  insert into campaigns (campaign_name, campaign_origin, launch_date, is_crm_self,
    category_status, category_submitted_at, content_status, content_submitted_at,
    brand, header, qc_status, crm_status, calendar_status)
  values ('TEST_impersonation', 'CRM_PLANNED', current_date + 60, false,
    'LOCKED', now(), 'SUBMITTED', now(), 'OldBrand', 'Old header',
    'PENDING', 'SENT_TO_CONTENT', 'NOT_UPDATED');

  -- A) CONTENT edits after submitting -> ONE red alert.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"PASTE_CONTENT_ID_HERE"}';
  select set_config('app.actor_name', 'Test Content User', true);
  update campaigns set header = 'New header' where campaign_name = 'TEST_impersonation';
  reset role;

  select 'A edit persisted' as check, header as value
    from campaigns where campaign_name = 'TEST_impersonation'
  union all
  select 'A red alerts', count(*)::text from notifications n
    join campaigns c on c.id = n.campaign_id
   where c.campaign_name = 'TEST_impersonation' and n.priority = 'RED'
  union all
  select 'A capture failures', count(*)::text from activity_logs a
    join campaigns c on c.id = a.campaign_id
   where c.campaign_name = 'TEST_impersonation' and a.action = 'ALERT_CAPTURE_FAILED';
  -- EXPECT: New header / 1 / 0

  -- B) A second edit MERGES into the same alert.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"PASTE_CONTENT_ID_HERE"}';
  update campaigns set header = 'Newer header' where campaign_name = 'TEST_impersonation';
  reset role;
  select 'B red alerts (still 1)' as check, count(*)::text from notifications n
    join campaigns c on c.id = n.campaign_id
   where c.campaign_name = 'TEST_impersonation' and n.priority = 'RED';

  -- C) A no-op save creates nothing.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"PASTE_CONTENT_ID_HERE"}';
  update campaigns set header = 'Newer header' where campaign_name = 'TEST_impersonation';
  reset role;
  select 'C red alerts (still 1)' as check, count(*)::text from notifications n
    join campaigns c on c.id = n.campaign_id
   where c.campaign_name = 'TEST_impersonation' and n.priority = 'RED';

  -- D) A status regression is rejected. Uncomment to see the error; it
  --    aborts the transaction, so run it LAST or in its own block.
  -- set local role authenticated;
  -- set local request.jwt.claims = '{"sub":"PASTE_CONTENT_ID_HERE"}';
  -- update campaigns set content_status = 'PENDING' where campaign_name = 'TEST_impersonation';
  -- EXPECT: ERROR: Copy has already been submitted and cannot be moved back to PENDING.

rollback;

-- ── STEP 4: confirm nothing was left behind ─────────────────────────
select count(*) as campaigns_after from campaigns;
select count(*) as notifications_after from notifications;
select count(*) as test_rows_left from campaigns where campaign_name like 'TEST\_%';
-- EXPECT: the two counts match STEP 3's, and test_rows_left = 0.

-- ── WHAT CANNOT BE TESTED THIS WAY ──────────────────────────────────
-- 1. Anything needing a REAL browser session (the bell, mark-as-read,
--    the red banner). The SQL Editor has no app session.
-- 2. The "browser cannot insert a RED alert" check: the SQL Editor runs
--    as a privileged role, so `set local role authenticated` limits the
--    role but column GRANTs are evaluated against it — test that one from
--    the app, or trust the policy text.
-- 3. An error aborts the whole transaction, so each failing case needs its
--    own BEGIN ... ROLLBACK block. That is why D is commented out.
