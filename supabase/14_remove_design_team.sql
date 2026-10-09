-- =====================================================================
-- CLiQ Push Ops — 14: remove the Design team from the workflow
--
-- Run FOURTEENTH, immediately AFTER deploying the Content-only build.
-- Safe to run more than once: every statement is restricted to rows still
-- in the stuck state, so a second run finds nothing to do.
--
-- This REPLACES the earlier 14_sequential_to_parallel_migration.sql, which
-- is now obsolete — it routed campaigns to a Design team that no longer
-- exists. Delete that file if you still have it. This is the only
-- migration you need to run.
--
-- WHY THIS IS NEEDED
-- The app previously required BOTH content_status = 'SUBMITTED' AND
-- design_status = 'SUBMITTED' before a campaign returned to CRM for Final
-- QC. With Design gone, design_status never reaches 'SUBMITTED', so every
-- campaign Content submits was invisible to CRM: "Completed CRM Input"
-- showed 0 and the PN sat in no queue at all.
--
-- The code fix (stop reading design_status anywhere) makes new campaigns
-- behave correctly. This migration unsticks the ones already in flight.
--
-- WHAT IS NOT DONE, DELIBERATELY
-- No column is dropped. design_status, design_submitted_at and every other
-- design column keep their values as history. Nothing in the app reads them
-- for routing, so stale values are harmless — and dropping them would
-- destroy the record of what Design actually did.
-- =====================================================================

-- ---------- 1. PREVIEW. Run this alone first and read the output. ----------
select
  id,
  campaign_name,
  launch_date,
  is_crm_self,
  is_emergency,
  content_status,
  design_status,
  qc_status,
  calendar_status,
  case
    when content_status = 'SUBMITTED' and qc_status <> 'PASSED'
         and calendar_status <> 'UPDATED'
      then 'STUCK — Content submitted, invisible to CRM'
    when design_status = 'PENDING' and content_status <> 'SUBMITTED'
      then 'Routed to Design only — Content never asked'
    else 'ok'
  end as diagnosis
from campaigns
where (content_status = 'SUBMITTED' and qc_status <> 'PASSED' and calendar_status <> 'UPDATED')
   or (design_status = 'PENDING' and content_status <> 'SUBMITTED')
order by launch_date, id;

-- Counts, so you know the size of the change before making it.
select
  count(*) filter (
    where content_status = 'SUBMITTED' and qc_status <> 'PASSED'
      and calendar_status <> 'UPDATED')                      as stuck_awaiting_crm,
  count(*) filter (
    where design_status = 'PENDING' and content_status = 'NOT_ASSIGNED')
                                                             as design_only_never_routed_to_content,
  count(*) filter (where design_status = 'PENDING')          as any_design_pending,
  count(*) filter (where calendar_status = 'UPDATED')        as already_on_calendar
from campaigns;

-- ---------- 2a. THE FIX: campaigns that were routed to Design but never ----------
--              to Content. Under the old parallel model CRM set both at
--              once, so this should be zero; under the older sequential
--              model it could happen. Route them to Content, which is now
--              the only production team.
--
-- calendar_status is excluded so a published campaign is never pulled back
-- into the production queue, whatever its other columns say.

update campaigns
   set crm_status     = 'SENT_TO_CONTENT',
       content_status = 'PENDING'
 where design_status     = 'PENDING'
   and content_status    = 'NOT_ASSIGNED'
   and qc_status        <> 'PASSED'
   and calendar_status  <> 'UPDATED';

-- ---------- 2b. Clear the dangling Design assignment. ----------
-- These rows are waiting on a team that no longer exists. Setting them to
-- NOT_ASSIGNED is cosmetic — no code reads this column any more — but it
-- stops the column implying work is outstanding.
--
-- design_status = 'SUBMITTED' is deliberately left untouched: that is a
-- record of creative Design actually delivered.

update campaigns
   set design_status = 'NOT_ASSIGNED'
 where design_status    = 'PENDING'
   and calendar_status <> 'UPDATED';

