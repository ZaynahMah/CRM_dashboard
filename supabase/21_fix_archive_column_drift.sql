-- =====================================================================
-- CLiQ Push Ops — 21: fix archive column drift in the reset RPC
--
-- Run TWENTY-FIRST, after 20. Idempotent; safe to rerun.
--
-- THE BUG
--   INSERT has more expressions than target columns (SQLSTATE 42601)
--
-- Migration 18 creates the archive tables with
--     create table if not exists campaigns_archive (like campaigns ...)
-- and then archives with
--     insert into campaigns_archive select c.*, v_batch, now(), v_actor ...
--
-- `if not exists` does NOTHING when the table is already there. So if 18
-- ever ran while campaigns had a different column count — for example
-- before migration 16 added the six tracking_* columns — the archive table
-- keeps its OLD shape forever, while `c.*` grows with campaigns. The
-- positional INSERT then has more expressions than the archive has columns
-- and the whole reset aborts.
--
-- Two fixes, because the first alone would only hold until the next column
-- is added:
--   1. Bring every archive table up to its source table's shape.
--   2. Replace the positional archive INSERT with one that matches columns
--      BY NAME, built dynamically, so count and order can never matter again.
-- =====================================================================

-- ═════════ 1. DIAGNOSE: what drifted? ═════════
select
  'campaigns'        as source, count(*) as source_columns,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='campaigns_archive') as archive_columns
from information_schema.columns
where table_schema='public' and table_name='campaigns'
union all
select 'activity_logs', count(*),
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='activity_logs_archive')
from information_schema.columns where table_schema='public' and table_name='activity_logs'
union all
select 'qc_checklists', count(*),
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='qc_checklists_archive')
from information_schema.columns where table_schema='public' and table_name='qc_checklists'
union all
select 'crm_decisions', count(*),
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='crm_decisions_archive')
from information_schema.columns where table_schema='public' and table_name='crm_decisions';
-- archive_columns should be source_columns + 3 (batch id, timestamp, actor).

-- The exact columns missing from each archive.
select c.table_name || '_archive' as archive_table, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('campaigns','activity_logs','qc_checklists','crm_decisions')
  and not exists (
    select 1 from information_schema.columns a
    where a.table_schema = 'public'
      and a.table_name = c.table_name || '_archive'
      and a.column_name = c.column_name)
order by 1, 2;

-- ═════════ 2. BRING EVERY ARCHIVE UP TO ITS SOURCE'S SHAPE ═════════
-- Adds only what is missing, using the source column's own type. Never
-- drops or alters anything: an archive must keep columns the live table has
-- since lost, or history is destroyed.
do $$
declare
  r record;
  v_type text;
begin
  foreach r in array array[
    row('campaigns','campaigns_archive'),
    row('activity_logs','activity_logs_archive'),
    row('qc_checklists','qc_checklists_archive'),
    row('crm_decisions','crm_decisions_archive')
  ]::record[]
  loop
    null;  -- placeholder; the real loop is below (record arrays cannot be
           -- iterated this way portably)
  end loop;
end $$;

do $$
declare
  pair text[];
  src text;
  arc text;
  col record;
begin
  foreach pair slice 1 in array array[
    array['campaigns','campaigns_archive'],
    array['activity_logs','activity_logs_archive'],
    array['qc_checklists','qc_checklists_archive'],
    array['crm_decisions','crm_decisions_archive']
  ]
  loop
    src := pair[1];
    arc := pair[2];

    -- Skip if the archive does not exist yet; migration 18 creates it.
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=arc) then
      continue;
    end if;

    for col in
      select c.column_name,
             format_type(a.atttypid, a.atttypmod) as full_type
      from information_schema.columns c
      join pg_attribute a
        on a.attrelid = ('public.' || c.table_name)::regclass
       and a.attname  = c.column_name
      where c.table_schema = 'public'
        and c.table_name = src
        and not exists (
          select 1 from information_schema.columns ac
          where ac.table_schema='public' and ac.table_name=arc
            and ac.column_name = c.column_name)
    loop
      execute format('alter table public.%I add column if not exists %I %s',
                     arc, col.column_name, col.full_type);
      raise notice 'added %.% (%)', arc, col.column_name, col.full_type;
    end loop;
  end loop;
