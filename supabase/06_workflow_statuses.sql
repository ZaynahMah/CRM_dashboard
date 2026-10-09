-- =====================================================================
-- CLiQ Push Ops — Workflow status expansion + urgent campaigns
-- Run SIXTH. Adds the refined status progression, week-wise deadlines,
-- and all remaining campaign columns from the PN CC sheet.
-- =====================================================================

-- ---------- expanded status enum ----------
do $$ begin
  create type campaign_workflow_status as enum (
    'CRM_INPUT','CATEGORY_PENDING','CATEGORY_IN_PROGRESS','CATEGORY_SUBMITTED',
    'CRM_REVIEW','CRM_COMPLETED','RECOMMENDATION_REVIEW',
    'CONTENT_CREATIVE','CRM_QC','READY_TO_PUBLISH','PUBLISHED',
    'URGENT_PENDING_CRM'
  );
exception when duplicate_object then null; end $$;

alter table campaigns add column if not exists workflow_status text not null default 'CRM_INPUT';
alter table campaigns add column if not exists is_urgent boolean not null default false;
alter table campaigns add column if not exists urgent_reason text;

-- ---------- CRM Content Handoff fields (Part 2) ----------
alter table campaigns add column if not exists title_brief text;
alter table campaigns add column if not exists message_brief text;
-- pn_template already exists
-- creative_requirements already exists

-- ---------- Content/Creative fields ----------
alter table campaigns add column if not exists header text;
alter table campaigns add column if not exists sub_copy_text text;
alter table campaigns add column if not exists h_count int;
alter table campaigns add column if not exists s_count int;
-- reference_link already exists

-- ---------- CRM Final Ops fields (Part 3) ----------
alter table campaigns add column if not exists collapse text;
alter table campaigns add column if not exists ops_details text;
-- sound already exists (boolean)
-- global_limit already exists
alter table campaigns add column if not exists channel_name text;
alter table campaigns add column if not exists channel_format text;
alter table campaigns add column if not exists keywords text;
-- cid, campaign_id_ext, tracking_code already exist
alter table campaigns add column if not exists landing_plus_tracking text;
alter table campaigns add column if not exists tracking_code_check text;
alter table campaigns add column if not exists feedback_1 text;
alter table campaigns add column if not exists feedback_2 text;
alter table campaigns add column if not exists date_ddmmyy text;

-- ---------- week-wise deadline view ----------
create or replace view campaign_week_deadlines as
select
  date_trunc('week', launch_date::timestamp)::date as week_start,
  (date_trunc('week', launch_date::timestamp) + interval '6 days')::date as week_end,
  (date_trunc('week', launch_date::timestamp) - interval '7 days')::date as category_deadline,
  count(*) as total_campaigns,
  count(*) filter (where workflow_status in ('CATEGORY_SUBMITTED','CRM_REVIEW','CRM_COMPLETED','RECOMMENDATION_REVIEW','CONTENT_CREATIVE','CRM_QC','READY_TO_PUBLISH','PUBLISHED')) as submitted,
  count(*) filter (where workflow_status in ('CRM_INPUT','CATEGORY_PENDING','CATEGORY_IN_PROGRESS')) as pending
from campaigns
where launch_date >= current_date - interval '7 days'
group by 1, 2, 3
order by 1;

-- Update seeded campaigns with workflow_status based on existing statuses
-- `where true` added for pg_safeupdate, which rejects an unqualified
-- UPDATE through the API. Behaviour is unchanged: every row is updated.
update campaigns set workflow_status = case
  when production_status = 'PUSHED' then 'PUBLISHED'
  when production_status = 'READY' then 'READY_TO_PUBLISH'
  when qc_status = 'IN_PROGRESS' or qc_status = 'PASSED' then 'CRM_QC'
  when content_status = 'SUBMITTED' then 'CRM_QC'
  when content_status = 'PENDING' or content_status = 'NEEDS_CHANGES' then 'CONTENT_CREATIVE'
  when crm_status = 'SENT_TO_CONTENT' then 'CONTENT_CREATIVE'
  when crm_status = 'IN_PLANNING' then 'CRM_COMPLETED'
  when crm_status = 'AWAITING_REVIEW' then 'CRM_REVIEW'
  when category_status = 'LOCKED' or category_status = 'SUBMITTED' then 'CATEGORY_SUBMITTED'
  when category_status = 'DRAFT' then 'CATEGORY_IN_PROGRESS'
  when brand is not null and offer is not null then 'CATEGORY_SUBMITTED'
  else 'CATEGORY_PENDING'
end
where true;

select workflow_status, count(*) from campaigns group by 1 order by 1;