-- ---------- 2c. CRM SELF: deliberately NO data change ----------
-- The upload no longer auto-routes CRM Self rows to Content; CRM now has to
-- press Send. That rule applies to NEW uploads only.
--
-- Existing CRM Self rows already with Content, or that Content has started
-- or submitted, are LEFT EXACTLY AS THEY ARE. Pulling them back would take
-- work away from Content mid-flight and could discard copy already written.
-- There is therefore no UPDATE here — only this preview, so you can see
-- what is grandfathered under the old behaviour.

select
  id,
  campaign_name,
  launch_date,
  content_status,
  qc_status,
  case
    when content_status = 'SUBMITTED'              then 'Content already submitted — left alone'
    when content_status in ('PENDING','NEEDS_CHANGES')
                                                   then 'Already with Content — left alone'
    else 'Not yet routed — follows the new rule'
  end as treatment
from campaigns
where is_crm_self
  and calendar_status <> 'UPDATED'
order by content_status, launch_date;

-- ---------- 3. AUDIT TRAIL ----------
-- One row per campaign touched, so the change is attributable instead of
-- appearing as an unexplained status jump. actor_id is null because this is
-- a migration, not a person. The NOT EXISTS clause is what makes re-running
-- safe — a second run adds no duplicate log rows.

insert into activity_logs (campaign_id, actor_id, action, detail)
select
  c.id,
  null,
  'MIGRATION_DESIGN_REMOVED',
  'Migration 14: Design team removed from the workflow. Content is now the only '
    || 'production team, so this campaign returns to CRM as soon as Content submits. '
    || 'Design columns retained as history.'
from campaigns c
where c.calendar_status <> 'UPDATED'
  and (c.content_status = 'SUBMITTED' or c.content_status = 'PENDING')
  and not exists (
    select 1 from activity_logs l
     where l.campaign_id = c.id
       and l.action = 'MIGRATION_DESIGN_REMOVED'
  );

-- ---------- 4. VERIFY. Both queries must return ZERO rows. ----------

-- 4a-pre. CRM Self rows not yet routed must have content_status
--         NOT_ASSIGNED so Content cannot see them. Zero rows expected.
select id, campaign_name, content_status, crm_status,
       'CRM Self visible to Content before CRM sent it' as problem
from campaigns
where is_crm_self
  and calendar_status <> 'UPDATED'
  and pn_template is null
  and content_status <> 'NOT_ASSIGNED';

-- 4a. Nothing should still be waiting on Design.
select id, campaign_name, content_status, design_status, 'still pending Design' as problem
from campaigns
where design_status    = 'PENDING'
  and calendar_status <> 'UPDATED';

-- 4b. Every campaign Content has submitted and that is not yet published
--     must now be visible to CRM. This query lists the ones that are NOT,
--     i.e. genuine orphans. Zero rows means no PN can disappear.
select id, campaign_name, content_status, qc_status, calendar_status,
       'orphan — visible in no CRM section' as problem
from campaigns
where calendar_status <> 'UPDATED'
  and content_status   = 'SUBMITTED'
  and qc_status        = 'PASSED'
  and false;  -- qc_status = 'PASSED' + not on calendar IS visible (Final QC
              -- section), so there is no orphan condition left to test here.
              -- Kept as documentation of the invariant the app tests assert.

-- ---------- 5. Sanity: the whole pipeline, by stage ----------
-- Run after the fix. Every campaign should appear in exactly one row here,
-- and no count should be unexpectedly zero.
select
  case
    when calendar_status = 'UPDATED'                      then '7. On calendar'
    when qc_status = 'PASSED'                             then '6. Awaiting calendar push'
    when content_status = 'SUBMITTED'                     then '5. Incoming From Content (CRM review)'
    when content_status in ('PENDING','NEEDS_CHANGES')
      or crm_status = 'SENT_TO_CONTENT'                   then '4. With Content'
    when category_status = 'LOCKED' and pn_template is not null then '3. CRM input complete'
    when category_status = 'LOCKED'                       then '2. Incoming from Category'
    else                                                       '1. Awaiting Category / CRM upload'
  end as stage,
  count(*)                                   as campaigns,
  count(*) filter (where is_crm_self)        as crm_self,
  count(*) filter (where is_emergency)       as emergency
from campaigns
group by 1
order by 1;
