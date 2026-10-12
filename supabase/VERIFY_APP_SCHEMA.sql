-- =====================================================================
-- CLiQ Push Ops — does the database have everything the app needs?
--
-- Run AFTER migrations 14-19. Returns ONE ROW PER MISSING THING.
-- ZERO ROWS = the app has everything it needs.
--
-- Safe to run any time; reads only catalogue tables and changes nothing.
-- =====================================================================

with required_columns(tbl, col) as (values
  -- activity_logs: the exact names the app's log() writes. Getting these
  -- wrong is what broke migrations 14, 16, 18 and 19.
  ('activity_logs','campaign_id'), ('activity_logs','user_id'),
  ('activity_logs','action'),      ('activity_logs','description'),
  -- tracking short codes (migration 16)
  ('campaigns','tracking_category'), ('campaigns','tracking_sub_category'),
  ('campaigns','tracking_brand'),    ('campaigns','tracking_offer'),
  ('campaigns','tracking_landing'),  ('campaigns','campaign_name_code'),
  -- tracking output columns
  ('campaigns','tracking_code'), ('campaigns','landing_plus_tracking'),
  ('campaigns','tracking_code_check'), ('campaigns','cid'),
  ('campaigns','campaign_id_ext'),
  -- CRM final-ops columns the drawer and workspace write
  ('campaigns','campaign_type'), ('campaigns','channel_name'),
  ('campaigns','channel_format'), ('campaigns','segment_1'),
  ('campaigns','segment_2'), ('campaigns','keywords'),
  ('campaigns','collapse'), ('campaigns','group_id'),
  ('campaigns','ops_details'), ('campaigns','feedback_1'), ('campaigns','feedback_2'),
  ('campaigns','sound'), ('campaigns','global_limit'),
  -- workflow columns
  ('campaigns','category_status'), ('campaigns','crm_status'),
  ('campaigns','content_status'), ('campaigns','design_status'),
  ('campaigns','qc_status'), ('campaigns','calendar_status'),
  ('campaigns','production_status'), ('campaigns','is_crm_self'),
  ('campaigns','is_emergency'), ('campaigns','pn_template'),
  ('campaigns','creative_link'), ('campaigns','header'), ('campaigns','sub_copy_text'),
  -- Final QC checklist, all ten
  ('qc_checklists','category_verified'), ('qc_checklists','brand_verified'),
  ('qc_checklists','offer_verified'),    ('qc_checklists','landing_verified'),
  ('qc_checklists','date_verified'),     ('qc_checklists','time_verified'),
  ('qc_checklists','audience_verified'), ('qc_checklists','creative_verified'),
  ('qc_checklists','copy_verified'),     ('qc_checklists','tracking_verified'),
  -- archive (migration 18)
  ('campaigns_archive','archive_batch_id'), ('campaigns_archive','archived_at'),
  ('activity_logs_archive','archive_batch_id'),
  ('qc_checklists_archive','archive_batch_id'),
  ('crm_decisions_archive','archive_batch_id'),
  ('upload_reset_batches','campaigns_archived'),
  ('upload_reset_batches','campaigns_inserted'),
  ('reset_events','batch_id'), ('reset_events','performed_at'), ('reset_events','row_count'),
  ('performance_reports','file_name'), ('performance_reports','storage_path'),
  ('performance_reports','uploaded_by'), ('performance_reports','uploaded_at'),
  ('performance_reports','is_current'), ('performance_reports','sheets_found'),
  ('performance_reports','sheet_count'), ('performance_reports','warnings'),
  ('performance_reports','current_month'), ('performance_reports','row_count'),
  ('performance_monthly_kpi','report_id'), ('performance_dimensions','report_id'),
  ('performance_dimensions','sheet_key'), ('performance_dimensions','extra'),
  ('performance_top_pn','report_id'), ('performance_top_pn','rank'),
  ('category_sla','week_key'), ('category_sla','week_start'), ('category_sla','week_end'),
  ('category_sla','deadline'), ('category_sla','category'), ('category_sla','status'),
  ('category_sla','defaulted_at'), ('category_sla','crm_filled_by'), ('category_sla','crm_filled_at'),
  ('activities','event_type'), ('activities','details'), ('activities','dedupe_key'),
  ('system_notifications','kind'), ('system_notifications','title'),
  ('system_notifications','body'), ('system_notifications','dedupe_key'),
  ('content_change_sets','campaign_id'), ('content_change_sets','changed_fields'),
  ('content_change_sets','changed_by'), ('content_change_sets','source'),
  ('content_change_sets','acknowledged_at')
),
required_tables(tbl) as (values
  ('campaigns'), ('profiles'), ('activity_logs'), ('notifications'),
  ('qc_checklists'), ('crm_decisions'), ('content_submissions'), ('change_requests'),
  ('campaigns_archive'), ('activity_logs_archive'), ('qc_checklists_archive'),
  ('crm_decisions_archive'), ('upload_reset_batches'), ('reset_events'),
  -- Executive performance persistence (migration 23)
  ('performance_reports'), ('performance_monthly_kpi'),
  ('performance_dimensions'), ('performance_top_pn'),
  -- Category SLA, Activities, shared Notifications (migration 24)
  ('category_sla'), ('activities'), ('system_notifications'),
  ('system_notification_reads'), ('category_default_threshold'),
  ('content_change_sets')
),
-- Function name plus the EXACT argument names the app's supabase.rpc() calls
-- pass. A name match with different parameter names still fails at runtime.
required_functions(fn, args) as (values
  ('update_calendar',             'p_campaign_id'),
  ('submit_category',             'p_campaign_id'),
  ('submit_content',              'p_campaign_id'),
  ('accept_emergency',            'p_campaign_id'),
  ('reject_emergency',            'p_campaign_id'),
  ('apply_change_request',        'p_request_id'),
  ('reset_campaigns_with_archive','p_rows, p_is_crm_self'),
  ('current_app_role',            ''),
  ('is_crm',                      ''),
  ('enforce_column_ownership',    ''),
  ('monthly_workflow_summary',    ''),
  ('emit_reset_event',            ''),
  ('set_current_performance_report','p_report_id'),
  ('business_week_start',          'p_date'),
  ('business_week_end',            'p_date'),
  ('business_week_key',            'p_date'),
  ('category_week_deadline',       'p_date'),
  ('recalculate_category_sla',     'p_as_of'),
  ('record_crm_sla_override',      'p_sla_id'),
  ('category_sla_summary',         ''),
  ('category_sla_trend',           ''),
  ('category_sla_offenders',       ''),
  ('upload_reset_preview',         'p_is_crm_self'),
  ('category_default_rate',        ''),
  ('org_default_rate',             ''),
  ('default_rate_trend',           ''),
  ('evaluate_default_thresholds',  'p_threshold'),
  ('content_changes_for_review',   ''),
  ('acknowledge_content_changes',  'p_campaign_id')
)

