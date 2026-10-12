-- =====================================================================
-- CLiQ Push Ops — 25: reset must be scoped to ONE planning stream
--
-- Run TWENTY-FIFTH, after 24. Idempotent; safe to rerun.
--
-- THE BUG
-- There are two independent planning streams:
--     A. CRM Self              (is_crm_self = true)
--     B. CRM needing Category  (is_crm_self = false)
-- and they must never affect each other. The reset treated them as ONE
-- dataset: uploading a new CRM Self sheet deleted every Category-led
-- campaign too.
--
-- ROOT CAUSE, exactly: `reset_campaigns_with_archive` already TAKES
-- `p_is_crm_self`, but only ever RECORDS it on the batch row
-- (22_reset_timeout_and_speed.sql:221). It is never used as a filter. So
-- `delete from campaigns where true` (22:176) and the archive
-- `select ... from campaigns` (22:113) both span both streams.
--
-- `upload_reset_preview()` had the same flaw: it counted every campaign
-- (18:99-104), so the confirmation modal promised to delete rows the other
-- stream owned.
--
-- WHAT CHANGES: only the SCOPE. Archive-then-verify-then-delete-then-insert
-- in one transaction, CRM-only, empty sheet refused, required fields
-- checked, `where true` on every delete for pg_safeupdate, name-based
-- archiving, the 500s budget — all unchanged.
-- =====================================================================

-- ═════════ 1. PREVIEW, PER STREAM ═════════
-- Returns the stream being replaced AND the one that will be left alone,
-- so the modal can state both. A confirmation that cannot name what
-- survives is not a confirmation.
create or replace function public.upload_reset_preview(p_is_crm_self boolean default false)
returns table (
  stream            text,
  total             integer,   -- rows in THIS stream (to be replaced)
  at_category       integer,
  with_content      integer,
  in_qc             integer,
  on_calendar       integer,
  emergencies       integer,
  change_requests   integer,
  unaffected_total  integer,   -- rows in the OTHER stream (untouched)
  unaffected_stream text
) language sql security definer set search_path = public stable as $$
  select
    case when p_is_crm_self then 'CRM Self' else 'Category-led' end,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self)::int,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self
       and content_status = 'NOT_ASSIGNED' and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self
       and content_status in ('PENDING','NEEDS_CHANGES') and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self
       and content_status = 'SUBMITTED' and calendar_status <> 'UPDATED')::int,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self
       and calendar_status = 'UPDATED')::int,
    (select count(*) from campaigns where is_crm_self = p_is_crm_self and is_emergency)::int,
    (select count(*) from change_requests cr
       join campaigns c on c.id = cr.campaign_id
      where c.is_crm_self = p_is_crm_self)::int,
    (select count(*) from campaigns where is_crm_self <> p_is_crm_self)::int,
    case when p_is_crm_self then 'Category-led' else 'CRM Self' end;
$$;
grant execute on function public.upload_reset_preview(boolean) to authenticated;

-- The old no-argument form would silently span both streams. Remove it so
-- a stale client cannot call it and get the wrong numbers.
drop function if exists public.upload_reset_preview();

-- ═════════ 2. THE SCOPED RESET ═════════
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
  v_live      integer := 0;
  v_cols      text;
