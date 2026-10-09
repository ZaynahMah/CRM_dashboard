-- =====================================================================
-- CLiQ Push Ops — Comprehensive schema diagnostic
-- Run this FIRST, before FIX_SCHEMA_DRIFT.sql. Read-only — changes
-- nothing. Paste the full output back if you want it double-checked.
-- =====================================================================

-- ---------- 1. Missing columns on campaigns ----------
with expected(col) as (
  values
    ('id'),('campaign_name'),('campaign_origin'),
    ('category'),('sub_category'),('brand'),('offer'),('offer_details'),
    ('campaign_type'),('brief'),('product_collection'),('business_objective'),
    ('landing'),('reference_link'),('additional_notes'),
    ('expected_cvr'),('expected_rpv'),('date_time_brief'),
    ('calendar_slot_id'),('launch_date'),('launch_time'),('priority'),
    ('pncc_segment_label'),('pncc_segment_name'),('pncc_category_code'),('slot_type'),('slot_number'),
    ('audience'),('segment_1'),('segment_2'),('cohort'),('channel'),
    ('segment_id'),('segment_2_id'),('push_tag'),('group_id'),('collapse_id'),
    ('global_limit'),('sound'),('access_type'),('offer_construct'),('expected_reach'),
    ('title_brief'),('message_brief'),
    ('header'),('sub_copy_text'),('h_count'),('s_count'),('creative_link'),
    ('collapse'),('ops_details'),('channel_name'),('channel_format'),('keywords'),
    ('cid'),('campaign_id_ext'),('tracking_code'),('landing_plus_tracking'),('tracking_code_check'),
    ('feedback_1'),('feedback_2'),('date_ddmmyy'),
    ('category_status'),('crm_status'),('content_status'),('qc_status'),('production_status'),
    ('workflow_status'),('is_emergency'),('emergency_reason'),('business_deadline'),
    ('emergency_score'),('is_urgent'),('urgent_reason'),
    ('emergency_status'),('emergency_rejection_reason'),
    ('design_status'),('is_crm_self'),
    ('calendar_status'),('calendar_updated_at'),('calendar_updated_by'),
    ('category_deadline'),('submitted_at'),('created_by'),('assigned_to'),
    ('created_at'),('updated_at'),('pn_template'),('creative_requirements')
)
select 'column: ' || e.col as item, 'MISSING' as status
from expected e
left join information_schema.columns c
  on c.table_name = 'campaigns' and c.column_name = e.col and c.table_schema = 'public'
where c.column_name is null
order by 1;

-- ---------- 2. Missing functions/RPCs ----------
with expected(fn) as (
  values ('submit_category'),('submit_content'),('apply_change_request'),
         ('accept_emergency'),('reject_emergency'),('update_calendar'),
         ('current_app_role'),('is_crm'),('handle_new_auth_user'),('sync_workflow_status')
)
select 'function: ' || e.fn as item, 'MISSING' as status
from expected e
left join information_schema.routines r
  on r.routine_name = e.fn and r.routine_schema = 'public'
where r.routine_name is null;

-- ---------- 3. Missing triggers ----------
with expected(trg) as (
  values ('on_auth_user_created'),('campaigns_sync_slot'),
         ('campaigns_sync_workflow_status'),('campaigns_sync_group')
)
select 'trigger: ' || e.trg as item, 'MISSING' as status
from expected e
left join information_schema.triggers t on t.trigger_name = e.trg
where t.trigger_name is null;

-- ---------- 4. Missing/weak RLS policies on campaigns ----------
select 'RLS enabled on campaigns' as item,
  case when relrowsecurity then 'OK' else 'MISSING — RLS IS OFF' end as status
from pg_class where relname = 'campaigns';

with expected(pol) as (
  values ('campaigns_design_write')
)
select 'policy: ' || e.pol as item, 'MISSING' as status
from expected e
left join pg_policies p on p.policyname = e.pol and p.tablename = 'campaigns'
where p.policyname is null;

-- ---------- 5. app_role enum actually contains DESIGN ----------
select 'enum value: app_role.DESIGN' as item,
  case when 'DESIGN' = any(enum_range(null::app_role)::text[]) then 'OK' else 'MISSING' end as status;

-- ---------- 6. Does the campaigns_day_time_slot_unique index exist already? ----------
-- (informational only — this tells you whether a PRIOR run of 10_slot_dedup.sql
-- already created the constraint we now believe may be wrong for your data)
select 'index: campaigns_day_time_slot_unique' as item,
  case when exists (select 1 from pg_indexes where indexname = 'campaigns_day_time_slot_unique')
    then 'EXISTS — see note below' else 'does not exist' end as status;

-- ---------- 7. Sample the actual repeated-slot rows, if any exist yet ----------
-- Only meaningful if you've already tried an upload that partially succeeded.
-- This is the query that will tell us the real natural key — run it and
-- send me the output if any rows come back.
select launch_date, launch_time, slot_number, pncc_segment_label, pncc_category_code, count(*)
from campaigns
group by 1,2,3,4,5
having count(*) > 1
order by 1,2,3
limit 20;