end $$;

-- ═════════ 3. ARCHIVE BY COLUMN NAME, NOT BY POSITION ═════════
-- Replaces reset_campaigns_with_archive. Everything else about it is
-- unchanged: CRM-only, empty sheet refused, archive verified before any
-- delete, one transaction, `where true` on every delete.
--
-- The archive step now builds an explicit column list from the source
-- table's own catalogue, so adding a column to campaigns tomorrow cannot
-- break the reset.

create or replace function public.reset_campaigns_with_archive(
  p_rows        jsonb,
  p_is_crm_self boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch     uuid := gen_random_uuid();
  v_actor     uuid := auth.uid();
  v_campaigns integer := 0;
  v_logs      integer := 0;
  v_checks    integer := 0;
  v_decisions integer := 0;
  v_calendar  integer := 0;
  v_inserted  integer := 0;
  v_cols      text;
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

  -- campaign_name and launch_date are the only two values the sheet MUST
  -- supply; everything else has a sensible default. Checking them here
  -- names the problem, instead of surfacing a not-null violation from deep
  -- inside the insert after the archive has already been written.
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'campaign_name', '') = '' or (e->>'launch_date') is null
  ) then
    raise exception
      'Refusing to reset: every row needs a campaign_name and a launch_date. '
      'Check the Date column in the uploaded sheet.';
  end if;

  select count(*) into v_calendar from campaigns where calendar_status = 'UPDATED';

  -- ---------- archive, matching columns BY NAME ----------
  -- Only columns the archive actually has are copied, so a shape mismatch
  -- can no longer abort the reset. Step 2 above keeps the shapes in step.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='campaigns_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into campaigns_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from campaigns', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_campaigns = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='activity_logs'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='activity_logs_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into activity_logs_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from activity_logs', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_logs = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='qc_checklists'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='qc_checklists_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into qc_checklists_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from qc_checklists', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_checks = row_count;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='crm_decisions'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='crm_decisions_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into crm_decisions_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from crm_decisions', v_cols, v_cols)
    using v_batch, v_actor;
  get diagnostics v_decisions = row_count;

  -- ---------- verify the archive BEFORE destroying anything ----------
  if v_campaigns <> (select count(*) from campaigns) then
    raise exception 'Archive incomplete: % campaigns archived, % live. Aborting.',
      v_campaigns, (select count(*) from campaigns);
  end if;

  -- ---------- delete EVERYTHING ----------
  -- `where true` is required: Supabase runs pg_safeupdate, which rejects an
  -- unqualified DELETE with SQLSTATE 21000 even inside this function.
  delete from change_requests where true;
  delete from notifications   where true;
  -- Cascades activity_logs, qc_checklists, crm_decisions, content_submissions.
  delete from campaigns       where true;

  -- ---------- insert the new sheet ----------
  -- An EXPLICIT column list: jsonb_populate_recordset would return NULL for
  -- every absent key and would NOT apply column defaults, so id, created_at
  -- and every other NOT NULL DEFAULT column would fail.
  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by
  )
  select
    r.campaign_name,
    -- campaign_origin is NOT NULL with a default; a JSON row that omits it
    -- must not send NULL and break the whole reset.
    coalesce(r.campaign_origin, 'CRM_PLANNED')::campaign_origin,
    r.launch_date, r.launch_time,
    r.slot_number, r.pncc_segment_label, r.pncc_category_code, r.category,
    -- slot_type is NOT NULL with a default. Listing it in the column list
    -- means an omitted key sends NULL and overrides that default, so it is
    -- coalesced. Verified against the 23 NOT NULL columns on campaigns.
    coalesce(r.slot_type, 'STANDARD'),
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

-- ═════════ 4. VERIFY: every archive now matches its source + 3 ═════════
-- Zero rows expected.
select c.table_name, 'archive is missing columns' as problem,
       string_agg(c.column_name, ', ') as columns
from information_schema.columns c
where c.table_schema='public'
  and c.table_name in ('campaigns','activity_logs','qc_checklists','crm_decisions')
  and not exists (
    select 1 from information_schema.columns a
    where a.table_schema='public' and a.table_name = c.table_name || '_archive'
      and a.column_name = c.column_name)
group by c.table_name;

notify pgrst, 'reload schema';