begin
  if not public.is_crm() then
    raise exception 'Only CRM can reset campaigns.';
  end if;

  set local lock_timeout = '15s';

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'reset_campaigns_with_archive expects a JSON array of rows.';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Refusing to reset: the uploaded sheet contains no rows.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'campaign_name', '') = '' or (e->>'launch_date') is null
  ) then
    raise exception
      'Refusing to reset: every row needs a campaign_name and a launch_date. '
      'Check the Date column in the uploaded sheet.';
  end if;

  select count(*) into v_calendar
    from campaigns where is_crm_self = p_is_crm_self and calendar_status = 'UPDATED';
  select count(*) into v_live
    from campaigns where is_crm_self = p_is_crm_self;

  -- ---------- archive THIS STREAM ONLY, matching columns by name ----------
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='campaigns'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='campaigns_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into campaigns_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from campaigns where is_crm_self = $3', v_cols, v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_campaigns = row_count;

  -- Children are archived through their parent, so the same scope applies.
  select string_agg('l.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='activity_logs'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='activity_logs_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into activity_logs_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from activity_logs l
      join campaigns c on c.id = l.campaign_id
      where c.is_crm_self = $3',
    replace(v_cols, 'l.', ''), v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_logs = row_count;

  select string_agg('q.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='qc_checklists'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='qc_checklists_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into qc_checklists_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from qc_checklists q
      join campaigns c on c.id = q.campaign_id
      where c.is_crm_self = $3',
    replace(v_cols, 'q.', ''), v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_checks = row_count;

  select string_agg('d.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='crm_decisions'
    and exists (select 1 from information_schema.columns a
                where a.table_schema='public' and a.table_name='crm_decisions_archive'
                  and a.column_name = c.column_name);
  execute format(
    'insert into crm_decisions_archive (%s, archive_batch_id, archived_at, archived_by)
     select %s, $1, now(), $2 from crm_decisions d
      join campaigns c on c.id = d.campaign_id
      where c.is_crm_self = $3',
    replace(v_cols, 'd.', ''), v_cols)
    using v_batch, v_actor, p_is_crm_self;
  get diagnostics v_decisions = row_count;

  -- ---------- verify the archive BEFORE destroying anything ----------
  if v_campaigns <> v_live then
    raise exception 'Archive incomplete: % of % % campaigns archived. Aborting.',
      v_campaigns, v_live, case when p_is_crm_self then 'CRM Self' else 'Category-led' end;
  end if;

  -- ---------- delete THIS STREAM ONLY ----------
  -- Every statement is scoped through campaigns, so the other stream's rows
  -- and its children are untouched. `where true` is not needed where a real
  -- predicate exists; pg_safeupdate is satisfied by any WHERE.
  delete from change_requests cr
   using campaigns c where c.id = cr.campaign_id and c.is_crm_self = p_is_crm_self;

  -- notifications.campaign_id is nullable: broadcast rows belong to neither
  -- stream, so only campaign-linked ones are removed.
  delete from notifications n
   using campaigns c where c.id = n.campaign_id and c.is_crm_self = p_is_crm_self;

  delete from activity_logs l
   using campaigns c where c.id = l.campaign_id and c.is_crm_self = p_is_crm_self;
  delete from qc_checklists q
   using campaigns c where c.id = q.campaign_id and c.is_crm_self = p_is_crm_self;
  delete from crm_decisions d
   using campaigns c where c.id = d.campaign_id and c.is_crm_self = p_is_crm_self;
  delete from content_submissions s
   using campaigns c where c.id = s.campaign_id and c.is_crm_self = p_is_crm_self;

  delete from campaigns where is_crm_self = p_is_crm_self;

  -- ---------- insert the new sheet, forced into THIS stream ----------
  -- is_crm_self comes from the upload type, not the JSON: a sheet cannot
  -- smuggle rows into the other stream.
  insert into campaigns (
    campaign_name, campaign_origin, launch_date, launch_time, slot_number,
    pncc_segment_label, pncc_category_code, category, slot_type, is_crm_self,
    sub_category, brand, offer, title_brief, message_brief, pn_template,
    creative_requirements, category_status, crm_status, content_status,
    qc_status, production_status, priority, created_by
  )
  select
    r.campaign_name,
    coalesce(r.campaign_origin, 'CRM_PLANNED')::campaign_origin,
    r.launch_date, r.launch_time,
    r.slot_number, r.pncc_segment_label, r.pncc_category_code, r.category,
    coalesce(r.slot_type, 'STANDARD'),
    p_is_crm_self,
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
    format('CRM reset the %s stream. Archived %s campaigns (%s on calendar), '
           'inserted %s new rows. The %s stream was not affected. Archive batch %s.',
           case when p_is_crm_self then 'CRM Self' else 'Category-led' end,
           v_campaigns, v_calendar, v_inserted,
           case when p_is_crm_self then 'Category-led' else 'CRM Self' end, v_batch));

  return v_batch;
end $$;

revoke all on function public.reset_campaigns_with_archive(jsonb, boolean) from public;
grant execute on function public.reset_campaigns_with_archive(jsonb, boolean) to authenticated;

-- Which stream a reset touched, so a session can decide whether it cares.
alter table reset_events add column if not exists is_crm_self boolean;

create or replace function public.emit_reset_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into reset_events (batch_id, performed_by, row_count, is_crm_self)
  values (new.id, new.performed_by, new.campaigns_inserted, new.is_crm_self);
  return new;
end $$;

-- ═════════ VERIFY ═════════
select p.proname, pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('upload_reset_preview','reset_campaigns_with_archive')
order by 1;
-- upload_reset_preview must take p_is_crm_self; the no-arg form must be gone.

notify pgrst, 'reload schema';
