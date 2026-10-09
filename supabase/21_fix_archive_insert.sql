-- =====================================================================
-- CLiQ Push Ops — 21: fix archive insert (code 42601)
--
-- Run AFTER 18 (and 19, 20). Safe to run more than once.
--
-- PROBLEM
--   Reset failed: "INSERT has more expressions than target columns" (42601).
--   The archive tables were created with LIKE campaigns at the time 18 ran.
--   "create table if not exists" never adds columns later, so when
--   campaigns (and the other tables) gained columns afterwards (e.g. the
--   tracking_* columns from migration 16), "select c.*, batch, now(), actor"
--   produced more values than the archive table has columns.
--
-- FIX
--   1. Add any column that exists on the live table but is missing on its
--      archive table (same type). Run now AND at the start of every reset,
--      so a future column can never break the reset again.
--   2. Archive by column NAME, not by position: to_jsonb(row) plus the batch
--      fields, mapped onto the archive row with jsonb_populate_record.
--      Column order and column count no longer matter.
--   Everything else in the reset is unchanged (CRM-only, empty-sheet guard,
--   archive verify, "where true" deletes, explicit insert column list).
-- =====================================================================

-- ═════════ 1. COLUMN SYNC HELPER ═════════
create or replace function public.sync_archive_columns()
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select src.table_name as src_table,
           src.table_name || '_archive' as arc_table,
           src.column_name,
           format_type(a.atttypid, a.atttypmod) as col_type
    from information_schema.columns src
    join pg_attribute a
      on a.attrelid = ('public.' || src.table_name)::regclass
     and a.attname = src.column_name
     and not a.attisdropped
    where src.table_schema = 'public'
      and src.table_name in ('campaigns','activity_logs','qc_checklists','crm_decisions')
      and not exists (
        select 1 from information_schema.columns arc
        where arc.table_schema = 'public'
          and arc.table_name = src.table_name || '_archive'
          and arc.column_name = src.column_name)
  loop
    execute format('alter table public.%I add column if not exists %I %s',
                   r.arc_table, r.column_name, r.col_type);
  end loop;
end $$;

revoke all on function public.sync_archive_columns() from public;

-- Sync now.
select public.sync_archive_columns();


