-- Compare the columns this repo's migrations produce against the LIVE
-- campaigns columns (pre-14) the CRM team supplied. Any difference is a bug.
\o /dev/null
create temp table live_cols(col text);
insert into live_cols(col) values
('id'),('campaign_name'),('campaign_origin'),('category'),('sub_category'),('brand'),
('offer'),('offer_details'),('campaign_type'),('brief'),('product_collection'),
('business_objective'),('landing'),('reference_link'),('additional_notes'),
('calendar_slot_id'),('launch_date'),('launch_time'),('priority'),('audience'),
('segment_1'),('segment_2'),('cohort'),('campaign_id_ext'),('cid'),('tracking_code'),
('category_status'),('crm_status'),('content_status'),('qc_status'),('production_status'),
('is_emergency'),('emergency_reason'),('business_deadline'),('emergency_score'),
('category_deadline'),('submitted_at'),('created_by'),('assigned_to'),('created_at'),
('updated_at'),('channel'),('segment_id'),('segment_2_id'),('push_tag'),('group_id'),
('collapse_id'),('global_limit'),('sound'),('pn_template'),('access_type'),
('offer_construct'),('expected_reach'),('slot_number'),('pncc_segment_label'),
('pncc_segment_name'),('pncc_category_code'),('slot_type'),('date_time_brief'),
('expected_cvr'),('expected_rpv'),('creative_requirements'),('creative_link'),
('workflow_status'),('is_urgent'),('urgent_reason'),('title_brief'),('message_brief'),
('header'),('sub_copy_text'),('h_count'),('s_count'),('collapse'),('ops_details'),
('channel_name'),('channel_format'),('keywords'),('landing_plus_tracking'),
('tracking_code_check'),('feedback_1'),('feedback_2'),('date_ddmmyy'),('design_status'),
('emergency_status'),('emergency_rejection_reason'),('is_crm_self'),('calendar_status'),
('calendar_updated_at'),('calendar_updated_by');

-- Columns migrations 16 and 20 legitimately ADD on top of the live set.
create temp table expected_new(col text);
insert into expected_new(col) values
('tracking_category'),('tracking_sub_category'),('tracking_brand'),
('tracking_offer'),('tracking_landing'),('campaign_name_code');
\o

\echo ''
\echo '== campaigns column parity vs LIVE (expect zero rows) =='
select 'MISSING from migrations (live has it, we do not)' as problem, l.col
from live_cols l
where not exists (select 1 from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns' and c.column_name=l.col)
union all
select 'UNEXPECTED EXTRA (we have it, live does not, and 16/20 do not add it)', c.column_name
from information_schema.columns c
where c.table_schema='public' and c.table_name='campaigns'
  and not exists (select 1 from live_cols l where l.col=c.column_name)
  and not exists (select 1 from expected_new e where e.col=c.column_name)
order by 1, 2;

select
  (select count(*) from live_cols)                                     as live_columns,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns')            as our_columns,
  (select count(*) from expected_new)                                  as added_by_16_and_20;
