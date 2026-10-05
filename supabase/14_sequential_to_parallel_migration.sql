-- =====================================================================
-- CLiQ Push Ops — 14: unstick in-flight campaigns after the move from the
-- sequential Content→CRM→Design model back to parallel Content + Design.
--
-- Run FOURTEENTH, immediately AFTER deploying the parallel build.
-- Safe to run more than once (it only touches rows still in the stuck
-- state, and re-running finds none).
--
-- WHY THIS IS NEEDED
-- Under the sequential model, CRM routed a campaign to Content first and
-- only set design_status = 'PENDING' later, after reviewing the copy. So a
-- campaign could legitimately sit at:
--
--     content_status = 'SUBMITTED'   (Content finished)
--     design_status  = 'NOT_ASSIGNED' (CRM had not routed it onward yet)
--
-- Under the parallel model, stageOf() returns PRODUCTION_SUBMITTED only
-- when BOTH teams have submitted. These rows therefore read as
-- PRODUCTION_PENDING and wait forever for a Design submission that was
-- never requested — invisible to Design (design_status is NOT_ASSIGNED, so
-- the Design queue filters them out) and not actionable by CRM.
--
-- The fix is to route them to Design now, which is what CRM would have done
-- manually under the old model. Nothing else about them changes.
-- =====================================================================

-- ---------- 1. LOOK FIRST. Run this on its own and read the output. ----------
select
  id,
  campaign_name,
  launch_date,
  is_crm_self,
  content_status,
  design_status,
  qc_status,
  calendar_status
from campaigns
where content_status = 'SUBMITTED'
  and design_status  = 'NOT_ASSIGNED'
  and qc_status      <> 'PASSED'
order by launch_date, id;

-- How many, and are any already live on the calendar?
select
  count(*)                                               as stuck_rows,
  count(*) filter (where calendar_status = 'UPDATED')    as already_on_calendar,
  count(*) filter (where is_crm_self)                    as crm_self_rows,
  min(launch_date)                                       as earliest_launch,
  max(launch_date)                                       as latest_launch
from campaigns
where content_status = 'SUBMITTED'
  and design_status  = 'NOT_ASSIGNED'
  and qc_status      <> 'PASSED';

-- ---------- 2. THE FIX ----------
-- Routes each stuck campaign to Design, exactly as CRM would have done.
--
-- `calendar_status <> 'UPDATED'` is in the predicate as well as the
-- qc_status check: a campaign already published to the calendar must never
-- be pulled back into the production queue, whatever its other columns say.
--
-- Only design_status is written. content_status, qc_status, crm_status and
-- every Category/Content field are left exactly as they are.

update campaigns
   set design_status = 'PENDING'
 where content_status  = 'SUBMITTED'
   and design_status   = 'NOT_ASSIGNED'
   and qc_status      <> 'PASSED'
   and calendar_status <> 'UPDATED';

-- ---------- 3. AUDIT TRAIL ----------
-- One activity_logs row per campaign moved, so the change is attributable
-- rather than appearing as an unexplained status jump. actor is null
-- because this is a migration, not a person.

insert into activity_logs (campaign_id, actor_id, action, detail)
select
  c.id,
  null,
  'MIGRATION_ROUTED_TO_DESIGN',
  'Migration 14: routed to Design after the workflow moved from sequential to parallel. '
    || 'This campaign had Content submitted but had not yet been routed onward under the old model.'
from campaigns c
where c.design_status  = 'PENDING'
  and c.content_status = 'SUBMITTED'
  and c.qc_status     <> 'PASSED'
  and c.calendar_status <> 'UPDATED'
  and not exists (
    select 1 from activity_logs l
     where l.campaign_id = c.id
       and l.action = 'MIGRATION_ROUTED_TO_DESIGN'
  );

-- ---------- 4. VERIFY: this must return zero rows ----------
select id, campaign_name, content_status, design_status, qc_status
from campaigns
where content_status = 'SUBMITTED'
  and design_status  = 'NOT_ASSIGNED'
  and qc_status     <> 'PASSED'
  and calendar_status <> 'UPDATED';

-- ---------- 5. The mirror image, for completeness ----------
-- The reverse case cannot occur under the old sequential model (Design was
-- never routed before Content), so there is deliberately no UPDATE for it.
-- This query only confirms that. It should also return zero rows; if it
-- does not, STOP and investigate rather than running an untested fix.
select id, campaign_name, content_status, design_status
from campaigns
where design_status  = 'SUBMITTED'
  and content_status = 'NOT_ASSIGNED'
  and qc_status     <> 'PASSED'
  and calendar_status <> 'UPDATED';