select 'MISSING TABLE' as problem, tbl as object, '' as detail
from required_tables r
where not exists (
  select 1 from information_schema.tables t
  where t.table_schema = 'public' and t.table_name = r.tbl)

union all
select 'MISSING COLUMN', rc.tbl || '.' || rc.col, ''
from required_columns rc
where exists (
    select 1 from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = rc.tbl)
  and not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = rc.tbl
      and c.column_name = rc.col)

union all
select 'MISSING FUNCTION', rf.fn, 'expected args: ' || rf.args
from required_functions rf
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = rf.fn)

union all
select 'FUNCTION ARG NAMES DIFFER', rf.fn,
       'expected: ' || rf.args || ' | actual: ' ||
       coalesce(array_to_string(p.proargnames, ', '), '')
from required_functions rf
join pg_proc p on p.proname = rf.fn
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where rf.args <> ''
  and coalesce(array_to_string(p.proargnames, ', '), '') <> rf.args

union all
select 'SECURITY DEFINER WITHOUT search_path', p.proname, ''
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig,'{}')) cfg where cfg like 'search_path=%')

union all
select 'TABLE WITHOUT RLS', c.relname, ''
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

union all
select 'POLICY STILL REFERENCES DESIGN', tablename || '.' || policyname, ''
from pg_policies
where schemaname = 'public'
  and (coalesce(qual,'') ilike '%DESIGN%' or coalesce(with_check,'') ilike '%DESIGN%')

union all
select 'OLD-FORMAT TRACKING CODE', id::text, tracking_code
from campaigns
where tracking_code is not null and btrim(tracking_code) <> ''
  and tracking_code not like 'cid=%' and calendar_status <> 'UPDATED'

order by problem, object;

-- ZERO ROWS = ready. Any row names exactly what to fix.

-- ---------- Performance persistence invariants (migration 23) ----------
-- At most ONE current report. Any row here is a bug.
select 'MORE THAN ONE CURRENT PERFORMANCE REPORT' as problem,
       count(*)::text as object, '' as detail
from performance_reports where is_current
having count(*) > 1;

-- Campaign reset must never be able to delete a performance report.
-- Zero rows expected.
select 'PERFORMANCE TABLE REFERENCES CAMPAIGNS' as problem,
       tc.table_name as object, kcu.column_name as detail
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
where tc.table_schema='public' and tc.constraint_type='FOREIGN KEY'
  and tc.table_name like 'performance_%' and ccu.table_name='campaigns';

-- ---------- The ONE deadline rule (migration 24) ----------
-- Business week 1 Nov - 7 Nov must yield 25 Oct. Any row here means the
-- deadline rule has drifted from the business definition.
select 'DEADLINE RULE WRONG' as problem,
       public.category_week_deadline(date '2026-11-01')::text as object,
       'expected 2026-10-25' as detail
where public.category_week_deadline(date '2026-11-01') <> date '2026-10-25';

-- Every campaign in a week must inherit the SAME deadline.
select 'DEADLINE NOT PER WEEK' as problem, '2026-11-01 vs 2026-11-07' as object, '' as detail
where public.category_week_deadline(date '2026-11-01')
   <> public.category_week_deadline(date '2026-11-07');