-- ═════════ 2. RESET FUNCTION (archive by column name) ═════════
create or replace function public.reset_campaigns_with_archive(
  p_rows        jsonb,
  p_is_crm_self boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch       uuid := gen_random_uuid();
  v_actor       uuid := auth.uid();
  v_meta        jsonb;
  v_campaigns   integer := 0;
  v_logs        integer := 0;
  v_checks      integer := 0;
  v_decisions   integer := 0;
  v_calendar    integer := 0;
  v_inserted    integer := 0;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset campaigns.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'reset_campaigns_with_archive expects a JSON array of rows.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to reset: the uploaded sheet contains no rows.';
  end if;

  -- Make sure every live column exists on the archive tables.
  perform public.sync_archive_columns();

  v_meta := jsonb_build_object(
    'archive_batch_id', v_batch,
    'archived_at',      now(),
    'archived_by',      v_actor);

  select count(*) into v_calendar from campaigns where calendar_status = 'UPDATED';

  -- ---------- archive, matched by column NAME ----------
  insert into campaigns_archive
    select (jsonb_populate_record(null::campaigns_archive, to_jsonb(c) || v_meta)).*
    from campaigns c;
  get diagnostics v_campaigns = row_count;

  insert into activity_logs_archive
    select (jsonb_populate_record(null::activity_logs_archive, to_jsonb(a) || v_meta)).*
    from activity_logs a;
  get diagnostics v_logs = row_count;

  insert into qc_checklists_archive
    select (jsonb_populate_record(null::qc_checklists_archive, to_jsonb(q) || v_meta)).*
    from qc_checklists q;
  get diagnostics v_checks = row_count;

  insert into crm_decisions_archive
    select (jsonb_populate_record(null::crm_decisions_archive, to_jsonb(d) || v_meta)).*
    from crm_decisions d;
  get diagnostics v_decisions = row_count;

  -- ---------- verify the archive BEFORE destroying anything ----------
  if v_campaigns <> (select count(*) from campaigns) then
    raise exception 'Archive incomplete: % campaigns archived, % live. Aborting.',
      v_campaigns, (select count(*) from campaigns);
  end if;

  -- ---------- delete EVERYTHING ("where true" for pg_safeupdate) ----------
  delete from change_requests where true;
  delete from notifications where true;
  delete from campaigns where true;   -- cascades activity_logs, qc_checklists, crm_decisions, content_submissions

  -- ---------- insert the new sheet (explicit column list) ----------
  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by
  )
  select
    r.campaign_name, r.campaign_origin::campaign_origin, r.launch_date, r.launch_time,
    r.slot_number, r.pncc_segment_label, r.pncc_category_code, r.category, r.slot_type,
    coalesce(r.is_crm_self, false),
    r.sub_category, r.brand, r.offer, r.title_brief, r.message_brief, r.pn_template,
    r.creative_requirements,
    coalesce(r.category_status, 'EMPTY')::category_status,
    coalesce(r.crm_status, 'NOT_STARTED')::crm_status,
    coalesce(r.content_status, 'NOT_ASSIGNED')::content_status,
    coalesce(r.qc_status, 'PENDING')::qc_status,
    coalesce(r.production_status, 'NOT_READY')::production_status,
    coalesce(r.priority, 'NORMAL')::priority_level,
    r.created_by
  from jsonb_to_recordset(p_rows) as r(
    campaign_name text, campaign_origin text, launch_date date, launch_time time,
    slot_number integer, pncc_segment_label text, pncc_category_code text,
    category text, slot_type text, is_crm_self boolean,
    sub_category text, brand text, offer text, title_brief text, message_brief text,
    pn_template text, creative_requirements text,
    category_status text, crm_status text, content_status text, qc_status text,
    production_status text, priority text, created_by uuid
  );
  get diagnostics v_inserted = row_count;

  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception 'Insert incomplete: % of % rows written. Aborting.',
      v_inserted, jsonb_array_length(p_rows);
  end if;

  insert into upload_reset_batches (
    id, performed_by, is_crm_self, campaigns_archived, logs_archived,
    checklists_archived, decisions_archived, campaigns_inserted, on_calendar_removed)
  values (v_batch, v_actor, p_is_crm_self, v_campaigns, v_logs,
          v_checks, v_decisions, v_inserted, v_calendar);

  insert into activity_logs (campaign_id, user_id, action, description)
  values (null, v_actor, 'UPLOAD_RESET',
    format('CRM reset the dashboard from an upload. Archived %s campaigns '
           '(%s on calendar), inserted %s new rows. Archive batch %s.',
           v_campaigns, v_calendar, v_inserted, v_batch));

  return v_batch;
end $$;

revoke all on function public.reset_campaigns_with_archive(jsonb, boolean) from public;
grant execute on function public.reset_campaigns_with_archive(jsonb, boolean) to authenticated;


-- ═════════ 3. VERIFY ═════════
-- Expect ZERO rows: no live column is missing from its archive table.
select src.table_name, src.column_name as missing_in_archive
from information_schema.columns src
where src.table_schema = 'public'
  and src.table_name in ('campaigns','activity_logs','qc_checklists','crm_decisions')
  and not exists (
    select 1 from information_schema.columns arc
    where arc.table_schema = 'public'
      and arc.table_name = src.table_name || '_archive'
      and arc.column_name = src.column_name);

-- Expect true / true.
select prosrc like '%jsonb_populate_record(null::campaigns_archive%' as archive_by_name,
       prosrc like '%delete from campaigns where true%'             as safeupdate_fixed
from pg_proc where proname = 'reset_campaigns_with_archive';


-- ═════════ 4. RELOAD THE POSTGREST SCHEMA CACHE ═════════
notify pgrst, 'reload schema';
